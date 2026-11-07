#requires -Version 5.1
# Synthetic, offline tests. No Tailscale, live files, remote hosts or installed tasks.
[CmdletBinding()]
param([switch]$NegativeControls, [string]$ContractFixtureDirectory = '')
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-swarm-task-files.ps1')
$script:Passed = 0
$script:Failed = 0
$script:Base = Join-Path ([IO.Path]::GetTempPath()) ('swarm-backup-test-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($script:Base)

function Assert-True([bool]$Value) { if (-not $Value) { throw 'assertion_failed' } }
function Assert-Error([scriptblock]$Run, [string]$Kind) {
    $caught = $false
    try { & $Run | Out-Null } catch {
        $caught = $true
        Assert-True ($_.Exception.Data['error_type'] -ceq $Kind)
    }
    Assert-True $caught
}
function Test-Case([string]$Name, [scriptblock]$Run) {
    try { & $Run; $script:Passed++; Write-Output ('PASS ' + $Name) }
    catch { $script:Failed++; Write-Output ('FAIL ' + $Name + ' assertion_or_runtime_error') }
}
function New-Fixture {
    $root = Join-Path $script:Base ([guid]::NewGuid().ToString('N'))
    $source = Join-Path $root 'source'
    $null = [IO.Directory]::CreateDirectory((Join-Path $source 'nested'))
    [IO.File]::WriteAllBytes((Join-Path $source 'a.txt'), [byte[]]@(0, 1, 2, 255))
    [IO.File]::WriteAllText((Join-Path $source 'nested/b.bin'), 'synthetic-only', (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllBytes((Join-Path $source 'zero'), [byte[]]@())
    return [pscustomobject]@{ root = $root; source = $source; work = (Join-Path $root 'private work') }
}
function Invoke-Fixture($Fixture, [scriptblock]$Probe = {}) {
    return Invoke-SwarmFilesBackup $Fixture.source $Fixture.work '' '' $true 2097152 1048576 100 8388608 8 2 $Probe
}
function Assert-NoArchive($Fixture) {
    Assert-True (@(Get-ChildItem -LiteralPath $Fixture.work -Filter '*.zip').Count -eq 0)
    Assert-True (@(Get-ChildItem -LiteralPath $Fixture.work -Directory).Count -eq 0)
}
function Get-EncodedArguments([string]$Code) {
    return '-NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code))
}

function Invoke-NegativeControls {
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'backup-swarm-task-files.ps1'))
    $mutations = @(
        @{ name = 'snapshot_equality'; old = 'if ($Before[$i].$key -cne $After[$i].$key)';
            new = 'if ($false)'; expected = 'repeated_content_change_fails_three_attempts' },
        @{ name = 'manifest_bom'; old = '[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding($false)))';
            new = '[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding($true)))';
            expected = 'archive_manifest_restore_and_readonly_source' },
        @{ name = 'send_exit_status'; old = "if (`$process.ExitCode -ne 0) { Stop-Backup 'send_failed' }";
            new = '# deliberately broken send exit status'; expected = 'transport_failure_discards_large_both_streams' }
    )
    foreach ($mutation in $mutations) {
        Assert-True (($source.Split([string[]]@($mutation.old), [StringSplitOptions]::None)).Count -eq 2)
        $directory = Join-Path $script:Base $mutation.name
        $null = [IO.Directory]::CreateDirectory($directory)
        $changed = $source.Replace($mutation.old, $mutation.new)
        Assert-True ($source -cne $changed)
        [IO.File]::WriteAllText((Join-Path $directory 'backup-swarm-task-files.ps1'), $changed, (New-Object Text.UTF8Encoding($false)))
        [IO.File]::Copy($PSCommandPath, (Join-Path $directory 'test-backup-swarm-task-files.ps1'))
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = Join-Path $PSHOME 'powershell.exe'
        $info.Arguments = '-NoProfile -NonInteractive -File "' + (Join-Path $directory 'test-backup-swarm-task-files.ps1') + '"'
        $info.UseShellExecute = $false
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $info
        try {
            $null = $process.Start()
            $out = $process.StandardOutput.ReadToEndAsync()
            $err = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(60000)) { $process.Kill(); throw 'mutation_timeout' }
            Assert-True ([Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($out, $err), 5000))
            Assert-True ($process.ExitCode -ne 0)
            Assert-True ($out.Result.Contains('FAIL ' + $mutation.expected + ' assertion_or_runtime_error'))
            Write-Output ('PASS negative_control_' + $mutation.name + '_actual_RED')
        } finally { $process.Dispose() }
    }
}

