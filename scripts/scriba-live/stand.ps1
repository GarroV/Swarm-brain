# Стенд живого прогона бота scriba (T004) — серверная половина, запускается на MUSPELHEIM.
# С Мака её зовёт scripts/scriba-live.sh по ssh; руками — только если Мака под рукой нет:
#   pwsh -NoProfile -File C:\projects\scriba-live\repo\scripts\scriba-live\stand.ps1 up
#
# Команды: up | down | wipe | status | secret <ИМЯ>
# Своё на общей площадке: папка C:\projects\scriba-live (repo — клон ветки, state — данные вне
# git), compose-проект scriba-live, Supabase project_id scriba-live, порты 4420–4429,
# контейнеры встреч scriba-live-meeting-*. Чужое не трогаем: ни масок, ни prune.
param(
  [Parameter(Position = 0)][string]$Command = 'status',
  [Parameter(Position = 1)][string]$Arg = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Вывод идёт по ssh на Мак: без UTF-8 кириллица приходит вопросами (кодовая страница 437).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$Root = 'C:\projects\scriba-live'
$Repo = "$Root\repo"
$State = "$Root\state"
$Sb = "$State\sb"
$Compose = "$Repo\scripts\scriba-live\compose.yml"
$EnvFile = "$State\stand.env"
$Secrets = "$State\secrets.env"
$Project = 'scriba-live'
$Exclude = 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
$OwnerId = '7100000001'
$WebUrl = 'http://100.64.116.67:4425'
$LeaseDaemonDir = '/run/desktop/mnt/host/c/projects/scriba-live/state/lease'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Say([string]$Text) { Write-Output "[stand $(Get-Date -Format HH:mm:ss)] $Text" }

function Invoke-Native([string]$What, [scriptblock]$Block) {
  # stderr нативных команд (прогресс docker, supabase) PowerShell 5 иначе считает ошибкой.
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $saved }
  if ($LASTEXITCODE -ne 0) { throw "$What упал с кодом $LASTEXITCODE" }
}

function Dc { docker compose -p $Project -f $Compose --env-file $EnvFile @args }

function Read-EnvFile([string]$Path) {
  $map = [ordered]@{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content $Path) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$') { $map[$Matches[1]] = $Matches[2] }
    }
  }
  return $map
}

function Write-EnvFile([string]$Path, $Map) {
  $text = ($Map.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
  [IO.File]::WriteAllText($Path, $text + "`n", $Utf8)
}

function New-Secret { ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) }

# Секреты стенда живут между подъёмами: иначе каждый up разлогинивает веб и меняет токен бота.
function Get-Secrets {
  $s = Read-EnvFile $Secrets
  foreach ($name in 'WEB_JWT_SECRET', 'CRON_SECRET', 'SCRIBA_BOT_TOKEN', 'STAND_LOGIN_KEY') {
    if (-not $s.Contains($name)) { $s[$name] = New-Secret }
  }
  Write-EnvFile $Secrets $s
  return $s
}

function Write-SupabaseWorkdir {
  New-Item -ItemType Directory -Force "$Sb\supabase" | Out-Null
  $map = @{
    '^project_id = .*' = 'project_id = "scriba-live"'
    '^port = 54321' = 'port = 4420'
    '^port = 54322' = 'port = 4421'
    '^shadow_port = 54320' = 'shadow_port = 4422'
    '^port = 54323' = 'port = 4423'
    '^port = 54324' = 'port = 4427'
    '^port = 54327' = 'port = 4428'
    '^port = 54329' = 'port = 4429'
    '^inspector_port = 8083' = 'inspector_port = 4429'
  }
  $lines = Get-Content "$Repo\supabase\config.toml"
  $out = foreach ($line in $lines) {
    $result = $line
    foreach ($key in $map.Keys) { if ($result -match $key) { $result = $result -replace $key, $map[$key] } }
    $result
  }
  [IO.File]::WriteAllText("$Sb\supabase\config.toml", (($out -join "`n") + "`n"), $Utf8)
  robocopy "$Repo\supabase\migrations" "$Sb\supabase\migrations" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy миграций упал с кодом $LASTEXITCODE" }
  $global:LASTEXITCODE = 0
}

function Get-ServiceKey {
  $envText = supabase status -o env --workdir $Sb 2>$null
  foreach ($line in $envText) {
    if ($line -match '^SERVICE_ROLE_KEY="?([^"]+)"?') { return $Matches[1] }
  }
  throw 'supabase status не отдал SERVICE_ROLE_KEY — контур не поднялся'
}

function Wait-Http([string]$Url, [int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $Url
      if ($r.StatusCode -eq 200) { return $true }
    } catch { Start-Sleep -Seconds 3 }
  }
  return $false
}

