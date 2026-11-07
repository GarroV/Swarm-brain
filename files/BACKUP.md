# Независимые копии swarm-files (#652)

Инструменты подготовлены для копии `C:\projects\swarm-files\data` на другом хосте — VPS.
Код и синтетические проверки сами по себе **не включают бэкап**: установка, один реальный
контрольный перенос и восстановление выполняются отдельно владельцем. До их подтверждения
защита данных работающим расписанием не заявляется.

Первичное хранилище остаётся на MUSPELHEIM. Снимки на VPS лежат в собственной директории
`/var/backups/swarm-files/verified` (700, ZIP и состояние 600). Это независимая локальная
копия на другом хосте, **без шифрования at rest сверх существующей политики VPS**.
Она не входит в restic, общий `vps-backup` или его уведомления; `targets.conf` не меняется.

## Контракт и целостность

Отправитель, [Windows-установка](BACKUP-WINDOWS.md) и его синтетические тесты:
`scripts/windows/{backup-swarm-task-files,test-backup-swarm-task-files}.ps1`.
Приёмник: `scripts/swarm-files-backup/{receiver,archive_contract}.py`, только стандартная
библиотека Python 3.12. Их нельзя импортировать в рабочий API.

Имя: `swarm-files-backup-v1-<yyyyMMddTHHmmssfffZ>-<sha256 всего ZIP>.zip`.
ZIP32 содержит только `manifest.json` (UTF-8 без BOM) и `data/<relative path>` для каждого
файла. Нет дополнительных записей, directory entries, шифрования или ZIP-комментариев.
Допустимы Store/Deflate. Manifest имеет ровно поля:

- `schema_version: 1`, `source_kind: "swarm-task-files"`;
- `created_utc` в `yyyy-MM-ddTHH:mm:ss.fffZ`, совпадающий с временем в имени;
- `files: [{path, size_bytes, sha256}]`, `file_count`, `total_bytes`.

Пути относительные, ASCII-сегменты `[A-Za-z0-9._-]+`, не более 240 знаков: без пустых
сегментов, `.`/`..`, обратного слеша, двоеточия, Windows reserved names и завершающей точки.
Коллизии без учёта регистра запрещены. Первый пустой снимок отвергается. Источник физически
не удаляет объекты: новая или равновременная версия должна быть superset последней
проверенной версии с прежними размерами и SHA каждого существующего пути. Нарушение —
`source_regression`, без публикации, ACK, очистки старых ZIP или обновления last-success.
Запоздалый более старый валидный архив сохраняется и подтверждается, но latest не меняет.

Отправитель сравнивает полный список/размеры/хеши/mtime до и после чтения; незавершённые
`.part-*`, reparse points или изменение источника дают ограниченный retry/fail, а не тихий skip.
Статус не считается успешным только по коду завершения копирования.

## Приём на VPS

Используется уже включённый Taildrop для same-user untagged узлов. Не нужны новые SSH
ключи/trust, ACL или включение features. CLI **и daemon** должны иметь numeric version
**1.104.4**: приёмник читает `tailscale version --daemon --json`, требует `short` и
`daemonLong`. Отсутствие версии или несовпадение закрывает приём.

Обычный `tailscale file get` запрещён: у него нет фильтра имени. Приёмник через существующий
Unix socket `/var/run/tailscale/tailscaled.sock` получает metadata списка, отбирает только
строгий собственный basename и делает адресные LocalAPI v0 GET/DELETE. Остальные payload
не читаются и не удаляются, их имена не пишутся в журнал. Сам LocalAPI v0 upstream считает
нестабильным: при обновлении Tailscale сначала проверяют контракт; fallback на bulk-get нет.

Порядок: exclusive 600 part → SHA имени/все ZIP entries/manifest/CRC/content SHA → fsync →
эксклюзивная атомарная публикация immutable ZIP → fsync каталога и commit marker → DELETE
ровно того же имени. Ошибка DELETE возвращает явный `delete_failed_after_verify`; повтор
заново проверяет существующий ZIP и не перезаписывает его. `last-success.json` хранит время
последней подтверждённой latest-версии отдельно от времени её создания.

