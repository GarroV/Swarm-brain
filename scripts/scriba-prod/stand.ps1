# Боевой бот встреч scriba — серверная половина, запускается на MUSPELHEIM.
# С Мака её зовёт scripts/scriba-prod.sh по ssh; руками — только если Мака под рукой нет:
#   pwsh -NoProfile -File C:\projects\scriba-prod\repo\scripts\scriba-prod\stand.ps1 <команда>
#
# Команды:
#   token-hash — родить токен бота, если его ещё нет, и напечатать ТОЛЬКО его sha256-hex
#   up         — собрать образ с текущего клона и поднять оркестратор
#   status     — идёт ли оркестратор, чей код, сколько встреч сейчас
#   logs       — последние строки журнала оркестратора
#   down       — погасить оркестратор и встречи; токен и вход не трогать
#
# Своё на общей площадке: папка C:\projects\scriba-prod (repo — клон main, state — данные вне
# git), compose-проект scriba-prod, контейнеры scriba-prod-*. Портов нет. Чужое не трогаем.
# Токен не покидает эту машину: наружу уходит только хеш, по нему прод узнаёт бота.
param(
  [Parameter(Position = 0)][string]$Command = 'status'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Вывод идёт по ssh на Мак: без UTF-8 кириллица приходит вопросами (кодовая страница 437).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$Root = 'C:\projects\scriba-prod'
$Repo = "$Root\repo"
$State = "$Root\state"
$Compose = "$Repo\scripts\scriba-prod\compose.yml"
$EnvFile = "$State\prod.env"
$TokenFile = "$State\bot.token"
$Project = 'scriba-prod'
$SwarmUrl = 'https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1'
$LeaseDaemonDir = '/run/desktop/mnt/host/c/projects/scriba-prod/state/lease'
$AccountCopiesDaemonDir = '/run/desktop/mnt/host/c/projects/scriba-prod/state/account-copies'
# Вход бота живёт у окна входа (scripts/scriba-login.sh); без него бот ходит гостем.
$AccountDir = 'C:\projects\scriba-login\state\account'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Say([string]$Text) { Write-Output "[scriba-prod $(Get-Date -Format HH:mm:ss)] $Text" }

function Invoke-Native([string]$What, [scriptblock]$Block) {
  # stderr нативных команд (прогресс docker) PowerShell иначе считает ошибкой.
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $saved }
  if ($LASTEXITCODE -ne 0) { throw "$What упал с кодом $LASTEXITCODE" }
}

# Каталог только для владельца машины и SYSTEM: наследование прав снято, чужих записей нет.
function Protect-Directory([string]$Path) {
  New-Item -ItemType Directory -Force $Path | Out-Null
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Invoke-Native "icacls $Path" { icacls $Path /inheritance:r /grant:r "${me}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' /Q } | Out-Null
}

function Dc { docker compose -p $Project -f $Compose --env-file $EnvFile @args }

function Get-Sha256Hex([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Read-Token {
  if (-not (Test-Path $TokenFile)) { throw "токена бота нет: сперва stand.ps1 token-hash и запись хеша в прод" }
  return ([IO.File]::ReadAllText($TokenFile)).Trim()
}

function Show-TokenHash {
  Protect-Directory $State
  if (-not (Test-Path $TokenFile)) {
    # 32 случайных байта в hex: перебором не достать, а по хешу сервер узнаёт бота.
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = 'scriba_' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
    [IO.File]::WriteAllText($TokenFile, $token, $Utf8)
  }
  Write-Output (Get-Sha256Hex (Read-Token))
}

function Prod-Up {
  if (-not (Test-Path "$AccountDir\google-state.json")) {
    throw "входа бота нет ($AccountDir\google-state.json): гостем в боевые встречи не идём, сперва scripts/scriba-login.sh login"
  }
  Protect-Directory $State
  New-Item -ItemType Directory -Force "$State\lease", "$State\account-copies" | Out-Null
  $token = Read-Token
  $rev = (git -C $Repo rev-parse --short HEAD).Trim()
  $version = (git -C $Repo rev-list --count HEAD).Trim()
  $image = "scriba-prod:$rev"
  Say "код: $rev ($(git -C $Repo rev-parse --abbrev-ref HEAD)), сборка $version"
  Invoke-Native 'docker build' { docker build -q -f "$Repo\bot\container\Dockerfile" -t $image "$Repo\bot" } | Out-Null
  $lines = @(
    "SCRIBA_IMAGE=$image",
    "SCRIBA_SWARM_URL=$SwarmUrl",
    "SCRIBA_BOT_TOKEN=$token",
    "SCRIBA_BOT_VERSION=$version",
    "PROD_STATE_DIR=$State",
    "PROD_ACCOUNT_DIR=$AccountDir",
    "PROD_LEASE_DAEMON_DIR=$LeaseDaemonDir",
    "PROD_ACCOUNT_COPIES_DAEMON_DIR=$AccountCopiesDaemonDir"
  )
  [IO.File]::WriteAllText($EnvFile, ($lines -join "`n") + "`n", $Utf8)
  Invoke-Native 'docker compose up' { Dc up -d --force-recreate orchestrator } | Out-Null
  Start-Sleep -Seconds 15
  Show-Status
}

function Show-Status {
  $state = docker inspect -f '{{.State.Status}} {{.Config.Image}} с {{.State.StartedAt}}' "$Project-orchestrator-1" 2>$null
  if (-not $state) { Say 'оркестратор не поднят'; return }
  Say "оркестратор: $state"
  $meetings = @(docker ps -q --filter "label=scriba.project=$Project" --filter 'name=meeting').Count
  Say "встреч идёт: $meetings"
  Say 'журнал (последние строки):'
  docker logs --tail 8 "$Project-orchestrator-1" 2>&1 | ForEach-Object { "  $_" }
}

function Prod-Down {
  if (Test-Path $EnvFile) { Invoke-Native 'docker compose down' { Dc down } | Out-Null }
  foreach ($id in docker ps -aq --filter "label=scriba.project=$Project") { docker rm -f $id | Out-Null }
  Say 'оркестратор и встречи погашены; токен и вход бота не тронуты'
}

switch ($Command) {
  'token-hash' { Show-TokenHash }
  'up' { Prod-Up }
  'status' { Show-Status }
  'logs' { docker logs --tail 60 "$Project-orchestrator-1" 2>&1 }
  'down' { Prod-Down }
  default { throw "неизвестная команда «$Command»: token-hash | up | status | logs | down" }
}
