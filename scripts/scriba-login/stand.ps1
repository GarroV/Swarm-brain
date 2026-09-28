# Вход аккаунта бота scriba (T175) — серверная половина, запускается на MUSPELHEIM.
# С Мака её зовёт scripts/scriba-login.sh по ssh; руками — только если Мака под рукой нет:
#   pwsh -NoProfile -File C:\projects\scriba-login\repo\scripts\scriba-login\stand.ps1 <команда>
#
# Команды:
#   build          — образ встречи scriba-login:dev и образ окна входа scriba-login-window:dev
#   login          — поднять окно входа (noVNC) и напечатать ОДНУ ссылку для владельца
#   login-status   — идёт ли окно, чем кончилась выгрузка, есть ли сохранённый вход (без содержимого)
#   login-close    — погасить окно входа, ничего не сохраняя
#   smoke          — смоуки: адаптер Meet по двойникам и вход аккаунта на настоящем Docker
#   down           — погасить всё своё (окно, контейнеры смоука), сохранённый вход оставить
#   wipe           — down + стереть образы, клон и state; сохранённый вход — только с -Arg account
#
# Своё на общей площадке: папка C:\projects\scriba-login, контейнеры и образы scriba-login*,
# порты 4450–4459 (окно входа — 4450 и только на адресе Tailscale). Чужое не трогаем.
# Пароль Google сюда не попадает никогда: его владелец вводит в окне браузера сам.
param(
  [Parameter(Position = 0)][string]$Command = 'login-status',
  [Parameter(Position = 1)][string]$Arg = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$Root = 'C:\projects\scriba-login'
$Repo = "$Root\repo"
$State = "$Root\state"
# Сохранённый вход живёт вне git, вне образа и вне клона. Другой стенд подключает его, указав
# своему оркестратору SCRIBA_GOOGLE_STATE_FILE на этот файл (docs/ARCHITECTURE.md, «Аккаунт бота»).
$Account = if ($env:SCRIBA_ACCOUNT_DIR) { $env:SCRIBA_ACCOUNT_DIR } else { "$State\account" }
$KeyFile = "$State\login.key"
$Addr = '100.64.116.67'
$WindowPort = 4450
$SmokePort = 4452
$Image = 'scriba-login:dev'
$WindowImage = 'scriba-login-window:dev'
$Window = 'scriba-login-window'
$Seccomp = "$Repo\bot\src\container\seccomp-chromium.json"
$SmokeDaemonDir = '/run/desktop/mnt/host/c/projects/scriba-login/state/smoke'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Say([string]$Text) { Write-Output "[scriba-login $(Get-Date -Format HH:mm:ss)] $Text" }

function Invoke-Native([string]$What, [scriptblock]$Block) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $saved }
  if ($LASTEXITCODE -ne 0) { throw "$What упал с кодом $LASTEXITCODE" }
}