Один процесс защищён собственным `flock`. При обрыве под этим lock удаляются только
строго распознанные собственные `.incoming-*.part`/`.state-*.part` обычные файлы 600 текущего
владельца; неизвестные имена, ссылки и другие объекты не удаляются. Истёкшие **уже проверенные**
снимки можно убрать перед admission только после полной перепроверки latest и входного
снимка/superset. Newest и прежний newest текущего прохода сохраняются. Срок — 14 дней;
также сохраняются недавно записанные файлы/markers и неподтверждённые ZIP. Очистка идёт через
устойчивый `.pruning.json` tombstone: обрыв между удалениями восстанавливается следующим
запуском, а missing/corrupt latest не маскируется.

Операционные пределы по умолчанию: ZIP 256 MiB (`--max-archive`), суммарные исходные байты
512 MiB (`--max-total`), 10000 файлов (`--max-count`), manifest 4 MiB. ZIP32 ограничивает
настраиваемые archive/total до 2147483647 байт, count до 50000. Приём/verify/restore имеют
общий wall timeout 120 s (`--timeout`, максимум 600). VPS сохраняет до 4 GiB/64 архивов (`--max-stored-bytes`/`--max-stored-count`);
переполнение recent/uncommitted данными — явный отказ, не преждевременное удаление.
Один ограниченный временный ZIP допускается до окончательной проверки/очистки. Реальная
статистика 3 файла/838553 байта — проверенный снимок, не зашитый лимит продукта.

Шаблоны собственного service/timer: `scripts/swarm-files-backup/systemd/`. Установка файлов
в `/opt/swarm-files-backup`, создание private каталогов и включение unit делаются отдельно
владельцем. До загрузки unit создать **оба** каталога: `install -d -m0700 /var/backups/swarm-files /var/backups/swarm-files/verified`; `ReadWritePaths` требует существующий base. Timer проверяет очередь раз в час с небольшим jitter, сохраняет пропущенный
запуск; никаких новых сообщений людям. Unit ограничивает CPU/память/время, не запускает stand.
Не включать timer до ручной проверки pinned versions, одного приёма и восстановления.

## Проверить и восстановить

Код проверяется без сервисов и настоящих файлов:

```sh
python3 -m unittest discover -s scripts/swarm-files-backup -p 'test_*.py'
python3 scripts/swarm-files-backup/check_faults.py
```

Workflow `swarm-files-backup.yml` исполняет настоящий Windows PowerShell 5.1/.NET ZIP,
передаёт только маленький синтетический artifact между GitHub runners и проверяет его
настоящим Python CLI на Linux. Это не перенос с MUSPELHEIM и не доказательство включённого
прод-бэкапа. Проверки включают corruption, source regression, чужую запись очереди,
DELETE retry, прерывание очистки, 64 истёкших архива и гонку создания restore directory.

```sh
archive=$(python3 -c 'import json; print(json.load(open("/var/backups/swarm-files/last-success.json"))["archive"])')
python3 /opt/swarm-files-backup/receiver.py verify --archive "/var/backups/swarm-files/verified/$archive"
python3 /opt/swarm-files-backup/receiver.py restore --archive "/var/backups/swarm-files/verified/$archive" --destination "/var/backups/swarm-files/restore-check-$(date -u +%Y%m%dT%H%M%SZ)"
```

Команды требуют существующего `last-success.json` после подтверждённого приёма. Restore требует
**отсутствующий** destination: exclusive mkdir и O_EXCL файлов сохраняют конкурентно
созданный каталог. Новый корень 700, файлы 600; SHA/размеры сверяются повторно после записи.
Существующие деревья, рабочее хранилище и боевые строки не перезаписываются. Успешно
восстановленный каталог остаётся для проверки владельцем; автоматически не удаляется.

Перед заявлением о готовности: зафиксировать SHA установленного кода, pinned versions,
реальный малый source snapshot/receiver/restore, сопоставить все байты и чужой sentinel,
проверить расписания/last-success. Пропущенные реальные проверки перечислить в отчёте.
