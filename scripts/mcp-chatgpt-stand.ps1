<#
Isolated MCP / ChatGPT acceptance stand on MUSPELHEIM. Never runs production commands.
Copy the checkout (without .git, node_modules or private files) to Root\source first.
  powershell -NoProfile -File source\scripts\mcp-chatgpt-stand.ps1 -Action Prepare
  powershell -NoProfile -File source\scripts\mcp-chatgpt-stand.ps1 -Action Start
The shared test database is read only: only its schema is copied into a separate DB.
Secrets are generated/read on the remote host and written only to Root\private.
#>
param(
  [ValidateSet('Prepare', 'Start', 'Status', 'TestDb')]
  [string]$Action = 'Status',
  [string]$Root = 'C:\projects\swarm-mcp-chatgpt-stand',
  [int]$Port = 18442,
  [string]$TestFile = 'supabase/functions/swarm-oauth/'
)
$ErrorActionPreference = 'Stop'
$Database = 'swarm_mcp_chatgpt_20261030'
$DbContainer = 'supabase_db_swarm'
$Network = 'supabase_network_swarm'
$DenoImage = 'denoland/deno@sha256:8ce780168429c4bf5962652e6cbea3fd45254ae902069e90585fb33f74c56968'
$RestImage = 'public.ecr.aws/supabase/postgrest@sha256:ec0e25a4e24b0a3bc5e4f011369bfc736bd1b19f513bd01079b86329a7636962'
$Source = Join-Path $Root 'source'
$Private = Join-Path $Root 'private'
$EnvFile = Join-Path $Private 'stand.env'
$RestEnvFile = Join-Path $Private 'rest.env'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Docker-Checked([string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $result = & docker @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0) {
    $tail = @($result | Select-Object -Last 20 | ForEach-Object { $_.ToString() }) -join "`n"
    throw "Docker command failed ($exitCode): $($Arguments[0])`n$tail"
  }
  return @($result | ForEach-Object { $_.ToString() })
}

function Database-Sql([string]$Sql) {
  $output = $Sql | & docker exec -i $DbContainer psql -U supabase_admin -d $Database -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw 'Isolated stand SQL failed' }
  return $output
}

function Base64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Random-Secret {
  $bytes = New-Object byte[] 48
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  return Base64Url $bytes
}

function Service-Jwt([string]$Secret) {
  $header = Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $now = [long]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  $payload = @{ role = 'service_role'; iss = 'swarm-mcp-chatgpt-stand'; iat = $now; exp = $now + 604800 } | ConvertTo-Json -Compress
  $body = Base64Url ([Text.Encoding]::UTF8.GetBytes($payload))
  $hmac = New-Object Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
  $signature = Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$header.$body")))
  $hmac.Dispose()
  return "$header.$body.$signature"
}

function Write-Env([string]$Path, [hashtable]$Values) {
  $lines = @($Values.Keys | Sort-Object | ForEach-Object { "$_=$($Values[$_])" })
  [IO.File]::WriteAllLines($Path, $lines, $Utf8)
}

