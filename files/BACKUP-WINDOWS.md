# Windows sender: установка и ручная приёмка

Windows-часть [бэкапа файлов (#652)](BACKUP.md). Канон команд sender — этот
документ; формат архива, VPS receiver и восстановление описаны в `BACKUP.md`.
Это процедура для оператора после зелёного CI и review, **не установленная задача**.
Команды ниже при подготовке документа не выполнялись на рабочем Windows-хосте.

Используется Windows PowerShell **5.1** и уже установленный Tailscale. Новая задача
`Swarm Files Backup` получает тот же principal, что существующая `PG Docker Backup`:
текущий SID, `S4U`, `Limited`. Существующая задача, учётные записи, пароли, политики
PowerShell и чужие ACL не меняются. Новых уведомлений нет.

## 1. Закрепить проверенный исходник

В обычном PowerShell 5.1 текущего пользователя, без нового checkout. Оператор
подставляет полный reviewed commit SHA, независимо сверенный SHA256 sender и
существующее имя VPS в Taildrop. Значения-заглушки намеренно останавливают блок.
Для передачи исходника через существующий канал вместо публичного скачивания
нужен тот же контроль SHA256; брать изменяемый `main` нельзя.

```powershell
$ErrorActionPreference = 'Stop'
$release = '<reviewed-full-commit-sha>'
$senderSha = '<independently-reviewed-sender-sha256>'
$target = '<existing-vps-taildrop-name>'
if ($release -cnotmatch '\A[0-9a-f]{40}\z' -or
    $senderSha -cnotmatch '\A[0-9a-f]{64}\z' -or
    $target -notmatch '\A[A-Za-z0-9][A-Za-z0-9.-]{0,252}\z') {
    throw 'Set reviewed release, sender hash and existing target first'
}
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'Windows PowerShell 5.1 required'
}
$taskName = 'Swarm Files Backup'
if (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'Own task already exists; stop without overwriting it'
}
$pg = Get-ScheduledTask -TaskPath '\' -TaskName 'PG Docker Backup'
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($pg.Principal.UserId -match '\AS-1-') {
    $principalSid = (New-Object Security.Principal.SecurityIdentifier($pg.Principal.UserId)).Value
} else {
    $account = New-Object Security.Principal.NTAccount($pg.Principal.UserId)
    $principalSid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
}
if ($principalSid -ne $currentSid -or [string]$pg.Principal.LogonType -ne 'S4U' -or
    [string]$pg.Principal.RunLevel -ne 'Limited') {
    throw 'Existing PG principal differs; stop without changing it'
}
$base = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'SwarmFilesBackup'))
$bin = Join-Path (Join-Path $base 'bin') $release
$sender = Join-Path $bin 'backup-swarm-task-files.ps1'
$cache = Join-Path $base 'cache'
$source = 'C:\projects\swarm-files\data'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($path in @($base, $sender, $cache, $source, $tailscale, $powershell)) {
    if (-not [IO.Path]::IsPathRooted($path) -or $path -match '["\r\n]') {
        throw 'Absolute unambiguous paths required'
    }
}
if (-not (Test-Path -LiteralPath $source -PathType Container) -or
    -not (Test-Path -LiteralPath $tailscale -PathType Leaf)) { throw 'Existing source/Tailscale missing' }
if (Test-Path -LiteralPath $bin) { throw 'Version directory already exists; do not overwrite' }
$null = New-Item -ItemType Directory -Path $bin
$uri = "https://raw.githubusercontent.com/GarroV/Swarm-brain/$release/scripts/windows/backup-swarm-task-files.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $sender
if ((Get-FileHash -LiteralPath $sender -Algorithm SHA256).Hash.ToLowerInvariant() -cne $senderSha) {
    throw 'Sender hash mismatch; do not execute or register'
}
```

Sender создаёт только свой новый cache с закрытым наследованием и доступом
текущему SID, SYSTEM и Administrators. Существующий cache только проверяется:
лишний доступ, неизвестные файлы или reparse points дают отказ, не смену ACL.
Не подставлять каталог исходных файлов или чужой backup-каталог как `WorkRoot`.

## 2. Создать отдельную отключённую задачу

Продолжение в той же сессии. Все пути уже абсолютные: S4U не должен заново
вычислять пользовательское окружение. Параметры — действующие имена из sender.
Операционные пределы согласованы с receiver; это не лимиты загрузок продукта.

```powershell
if (Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'Own task already exists; do not overwrite'
}
if ((Get-FileHash -LiteralPath $sender -Algorithm SHA256).Hash.ToLowerInvariant() -cne $senderSha) {
    throw 'Sender pin changed'
}
$arguments = ('-NoProfile -NonInteractive -File "{0}" -SourceRoot "{1}" -WorkRoot "{2}" ' +
    '-TailscaleExe "{3}" -Target "{4}" -MaxTotalBytes 536870912 -MaxArchiveBytes 268435456 ' +
    '-MaxFiles 10000 -MaxLocalBytes 4294967296 -MaxArchives 64 -SendTimeoutSeconds 120') -f
    $sender, $source, $cache, $tailscale, $target
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $bin
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(3).AddMinutes(40))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$definition = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $pg.Principal
$definition.Settings.Enabled = $false
$null = Register-ScheduledTask -TaskPath '\' -TaskName $taskName -InputObject $definition
if ((Get-ScheduledTask -TaskPath '\' -TaskName $taskName).State -ne 'Disabled') {
    Disable-ScheduledTask -TaskPath '\' -TaskName $taskName | Out-Null
    throw 'Expected disabled task'
}
```

Расписание — **03:40 по локальному времени Windows**, с учётом его часового
пояса/DST, не 03:40 UTC. `StartWhenAvailable` разрешает догнать пропущенный запуск;
`IgnoreNew` не запускает второй экземпляр; предел одного запуска — 5 минут;
после ошибки — до трёх повторов с интервалом 5 минут. `PG Docker Backup` не редактируется.
Блок не использует `-Force`, новый principal, пароль или `ExecutionPolicy Bypass`.
Если существующая политика не разрешает запуск, остановиться, не менять её.

## 3. Приёмка до включения расписания

Сначала оператор после CI/review запускает `PrepareOnly` на настоящем source.
Это читает источник и пишет только свой cache; **не отправляет архив**. Нужны
успешный стабильный снимок, непустой список и сохранённые хеши. Наличие трёх файлов
в старом inventory не превращается в ограничение или ожидаемое число навсегда.

```powershell
if ((Get-FileHash -LiteralPath $sender -Algorithm SHA256).Hash.ToLowerInvariant() -cne $senderSha) {
    throw 'Sender pin changed'
}
$json = & $powershell -NoProfile -NonInteractive -File $sender -SourceRoot $source `
    -WorkRoot $cache -PrepareOnly -MaxTotalBytes 536870912 -MaxArchiveBytes 268435456 `
    -MaxFiles 10000 -MaxLocalBytes 4294967296 -MaxArchives 64 -SendTimeoutSeconds 120
$code = $LASTEXITCODE
if ($code -ne 0) { $json; throw 'Prepare failed; task remains disabled' }
$prepared = $json | ConvertFrom-Json
if ($prepared.status -ne 'ok' -or $prepared.sent -ne $false -or $prepared.file_count -lt 1) {
    throw 'Unexpected prepare result; task remains disabled'
}
$prepared | Select-Object status, archive_name, sha256, file_count, total_bytes, attempts, sent
```

Затем — **одна настоящая отправка именно из S4U-задачи**, не только из интерактивной
консоли. Не делать приёмку рядом с 03:40: временное включение активирует и ежедневный
trigger. Receiver к этому моменту должен быть подготовлен по `BACKUP.md`.
Отключённую задачу запустить нельзя, поэтому она временно включается; после прогона
снова отключается до независимой проверки восстановления. При ошибке тоже отключается.

```powershell
$oldRun = (Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName).LastRunTime
try {
    if ((Get-FileHash -LiteralPath $sender -Algorithm SHA256).Hash.ToLowerInvariant() -cne $senderSha) {
        throw 'Sender pin changed'
    }
    Enable-ScheduledTask -TaskPath '\' -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskPath '\' -TaskName $taskName
    $deadline = (Get-Date).AddMinutes(6)
    do {
        Start-Sleep -Seconds 1
        $info = Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName
        $state = (Get-ScheduledTask -TaskPath '\' -TaskName $taskName).State
        if ((Get-Date) -gt $deadline) { throw 'One-off deadline exceeded' }
    } while ($info.LastRunTime -le $oldRun -or $state -in @('Running', 'Queued'))
    if ($info.LastTaskResult -ne 0) { throw 'Scheduled sender failed' }
} finally {
    Disable-ScheduledTask -TaskPath '\' -TaskName $taskName | Out-Null
}
$info | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

`LastTaskResult = 0` означает только успешное завершение sender/передачи Taildrop,
не проверенное восстановление. Task Scheduler сам не сохраняет JSON stdout.
Оператор отдельно проверяет на VPS именно этот архив: SHA256 ZIP, manifest,
число/размеры/хеши восстановленных файлов в изолированный каталог, независимое
место хранения и retention. Не распаковывать поверх source и не удалять исходники.
После **успешного восстановления** и повторной проверки pin включить свою задачу:

```powershell
if ((Get-FileHash -LiteralPath $sender -Algorithm SHA256).Hash.ToLowerInvariant() -cne $senderSha) {
    throw 'Sender pin changed; task remains disabled'
}
Enable-ScheduledTask -TaskPath '\' -TaskName $taskName | Out-Null
Get-ScheduledTask -TaskPath '\' -TaskName $taskName | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName | Select-Object LastTaskResult, NextRunTime
```

## Ошибки и дальнейшие запуски

CLI возвращает `0` и один JSON `status=ok`, либо `1` и ограниченный JSON
`status=error,error_type=...`; raw stdout/stderr дочернего Tailscale не публикуется.
Ненулевой `LastTaskResult` проверяется после завершения, не пока задача выполняется.
Для диагностики повторить ручной `PrepareOnly` и прочитать его `error_type` локально.
`empty_source`, `unstable_source`, `source_limit`, `archive_limit`, `local_limit`,
`send_failed`, `send_timeout` — отказ, а не успешный бэкап. Ошибка receiver тоже
не считается принятым архивом, даже если Taildrop sender завершился с нулём.

Cache ограничен 4 GiB/64 архивами, снимок — 512 MiB/10 000 файлами, ZIP — 256 MiB;
на отправку отведено 120 секунд. Архивы старше 14 суток убираются, самый новый
сохраняется; молодые архивы ради освобождения лимита не удаляются. При росте
источника оператор согласует пределы **обоих** концов до изменения параметров.
Свой оставшийся после сбоя stage удаляется под exclusive lock; неизвестные записи
и reparse points не удаляются. Ни cleanup, ни восстановление не удаляют source.

Повторная установка или обновление — отдельная операторская операция: эти команды
останавливаются при существующей задаче/версии, не заменяют их автоматически.
