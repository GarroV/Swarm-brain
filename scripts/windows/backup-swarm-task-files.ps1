#requires -Version 5.1
<#
Read-only capture of swarm-files, followed by an optional existing Tailscale send.
No scheduler, credentials, source deletion, notification or host configuration.
See files/BACKUP.md. Dot-source for synthetic tests (does not run the CLI).
#>
[CmdletBinding()]
param(
    [string]$SourceRoot = 'C:\projects\swarm-files\data',
    [string]$WorkRoot = (Join-Path $env:LOCALAPPDATA 'SwarmFilesBackup\cache'),
    [string]$Target = '',
    [string]$TailscaleExe = 'C:\Program Files\Tailscale\tailscale.exe',
    [switch]$PrepareOnly,
    [long]$MaxTotalBytes = 536870912,
    [long]$MaxArchiveBytes = 268435456,
    [int]$MaxFiles = 10000,
    [long]$MaxLocalBytes = 4294967296,
    [int]$MaxArchives = 64,
    [int]$SendTimeoutSeconds = 120
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:ArchivePattern = '\Aswarm-files-backup-v1-([0-9]{8}T[0-9]{9}Z)-([0-9a-f]{64})\.zip\z'
$script:OwnerMarker = 'swarm-task-files-backup-v1'

function Stop-Backup([string]$Kind) {
    $e = New-Object System.InvalidOperationException('Backup failed')
    $e.Data['error_type'] = $Kind
    throw $e
}

function Assert-RelativePath([string]$Path) {
    if ($Path.Length -gt 240 -or $Path -notmatch '\A[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*\z') {
        Stop-Backup 'unsafe_relative_path'
    }
    foreach ($part in $Path.Split('/')) {
        if ($part -eq '.' -or $part -eq '..' -or $part.EndsWith('.') -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            Stop-Backup 'unsafe_relative_path'
        }
    }
}

function Assert-NotReparse([string]$Path) {
    if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Backup 'reparse_point'
    }
}