function Prepare-Stand {
  New-Item -ItemType Directory -Force $Private | Out-Null
  $existing = Docker-Checked @('exec', $DbContainer, 'psql', '-U', 'postgres', '-tAc', "select 1 from pg_database where datname='$Database'")
  if (($existing -join '').Trim() -eq '1') {
    $ready = Docker-Checked @('exec', $DbContainer, 'psql', '-U', 'postgres', '-d', $Database, '-tAc', "select to_regclass('public.mcp_chatgpt_stand_bootstrap') is not null")
    if (($ready -join '').Trim() -ne 't') {
      # Only our fixed-name, incomplete bootstrap database may be recreated.
      Docker-Checked @('exec', $DbContainer, 'dropdb', '-U', 'supabase_admin', $Database) | Out-Null
      $existing = @()
    }
  }
  if (($existing -join '').Trim() -ne '1') {
    Docker-Checked @('exec', $DbContainer, 'createdb', '-U', 'supabase_admin', $Database) | Out-Null
    $dump = "/tmp/$Database.schema.sql"
    Docker-Checked @('exec', $DbContainer, 'pg_dump', '-U', 'postgres', '--schema-only', '--no-owner', '--no-privileges', '--file', $dump, 'postgres') | Out-Null
    Docker-Checked @('exec', $DbContainer, 'psql', '-U', 'supabase_admin', '-d', $Database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', $dump) | Out-Null
    Docker-Checked @('exec', $DbContainer, 'rm', '-f', $dump) | Out-Null
    Database-Sql 'create table public.mcp_chatgpt_stand_bootstrap(created_at timestamptz not null default now());' | Out-Null
    Write-Output 'Created isolated database from test schema only; source DB data/schema unchanged.'
  }

  if (!(Test-Path $EnvFile) -or !(Test-Path $RestEnvFile)) {
    $inspect = (Docker-Checked @('inspect', 'supabase_rest_swarm') | Out-String | ConvertFrom-Json)[0]
    $restValues = @{}
    foreach ($line in $inspect.Config.Env) {
      if ($line -match '^(PGRST_[^=]+)=(.*)$') { $restValues[$matches[1]] = $matches[2] }
    }
    $uri = $restValues['PGRST_DB_URI'] -replace '/postgres(?=\?|$)', "/$Database"
    if (!$uri -or $uri -eq $restValues['PGRST_DB_URI']) { throw 'Cannot isolate test PostgREST database URL' }
    $restValues['PGRST_DB_URI'] = $uri
    $restValues['PGRST_DB_SCHEMAS'] = 'public'
    $restValues['PGRST_DB_ANON_ROLE'] = 'anon'
    # Our PostgREST has its own signing secret; never trust keys from another test runtime.
    $restValues['PGRST_JWT_SECRET'] = Random-Secret
    $service = Service-Jwt $restValues['PGRST_JWT_SECRET']
    $envValues = @{
      STAND_ONLY = 'swarm-mcp-chatgpt'; STAND_PORT = "$Port"; STAND_STATIC = '/app/miniapp/out'
      STAND_LOGIN_USER = '900009901'; STAND_LOGIN_USERS = '900009901,900009902,900009903'
      SUPABASE_URL = "http://swarm-chatgpt-gateway:$Port"; SUPABASE_SERVICE_ROLE_KEY = $service
      WEB_JWT_SECRET = (Random-Secret); MCP_CONFIRM_SECRET = (Random-Secret)
      WEB_BASE_URL = "http://localhost:$Port"; MINIAPP_URL = "http://localhost:$Port"
      SWARM_PUBLIC_URL = "http://localhost:$Port"; MCP_OAUTH_ALLOW_HTTP_LOOPBACK = '1'
      SECOND_STEP_REQUIRED = '1'; SECOND_STEP_AUDIENCE = 'all'
      SUPABASE_DB_URL = ($uri -replace '^postgresql:', 'postgres:')
    }
    Write-Env $EnvFile $envValues
    Write-Env $RestEnvFile $restValues
  }

  # Apply only this feature's migration to the isolated DB, once. Never alter shared postgres.
  $migration = Join-Path $Source 'supabase\migrations\20261030150000_mcp_oauth.sql'
  if (Test-Path $migration) {
    Get-Content -Raw $migration | & docker exec -i $DbContainer psql -U supabase_admin -d $Database -v ON_ERROR_STOP=1 -1 -q
    if ($LASTEXITCODE -ne 0) { throw 'Feature migration failed in isolated DB' }
  }
  Database-Sql @'
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
insert into workspaces(id,name) values
 ('mcp-chatgpt-stand-a','MCP ChatGPT acceptance A'),
 ('mcp-chatgpt-stand-b','MCP ChatGPT acceptance B') on conflict(id) do nothing;
insert into allowed_users(telegram_id,username,added_by,is_admin,group_id) values
 (900009901,'MCP stand employee',900009901,false,'mcp-chatgpt-stand-a'),
 (900009902,'MCP stand other workspace',900009901,false,'mcp-chatgpt-stand-b'),
 (900009903,'MCP stand teammate',900009901,false,'mcp-chatgpt-stand-a')
 on conflict(telegram_id) do nothing;
'@ | Out-Null
  Write-Output "Stand prepared. Private env files: $Private (values never printed)."
}

function Start-Deno([string]$Name, [string]$Entry, [string[]]$Extra = @()) {
  Remove-StandContainer $Name
  $arguments = @('run', '-d', '--name', $Name, '--network', $Network, '--restart', 'unless-stopped', '--env-file', $EnvFile,
    '--mount', "type=bind,source=$Source,target=/app,readonly",
    '--mount', 'type=volume,source=swarm-chatgpt-deno-cache,target=/deno-dir', '-w', '/app') + $Extra + @(
    $DenoImage, 'run', '--unstable-sloppy-imports', '-A', $Entry)
  Docker-Checked $arguments | Out-Null
}

function Remove-StandContainer([string]$Name) {
  $existing = Docker-Checked @('ps', '-a', '--filter', "name=^/$Name`$", '--format', '{{.Names}}')
  if (($existing -join '').Trim() -eq $Name) { Docker-Checked @('rm', '-f', $Name) | Out-Null }
}

function Start-Stand {
  if (!(Test-Path $EnvFile)) { throw 'Run Prepare first' }
  Remove-StandContainer 'swarm-chatgpt-rest'
  Docker-Checked @('run', '-d', '--name', 'swarm-chatgpt-rest', '--network', $Network, '--restart', 'unless-stopped',
    '--env-file', $RestEnvFile, $RestImage) | Out-Null
  Start-Deno 'swarm-chatgpt-api' 'supabase/functions/swarm-api/index.ts'
  Start-Deno 'swarm-chatgpt-oauth' 'supabase/functions/swarm-oauth/index.ts'
  Start-Deno 'swarm-chatgpt-mcp' 'supabase/functions/swarm-mcp/index.ts'
  Start-Deno 'swarm-chatgpt-gateway' 'scripts/mcp-chatgpt-stand.ts' @('-p', "127.0.0.1:${Port}:${Port}")
  Write-Output "Private stand: http://localhost:$Port/api/auth/login (through SSH forward to MUSPELHEIM)."
}

switch ($Action) {
  'Prepare' { Prepare-Stand }
  'Start' { Start-Stand }
  'Status' {
    Docker-Checked @('ps', '-a', '--filter', 'name=swarm-chatgpt-', '--format', '{{.Names}} {{.Status}} {{.Ports}}')
  }
  'TestDb' {
    if ($TestFile -notmatch '^[a-zA-Z0-9_./-]+$') { throw 'Invalid test path' }
    Docker-Checked @('run', '--rm', '--network', $Network, '--env-file', $EnvFile,
      '--mount', "type=bind,source=$Source,target=/app,readonly",
      '--mount', 'type=volume,source=swarm-chatgpt-deno-cache,target=/deno-dir', '-w', '/app',
      $DenoImage, 'test', '--quiet', '--unstable-sloppy-imports', '-A', $TestFile)
  }
}