try {
    Assert-True ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1)
    if ($NegativeControls) {
        Invoke-NegativeControls
        Write-Output '{"status":"ok","negative_controls":3}'
        exit 0
    }
    Test-Case 'archive_manifest_restore_and_readonly_source' {
        $f = New-Fixture
        $before = @(Get-SourceSnapshot $f.source 100 2097152)
        $r = Invoke-Fixture $f
        Assert-True ($r.status -eq 'ok' -and $r.file_count -eq 3 -and -not $r.sent)
        Assert-SameSnapshot $before @(Get-SourceSnapshot $f.source 100 2097152)
        Assert-True ($r.archive_name -cmatch $script:ArchivePattern)
        $stamp = $Matches[1]
        $zipPath = Join-Path $f.work $r.archive_name
        Assert-True ((Get-HexHash $zipPath) -ceq $r.sha256)
        $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            Assert-True ($zip.Entries.Count -eq 4)
            $names = @($zip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
            Assert-True (($names -join '|') -ceq 'data/a.txt|data/nested/b.bin|data/zero|manifest.json')
            $stream = $zip.GetEntry('manifest.json').Open()
            $memory = New-Object IO.MemoryStream
            try { $stream.CopyTo($memory); $bytes = $memory.ToArray() }
            finally { $stream.Dispose(); $memory.Dispose() }
            Assert-True ($bytes[0] -eq 123)
            $manifest = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
            Assert-True ((@($manifest.PSObject.Properties.Name) -join '|') -ceq 'schema_version|source_kind|created_utc|files|file_count|total_bytes')
            Assert-True ($manifest.schema_version -eq 1 -and $manifest.source_kind -ceq 'swarm-task-files')
            Assert-True ($manifest.files.Count -eq 3 -and $manifest.file_count -eq 3 -and $manifest.total_bytes -eq $r.total_bytes)
            $parsed = [datetime]::ParseExact($manifest.created_utc, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
            Assert-True ($parsed.ToString("yyyyMMdd'T'HHmmssfff'Z'") -ceq $stamp)
            foreach ($record in $manifest.files) {
                Assert-True ((@($record.PSObject.Properties.Name) -join '|') -ceq 'path|size_bytes|sha256')
                $entry = $zip.GetEntry('data/' + $record.path)
                Assert-True ($entry.Length -eq $record.size_bytes)
            }
        } finally { $zip.Dispose() }
        $restored = Join-Path $f.root 'restore'
        [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $restored)
        foreach ($record in $manifest.files) {
            $path = Join-Path (Join-Path $restored 'data') $record.path.Replace('/', '\')
            Assert-True ((Get-HexHash $path) -ceq $record.sha256)
            Assert-True ((Get-Item -LiteralPath $path).Length -eq $record.size_bytes)
        }
        Assert-PrivateDirectory $f.work
        Assert-True (@(Get-ChildItem -LiteralPath $f.work -Directory).Count -eq 0)
    }
    Test-Case 'unsafe_paths_rejected' {
        foreach ($path in @('../a', '/root', 'a//b', 'a\b', 'C:thing', 'a/..', 'a.', 'CON.txt', 'a/NUL', 'LPT1', 'a b', "name`n")) {
            Assert-Error { Assert-RelativePath $path } 'unsafe_relative_path'
        }
        foreach ($path in @('a.txt', 'nested/00-abc', '.hidden', 'name_with_underscores')) { Assert-RelativePath $path }
    }
    Test-Case 'source_byte_and_file_bounds' {
        $f = New-Fixture
        Assert-Error { Get-SourceSnapshot $f.source 2 2097152 } 'source_limit'
        Assert-Error { Get-SourceSnapshot $f.source 100 1 } 'source_limit'
    }
    Test-Case 'empty_first_capture_cannot_report_success' {
        $f = New-Fixture
        foreach ($item in @(Get-ChildItem -LiteralPath $f.source -Recurse -File)) { $item.Delete() }
        Assert-Error { Invoke-Fixture $f } 'empty_source'
        Assert-NoArchive $f
    }
    Test-Case 'single_file_manifest_stays_array' {
        $f = New-Fixture
        [IO.File]::Delete((Join-Path $f.source 'nested/b.bin'))
        [IO.File]::Delete((Join-Path $f.source 'zero'))
        $r = Invoke-Fixture $f
        $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $f.work $r.archive_name))
        try {
            $reader = New-Object IO.StreamReader($zip.GetEntry('manifest.json').Open())
            try { $m = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
            Assert-True ($m.files -is [Array] -and $m.files.Count -eq 1 -and $m.file_count -eq 1)
        } finally { $zip.Dispose() }
    }
    Test-Case 'archive_size_bound_and_cleanup' {
        $f = New-Fixture
        Assert-Error { Invoke-SwarmFilesBackup $f.source $f.work '' '' $true 2097152 10 100 8388608 8 2 } 'archive_limit'
        Assert-NoArchive $f
    }
    Test-Case 'repeated_content_change_fails_three_attempts' {
        $f = New-Fixture
        $script:ProbeCount = 0
        Assert-Error { Invoke-Fixture $f { param($attempt)
            $script:ProbeCount++
            [IO.File]::WriteAllText((Join-Path $f.source 'a.txt'), ('changed-' + $attempt))
        } } 'unstable_source'
        Assert-True ($script:ProbeCount -eq 3)
        Assert-NoArchive $f
    }
    Test-Case 'one_change_retries_then_captures_new_content' {
        $f = New-Fixture
        $r = Invoke-Fixture $f { param($attempt)
            if ($attempt -eq 1) { [IO.File]::WriteAllText((Join-Path $f.source 'a.txt'), 'changed') }
        }
        Assert-True ($r.attempts -eq 2 -and $r.file_count -eq 3)
    }
    Test-Case 'addition_removal_and_mtime_detected' {
        $f = New-Fixture
        $before = @(Get-SourceSnapshot $f.source 100 2097152)
        [IO.File]::WriteAllText((Join-Path $f.source 'added'), 'new')
        Assert-Error { Assert-SameSnapshot $before @(Get-SourceSnapshot $f.source 100 2097152) } 'unstable_source'
        [IO.File]::Delete((Join-Path $f.source 'added'))
        [IO.File]::SetLastWriteTimeUtc((Join-Path $f.source 'a.txt'), [datetime]::UtcNow.AddMinutes(-5))
        Assert-Error { Assert-SameSnapshot $before @(Get-SourceSnapshot $f.source 100 2097152) } 'unstable_source'
        [IO.File]::Delete((Join-Path $f.source 'a.txt'))
        Assert-Error { Assert-SameSnapshot $before @(Get-SourceSnapshot $f.source 100 2097152) } 'unstable_source'
    }
    Test-Case 'inflight_partial_is_not_silently_skipped' {
        $f = New-Fixture
        [IO.File]::WriteAllText((Join-Path $f.source 'a.part-abc'), 'inflight')
        Assert-Error { Invoke-Fixture $f } 'unstable_source'
        Assert-NoArchive $f
    }
    Test-Case 'nested_or_equal_work_roots_rejected' {
        $f = New-Fixture
        Assert-Error { Invoke-SwarmFilesBackup $f.source $f.source '' '' $true 2097152 1048576 100 8388608 8 2 } 'invalid_roots'
        Assert-Error { Invoke-SwarmFilesBackup $f.source (Join-Path $f.source 'backup') '' '' $true 2097152 1048576 100 8388608 8 2 } 'invalid_roots'
    }
    Test-Case 'unknown_work_root_not_claimed_or_deleted' {
        $f = New-Fixture
        New-PrivateDirectory $f.work
        [IO.File]::WriteAllText((Join-Path $f.work 'unrelated'), 'keep')
        Assert-Error { Invoke-Fixture $f } 'unknown_work_root'
        Assert-True ([IO.File]::ReadAllText((Join-Path $f.work 'unrelated')) -ceq 'keep')
    }
    Test-Case 'concurrent_run_lock' {
        $f = New-Fixture
        Initialize-WorkRoot $f.work
        $lock = [IO.File]::Open((Join-Path $f.work '.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        try { Assert-Error { Invoke-Fixture $f } 'already_running' } finally { $lock.Dispose() }
    }
    Test-Case 'abandoned_private_stage_recovers_without_source_changes' {
        $f = New-Fixture
        Initialize-WorkRoot $f.work
        $before = @(Get-SourceSnapshot $f.source 100 2097152)
        $stage = Join-Path $f.work ('stage-' + [guid]::NewGuid().ToString('N'))
        New-PrivateDirectory $stage
        [IO.File]::WriteAllText((Join-Path $stage 'archive.partial'), 'simulated-crash')
        $r = Invoke-Fixture $f
        Assert-True ($r.status -eq 'ok' -and -not [IO.Directory]::Exists($stage))
        Assert-SameSnapshot $before @(Get-SourceSnapshot $f.source 100 2097152)
    }
    Test-Case 'retention_fourteen_days_keep_newest_and_source' {
        $f = New-Fixture
        $r = Invoke-Fixture $f
        $path = Join-Path $f.work $r.archive_name
        $old1 = 'swarm-files-backup-v1-20000101T000000000Z-' + ('a' * 64) + '.zip'
        $old2 = 'swarm-files-backup-v1-20000102T000000000Z-' + ('b' * 64) + '.zip'
        [IO.File]::Move($path, (Join-Path $f.work $old1))
        [IO.File]::WriteAllText((Join-Path $f.work $old2), 'newest')
        $null = Invoke-LocalRetention $f.work ([datetime]::UtcNow) 8 8388608
        Assert-True (-not [IO.File]::Exists((Join-Path $f.work $old1)))
        Assert-True ([IO.File]::Exists((Join-Path $f.work $old2)))
        Assert-True (@(Get-SourceSnapshot $f.source 100 2097152).Count -eq 3)
    }
    Test-Case 'young_backups_not_deleted_to_hide_local_bound' {
        $f = New-Fixture
        $r = Invoke-Fixture $f
        Assert-Error { Invoke-SwarmFilesBackup $f.source $f.work '' '' $true 2097152 1048576 100 8388608 1 2 } 'local_limit'
        Assert-True ([IO.File]::Exists((Join-Path $f.work $r.archive_name)))
    }
    Test-Case 'transport_failure_discards_large_both_streams' {
        $code = '[Console]::Out.Write(("synthetic-sensitive" * 20000)); [Console]::Error.Write(("synthetic-sensitive" * 20000)); exit 7'
        $captured = @(Assert-Error { Invoke-BoundedProcess (Join-Path $PSHOME 'powershell.exe') (Get-EncodedArguments $code) 10 } 'send_failed')
        Assert-True ($captured.Count -eq 0)
    }
    Test-Case 'transport_timeout_terminates_only_own_child' {
        $pidFile = Join-Path $script:Base 'own-child.pid'
        $code = '[IO.File]::WriteAllText(''' + $pidFile.Replace("'", "''") + ''',[string]$PID); Start-Sleep 30'
        Assert-Error { Invoke-BoundedProcess (Join-Path $PSHOME 'powershell.exe') (Get-EncodedArguments $code) 2 } 'send_timeout'
        Assert-True ([IO.File]::Exists($pidFile))
        $child = [int][IO.File]::ReadAllText($pidFile)
        Assert-True ($null -eq (Get-Process -Id $child -ErrorAction SilentlyContinue))
    }
    Test-Case 'synthetic_executable_send_arguments_and_spaces' {
        $f = New-Fixture
        $exe = Join-Path $f.root 'fake-tailscale.exe'
        Add-Type -TypeDefinition @'
using System;
using System.IO;
public class SyntheticTaildrop {
    public static int Main(string[] args) {
        Console.WriteLine("synthetic-sensitive");
        Console.Error.WriteLine("synthetic-sensitive");
        return args.Length == 4 && args[0] == "file" && args[1] == "cp"
            && File.Exists(args[2]) && args[3] == "synthetic-vps:" ? 0 : 9;
    }
}
'@ -OutputAssembly $exe -OutputType ConsoleApplication
        $r = Invoke-SwarmFilesBackup $f.source $f.work 'synthetic-vps' $exe $false 2097152 1048576 100 8388608 8 10
        Assert-True ($r.sent -and $r.file_count -eq 3)
    }
    if ($ContractFixtureDirectory -and $script:Failed -eq 0) {
        if ([IO.Directory]::Exists($ContractFixtureDirectory) -and
            @(Get-ChildItem -LiteralPath $ContractFixtureDirectory -Force).Count -ne 0) { throw 'fixture_output_not_empty' }
        $null = [IO.Directory]::CreateDirectory($ContractFixtureDirectory)
        $f = New-Fixture
        $r = Invoke-Fixture $f
        [IO.File]::Copy((Join-Path $f.work $r.archive_name), (Join-Path $ContractFixtureDirectory $r.archive_name))
        Write-Output 'PASS synthetic_dotnet_contract_fixture_created'
    }
} finally {
    if ([IO.Directory]::Exists($script:Base)) { [IO.Directory]::Delete($script:Base, $true) }
}
[ordered]@{ status = $(if ($script:Failed -eq 0) { 'ok' } else { 'failed' }); passed = $script:Passed; failed = $script:Failed } | ConvertTo-Json -Compress
if ($script:Failed -gt 0) { exit 1 }