function Stand-Up {
  New-Item -ItemType Directory -Force "$State\lease" | Out-Null
  $rev = (git -C $Repo rev-parse --short HEAD).Trim()
  Say "код стенда: $rev ($(git -C $Repo rev-parse --abbrev-ref HEAD))"

  Say 'Supabase: конфиг стенда и миграции ветки'
  Write-SupabaseWorkdir
  Invoke-Native 'supabase start' { supabase start --workdir $Sb -x $Exclude }
  Invoke-Native 'supabase migration up' { supabase migration up --local --include-all --workdir $Sb }

  $secrets = Get-Secrets
  $stand = [ordered]@{}
  foreach ($k in $secrets.Keys) { $stand[$k] = $secrets[$k] }
  $stand['SUPABASE_SERVICE_ROLE_KEY'] = Get-ServiceKey
  $openai = "$State\openai.key"
  $stand['OPENAI_API_KEY'] = if (Test-Path $openai) { (Get-Content -Raw $openai).Trim() } else { 'stand-fake-openai' }
  $stand['STAND_STATE_DIR'] = ($State -replace '\\', '/')
  $stand['STAND_LEASE_DAEMON_DIR'] = $LeaseDaemonDir
  $stand['STAND_OWNER_ID'] = $OwnerId
  $stand['STAND_WEB_URL'] = $WebUrl
  $extra = "$State\container-env.json"
  $stand['SCRIBA_CONTAINER_ENV'] = if (Test-Path $extra) { "'" + (Get-Content -Raw $extra).Trim() + "'" } else { '' }
  Write-EnvFile $EnvFile $stand

  Say 'образ бота scriba-live:dev (кэш Docker — повторная сборка быстрая)'
  Invoke-Native 'docker build' { docker build -q -f "$Repo\bot\container\Dockerfile" -t scriba-live:dev "$Repo\bot" }

  $webRev = (git -C $Repo rev-parse HEAD:miniapp).Trim()
  $builtRev = if (Test-Path "$State\web.rev") { (Get-Content "$State\web.rev").Trim() } else { '' }
  if ($webRev -ne $builtRev -or -not (Test-Path "$State\web\index.html")) {
    Say 'веб: сборка miniapp (первая — несколько минут)'
    Invoke-Native 'web-build' { Dc --profile tools run --rm web-build }
    [IO.File]::WriteAllText("$State\web.rev", $webRev, $Utf8)
  } else { Say 'веб: сборка актуальна' }

  $codeRev = (git -C $Repo rev-parse HEAD).Trim()
  $ranRev = if (Test-Path "$State\code.rev") { (Get-Content "$State\code.rev").Trim() } else { '' }
  Invoke-Native 'compose up' { Dc up -d functions web orchestrator }
  if ($codeRev -ne $ranRev) {
    Say 'код ветки сменился — перезапуск функций и веба'
    Invoke-Native 'compose restart' { Dc restart functions web }
  }
  [IO.File]::WriteAllText("$State\code.rev", $codeRev, $Utf8)

  Say 'сид: воркспейс, владелец, агент, бакет'
  Invoke-Native 'seed' { Dc --profile tools run --rm seed }

  Say 'жду функции (первый подъём качает зависимости)'
  if (-not (Wait-Http 'http://127.0.0.1:4424/health' 300)) { throw 'функции не ответили за 5 минут: stand.ps1 status' }
  if (-not (Wait-Http 'http://127.0.0.1:4425/health' 60)) { throw 'веб не ответил за минуту' }
  Say "СТЕНД ПОДНЯТ: веб $WebUrl, функции http://100.64.116.67:4424/functions/v1"
}

function Stop-Meetings {
  $ids = docker ps -aq --filter "name=^$Project-meeting-"
  if ($ids) { docker stop $ids | Out-Null; Say "остановлены контейнеры встреч: $(@($ids).Count)" }
}

function Stand-Down {
  if (Test-Path $EnvFile) { Dc down --remove-orphans }
  Stop-Meetings
  if (Test-Path "$Sb\supabase\config.toml") { supabase stop --workdir $Sb }
  Say 'стенд опущен; данные базы и секреты сохранены (полная уборка — wipe)'
}

function Stand-Wipe {
  Stand-Down
  if (Test-Path "$Sb\supabase\config.toml") { supabase stop --no-backup --workdir $Sb }
  foreach ($v in "${Project}_deno-cache", "${Project}_npm-cache", "$Project-recordings") {
    docker volume rm $v 2>$null | Out-Null
  }
  foreach ($v in docker volume ls -q --filter "label=com.supabase.cli.project=$Project") {
    docker volume rm $v | Out-Null
  }
  Say 'стенд стёрт: тома scriba-live удалены поимённо, state оставлен (секреты, web)'
}

function Stand-Status {
  Say 'контейнеры стенда'
  docker ps -a --filter "name=^$Project" --filter "name=^supabase_.*_$Project$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  foreach ($u in 'http://127.0.0.1:4424/health', 'http://127.0.0.1:4425/health') {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $u; Say "$u → $($r.StatusCode) $($r.Content)" }
    catch { Say "$u → НЕ ОТВЕЧАЕТ ($($_.Exception.Message))" }
  }
  $rev = (git -C $Repo log --oneline -1).Trim()
  Say "код: $rev"
  Say 'последние строки оркестратора'
  docker logs --tail 8 "$Project-orchestrator-1" 2>&1
  $plan = powercfg /getactivescheme
  Say "питание: $plan"
}

switch ($Command) {
  'up' { Stand-Up }
  'down' { Stand-Down }
  'wipe' { Stand-Wipe }
  'status' { Stand-Status }
  'secret' { (Read-EnvFile $Secrets)[$Arg] }
  default { throw "неизвестная команда «$Command»: up | down | wipe | status | secret <ИМЯ>" }
}