function Get-HexHash([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-SourceSnapshot([string]$Root, [int]$FileLimit, [long]$ByteLimit) {
    Assert-NotReparse $Root
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)
    $records = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in (New-Object IO.DirectoryInfo($directory)).GetFileSystemInfos()) {
            Assert-NotReparse $item.FullName
            $relative = $item.FullName.Substring($Root.Length + 1).Replace('\', '/')
            Assert-RelativePath $relative
            if (-not $seen.Add($relative)) { Stop-Backup 'duplicate_relative_path' }
            if ($seen.Count -gt ($FileLimit * 2)) { Stop-Backup 'source_limit' }
            if (($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) {
                $pending.Push($item.FullName)
                continue
            }
            if ($relative -match '(?i)\.part-') { Stop-Backup 'unstable_source' }
            $beforeSize = $item.Length
            $beforeTime = $item.LastWriteTimeUtc.Ticks
            $total += $beforeSize
            if ($records.Count -ge $FileLimit -or $total -gt $ByteLimit) { Stop-Backup 'source_limit' }
            $hash = Get-HexHash $item.FullName
            $item.Refresh()
            if (-not $item.Exists -or $item.Length -ne $beforeSize -or $item.LastWriteTimeUtc.Ticks -ne $beforeTime) {
                Stop-Backup 'unstable_source'
            }
            $records.Add([pscustomobject]@{ path = $relative; size_bytes = [long]$beforeSize;
                sha256 = $hash; mtime_ticks = $beforeTime; full_path = $item.FullName })
        }
    }
    if ($records.Count -eq 0) { Stop-Backup 'empty_source' }
    return @($records | Sort-Object -Property path)
}

function Assert-SameSnapshot([object[]]$Before, [object[]]$After) {
    if ($Before.Count -ne $After.Count) { Stop-Backup 'unstable_source' }
    for ($i = 0; $i -lt $Before.Count; $i++) {
        foreach ($key in @('path', 'size_bytes', 'sha256', 'mtime_ticks')) {
            if ($Before[$i].$key -cne $After[$i].$key) { Stop-Backup 'unstable_source' }
        }
    }
}

function New-PrivateDirectory([string]$Path) {
    if ([IO.Directory]::Exists($Path) -or [IO.File]::Exists($Path)) { Stop-Backup 'existing_work_path' }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $ids = @([Security.Principal.WindowsIdentity]::GetCurrent().User,
        (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),
        (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    foreach ($id in $ids) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($id, 'FullControl',
            'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $null = [IO.Directory]::CreateDirectory($Path, $acl)
}

function Assert-PrivateDirectory([string]$Path) {
    Assert-NotReparse $Path
    $acl = [IO.Directory]::GetAccessControl($Path)
    if (-not $acl.AreAccessRulesProtected) { Stop-Backup 'work_acl' }
    $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) {
            Stop-Backup 'work_acl'
        }
    }
}

function Initialize-WorkRoot([string]$Root) {
    if (-not [IO.Directory]::Exists($Root)) {
        New-PrivateDirectory $Root
        [IO.File]::WriteAllText((Join-Path $Root '.owner'), $script:OwnerMarker, (New-Object Text.UTF8Encoding($false)))
    }
    Assert-PrivateDirectory $Root
    $marker = Join-Path $Root '.owner'
    if (-not [IO.File]::Exists($marker)) { Stop-Backup 'unknown_work_root' }
    Assert-NotReparse $marker
    if ((Get-Item -LiteralPath $marker).Length -gt 100 -or [IO.File]::ReadAllText($marker) -cne $script:OwnerMarker) {
        Stop-Backup 'unknown_work_root'
    }
}

function Remove-OwnStage([string]$Path) {
    Assert-NotReparse $Path
    # Never follow a junction while recursively cleaning our private staging area.
    $todo = New-Object 'System.Collections.Generic.Stack[string]'
    $todo.Push($Path)
    while ($todo.Count -gt 0) {
        foreach ($item in (New-Object IO.DirectoryInfo($todo.Pop())).GetFileSystemInfos()) {
            Assert-NotReparse $item.FullName
            if (($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $todo.Push($item.FullName) }
        }
    }
    [IO.Directory]::Delete($Path, $true)
}

function Invoke-LocalRetention([string]$Root, [datetime]$Now, [int]$ArchiveLimit, [long]$ByteLimit) {
    $archives = @()
    foreach ($item in (New-Object IO.DirectoryInfo($Root)).GetFileSystemInfos()) {
        Assert-NotReparse $item.FullName
        if ($item.Name -eq '.owner' -or $item.Name -eq '.lock') { continue }
        if ($item -is [IO.FileInfo] -and $item.Name -cmatch $script:ArchivePattern) {
            $stamp = [datetime]::ParseExact($Matches[1], "yyyyMMdd'T'HHmmssfff'Z'", [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
            $archives += [pscustomobject]@{ item = $item; stamp = $stamp }
        } elseif ($item.Name -cmatch '\Astage-[0-9a-f]{32}\z' -and $item -is [IO.DirectoryInfo]) {
            # Caller holds the exclusive root lock: a prior process cannot own this stage.
            Remove-OwnStage $item.FullName
        } else { Stop-Backup 'unknown_work_entry' }
    }
    $newest = $archives | Sort-Object stamp -Descending | Select-Object -First 1
    foreach ($record in $archives) {
        if ($record.stamp -lt $Now.AddDays(-14) -and $record -ne $newest) { $record.item.Delete() }
    }
    $remaining = @($archives | Where-Object { $_.item.Refresh(); $_.item.Exists })
    [long]$size = 0
    foreach ($record in $remaining) { $size += $record.item.Length }
    if ($remaining.Count -ge $ArchiveLimit -or $size -gt $ByteLimit) { Stop-Backup 'local_limit' }
    return $size
}

function New-CapturedArchive([string]$Source, [string]$Stage, [object[]]$Snapshot,
    [datetime]$Created, [long]$ArchiveLimit) {
    $data = Join-Path $Stage 'data'
    $null = [IO.Directory]::CreateDirectory($data)
    foreach ($record in $Snapshot) {
        $destination = Join-Path $data $record.path.Replace('/', '\')
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $inputStream = [IO.File]::Open($record.full_path, 'Open', 'Read', 'Read')
        $outputStream = [IO.File]::Open($destination, 'CreateNew', 'Write', 'None')
        try { $inputStream.CopyTo($outputStream) }
        finally { $outputStream.Dispose(); $inputStream.Dispose() }
        if ((Get-Item -LiteralPath $destination).Length -ne $record.size_bytes -or
            (Get-HexHash $destination) -cne $record.sha256) { Stop-Backup 'unstable_source' }
    }
    $files = @($Snapshot | ForEach-Object { [ordered]@{ path = $_.path; size_bytes = $_.size_bytes; sha256 = $_.sha256 } })
    [long]$total = 0
    foreach ($record in $Snapshot) { $total += $record.size_bytes }
    $manifest = [ordered]@{ schema_version = 1; source_kind = 'swarm-task-files';
        created_utc = $Created.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture); files = $files;
        file_count = $files.Count; total_bytes = $total }
    $manifestPath = Join-Path $Stage 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding($false)))
    if ((Get-Item -LiteralPath $manifestPath).Length -gt 4194304) { Stop-Backup 'manifest_limit' }
    $zipPath = Join-Path $Stage 'archive.partial'
    $stream = [IO.File]::Open($zipPath, 'CreateNew', 'ReadWrite', 'None')
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($record in @([pscustomobject]@{ path = 'manifest.json'; full_path = $manifestPath }) +
            @($Snapshot | ForEach-Object { [pscustomobject]@{ path = ('data/' + $_.path); full_path = (Join-Path $data $_.path.Replace('/', '\')) } })) {
            $entry = $zip.CreateEntry($record.path, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]$Created
            $inputStream = [IO.File]::OpenRead($record.full_path)
            $outputStream = $entry.Open()
            try { $inputStream.CopyTo($outputStream) }
            finally { $outputStream.Dispose(); $inputStream.Dispose() }
            if ($stream.Length -gt $ArchiveLimit) { Stop-Backup 'archive_limit' }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
    if ((Get-Item -LiteralPath $zipPath).Length -gt $ArchiveLimit) { Stop-Backup 'archive_limit' }
    return [pscustomobject]@{ path = $zipPath; file_count = $files.Count; total_bytes = $total }
}

function Invoke-BoundedProcess([string]$Executable, [string]$Arguments, [int]$TimeoutSeconds) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { Stop-Backup 'send_start' }
        # Concurrent streaming discard: no pipe deadlock, unbounded string, or raw output.
        $out = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
        $err = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            $null = $process.WaitForExit(5000)
            Stop-Backup 'send_timeout'
        }
        if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($out, $err), 5000)) { Stop-Backup 'send_drain' }
        if ($process.ExitCode -ne 0) { Stop-Backup 'send_failed' }
    } finally { $process.Dispose() }
}

function Invoke-SwarmFilesBackup([string]$Source, [string]$Work, [string]$SendTarget, [string]$Executable,
    [bool]$Offline, [long]$SourceLimit, [long]$ArchiveLimit, [int]$FileLimit, [long]$LocalLimit,
    [int]$ArchiveCountLimit, [int]$TimeoutSeconds, [scriptblock]$CaptureProbe = {}) {
    # ZIP32-only receiver contract. Operational bounds are not product upload limits.
    if ($SourceLimit -le 0 -or $SourceLimit -gt 2147483647 -or $ArchiveLimit -le 0 -or
        $ArchiveLimit -gt $SourceLimit -or $FileLimit -le 0 -or
        $FileLimit -gt 50000 -or $ArchiveCountLimit -lt 1 -or $ArchiveCountLimit -gt 1000 -or
        $LocalLimit -lt ($SourceLimit + $ArchiveLimit) -or $TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 3600) {
        Stop-Backup 'invalid_bounds'
    }
    $Source = [IO.Path]::GetFullPath($Source).TrimEnd('\')
    $Work = [IO.Path]::GetFullPath($Work).TrimEnd('\')
    if (-not [IO.Directory]::Exists($Source) -or $Source.Length -lt 4 -or
        $Work.StartsWith($Source + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $Source.StartsWith($Work + '\', [StringComparison]::OrdinalIgnoreCase) -or $Source -ieq $Work) {
        Stop-Backup 'invalid_roots'
    }
    if (-not $Offline -and ($SendTarget -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$' -or
        -not [IO.File]::Exists($Executable))) { Stop-Backup 'invalid_transport' }
    Initialize-WorkRoot $Work
    $lock = $null
    $stage = $null
    try {
        $lockPath = Join-Path $Work '.lock'
        if ([IO.File]::Exists($lockPath)) { Assert-NotReparse $lockPath }
        try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { Stop-Backup 'already_running' }
        $retainedBytes = Invoke-LocalRetention $Work ([datetime]::UtcNow) $ArchiveCountLimit $LocalLimit
        if ($retainedBytes + $SourceLimit + $ArchiveLimit -gt $LocalLimit) { Stop-Backup 'local_limit' }
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $stage = Join-Path $Work ('stage-' + [guid]::NewGuid().ToString('N'))
            New-PrivateDirectory $stage
            try {
                $before = @(Get-SourceSnapshot $Source $FileLimit $SourceLimit)
                $created = [datetime]::UtcNow
                $archive = New-CapturedArchive $Source $stage $before $created $ArchiveLimit
                & $CaptureProbe $attempt
                $after = @(Get-SourceSnapshot $Source $FileLimit $SourceLimit)
                Assert-SameSnapshot $before $after
                break
            } catch {
                if ($_.Exception.Data['error_type'] -ne 'unstable_source' -or $attempt -eq 3) { throw }
                Remove-OwnStage $stage
                $stage = $null
            }
        }
        $hash = Get-HexHash $archive.path
        $name = 'swarm-files-backup-v1-' + $created.ToString("yyyyMMdd'T'HHmmssfff'Z'", [Globalization.CultureInfo]::InvariantCulture) + '-' + $hash + '.zip'
        $destination = Join-Path $Work $name
        [IO.File]::Move($archive.path, $destination)
        Remove-OwnStage $stage
        $stage = $null
        if (-not $Offline) {
            # Name/path are generated internally; Target has no shell/argument metacharacters.
            Invoke-BoundedProcess $Executable ('file cp "' + $destination + '" ' + $SendTarget + ':') $TimeoutSeconds
        }
        return [ordered]@{ status = 'ok'; archive_name = $name; sha256 = $hash;
            file_count = $archive.file_count; total_bytes = $archive.total_bytes; attempts = $attempt; sent = (-not $Offline) }
    } finally {
        try { if ($stage -and [IO.Directory]::Exists($stage)) { Remove-OwnStage $stage } }
        finally { if ($lock) { $lock.Dispose() } }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $result = Invoke-SwarmFilesBackup $SourceRoot $WorkRoot $Target $TailscaleExe ([bool]$PrepareOnly) `
            $MaxTotalBytes $MaxArchiveBytes $MaxFiles $MaxLocalBytes $MaxArchives $SendTimeoutSeconds
        $result | ConvertTo-Json -Compress
        exit 0
    } catch {
        $kind = $_.Exception.Data['error_type']
        if ($kind -notmatch '^[a-z_]{3,40}$') { $kind = 'io_error' }
        [ordered]@{ status = 'error'; error_type = $kind } | ConvertTo-Json -Compress
        exit 1
    }
}