# Каталог только для владельца машины и SYSTEM: наследование прав снято, чужих записей нет.
function Protect-Directory([string]$Path) {
  New-Item -ItemType Directory -Force $Path | Out-Null
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Invoke-Native "icacls $Path" { icacls $Path /inheritance:r /grant:r "${me}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' /Q }
}

function Test-Running([string]$Name) {
  $found = docker ps -q --filter "name=^$Name$"
  return [bool]$found
}

function Build-Images {
  $rev = (git -C $Repo log --oneline -1).Trim()
  Say "код: $rev"
  Invoke-Native 'docker build (встреча)' { docker build -q -f "$Repo\bot\container\Dockerfile" -t $Image "$Repo\bot" }
  Invoke-Native 'docker build (окно входа)' {
    docker build -q -f "$Repo\bot\container\login\Dockerfile" --build-arg "BOT_IMAGE=$Image" -t $WindowImage "$Repo\bot"
  }
  Say "образы $Image и $WindowImage собраны"
}

function New-WindowKey {
  # 8 символов: VNC больше не берёт. Ключ живёт только на время окна и меняется на каждом входе.
  $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  $bytes = New-Object byte[] 8
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Open-Login {
  if (Test-Running $Window) { throw "окно входа уже открыто: stand.ps1 login-status или login-close" }
  Protect-Directory $State
  Protect-Directory $Account
  $key = New-WindowKey
  [IO.File]::WriteAllText($KeyFile, $key, $Utf8)
  # Порт публикуется только на адресе Tailscale: из интернета и из локальной сети окна не видно.
  Invoke-Native 'docker run (окно входа)' {
    docker run -d --rm --init --name $Window `
      --label scriba-login.stand=true `
      -p "${Addr}:${WindowPort}:6080" `
      --shm-size 1g `
      --security-opt "seccomp=$Seccomp" --security-opt no-new-privileges:true `
      -v "${Account}:/account" `
      -v "${KeyFile}:/run/scriba-login/key:ro" `
      $WindowImage
  } | Out-Null
  $until = (Get-Date).AddSeconds(60)
  $ready = $false
  while ((Get-Date) -lt $until) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://${Addr}:${WindowPort}/vnc.html"
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $ready) {
    docker logs --tail 20 $Window 2>&1
    throw 'окно входа не ответило за минуту'
  }
  Say 'окно входа открыто. Ссылка для владельца (только из сети Tailscale):'
  Write-Output "http://${Addr}:${WindowPort}/vnc.html?autoconnect=1&resize=scale&password=$key"
}

function Show-LoginStatus {
  if (Test-Running $Window) {
    Say 'окно входа открыто; последние строки:'
    docker logs --tail 5 $Window 2>&1
  } else {
    Say 'окно входа не открыто'
  }
  $result = "$Account\last-login.txt"
  if (Test-Path $result) { Say "последняя выгрузка: $((Get-Content $result) -join ' ')" }
  $file = "$Account\google-state.json"
  if (Test-Path $file) {
    $info = Get-Item $file
    Say "сохранённый вход: есть, $($info.Length) байт, записан $($info.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
  } else {
    Say 'сохранённого входа нет — бот ходит гостем'
  }
}

function Close-Login {
  if (Test-Running $Window) { docker stop $Window | Out-Null; Say 'окно входа погашено, вход не выгружался' }
  else { Say 'окно входа и так не открыто' }
  if (Test-Path $KeyFile) { Remove-Item -Force $KeyFile }
}

function Run-Smoke {
  Say 'смоук адаптера Meet: двойники страниц, живой meet.google.com'
  Invoke-Native 'smoke-meet' {
    docker run --rm --name scriba-login-smoke-meet --label scriba-login.stand=true `
      --shm-size 1g --security-opt "seccomp=$Seccomp" `
      $Image node /app/src/meet-adapter/smoke-meet.ts
  }
  Say 'смоук оркестратора: вход аккаунта на настоящем Docker'
  New-Item -ItemType Directory -Force "$State\smoke" | Out-Null
  $only = if ($Arg) { $Arg } else { 'account,door' }
  Invoke-Native 'smoke-orchestrator' {
    docker run --rm --name scriba-login-smoke-orchestrator --label scriba-login.stand=true `
      --user root --entrypoint node `
      -p "127.0.0.1:${SmokePort}:${SmokePort}" `
      -v //var/run/docker.sock:/var/run/docker.sock `
      -v "$State\smoke:$SmokeDaemonDir" `
      -e "SCRIBA_SMOKE_STATE=$SmokeDaemonDir" -e 'SCRIBA_SMOKE_PROJECT=scriba-login' `
      -e "SCRIBA_SMOKE_IMAGE=$Image" -e "SCRIBA_SMOKE_PORT=$SmokePort" `
      -e 'SCRIBA_SMOKE_LISTEN=0.0.0.0' -e "SCRIBA_SMOKE_ONLY=$only" `
      $Image /app/src/orchestrator/smoke-orchestrator.ts
  }
}

function Stand-Down {
  if (Test-Running $Window) { docker stop $Window | Out-Null }
  # Свои служебные контейнеры (окно, смоуки) — по своей метке; контейнеры встреч смоука —
  # по метке оркестратора. Метку оркестратора служебным не ставим: он счёл бы их встречами.
  foreach ($label in 'scriba-login.stand=true', 'scriba.project=scriba-login') {
    foreach ($id in docker ps -aq --filter "label=$label") { docker rm -f $id | Out-Null }
  }
  if (Test-Path $KeyFile) { Remove-Item -Force $KeyFile }
  Say 'своё погашено: окно входа, контейнеры смоука; сохранённый вход не тронут'
}

function Stand-Wipe {
  Stand-Down
  foreach ($volume in docker volume ls -q --filter 'name=^scriba-login-recordings-') { docker volume rm $volume | Out-Null }
  foreach ($img in $WindowImage, $Image) { docker image rm $img 2>$null | Out-Null }
  if ($Arg -eq 'account') {
    Remove-Item -Recurse -Force $Root
    Say "стёрто всё, включая сохранённый вход: $Root удалён"
  } else {
    Remove-Item -Recurse -Force $Repo, "$State\smoke" -ErrorAction SilentlyContinue
    Say "образы и клон стёрты; сохранённый вход оставлен в $Account (стереть и его: wipe account)"
  }
}

switch ($Command) {
  'build' { Build-Images }
  'login' { Open-Login }
  'login-status' { Show-LoginStatus }
  'login-close' { Close-Login }
  'smoke' { Run-Smoke }
  'down' { Stand-Down }
  'wipe' { Stand-Wipe }
  default { throw "неизвестная команда «$Command»: build | login | login-status | login-close | smoke | down | wipe" }
}
