# Шлюз раскатки на своём сервере

Канон скрипта шлюза — [`gate.sh`](gate.sh). Живая копия лежит на сервере в
`/opt/swarm-deploy/gate.sh`; правка здесь без копирования туда ничего не меняет (и наоборот —
правка на сервере мимо репозитория пропадёт при следующем обновлении). Контекст — issue #919
(перестройка CI после переезда прода на свой сервер 13.10.2026, #915). Как шлюз используется в
раскатке — [docs/DEPLOY.md](../../docs/DEPLOY.md), раздел «Прод — свой сервер».

## Что это

Прод Swarm — self-hosted Supabase на VPS Contabo (`/srv/swarm/supabase`). Раскатке нужны пять
действий: выложить edge-функции, посмотреть, какие миграции применены, накатить миграцию, залить
сборку рекордера в Storage, поставить или снять плашку и заморозку. Шлюз —
это ssh-пользователь `swarm-deploy`, у ключа которого **нет оболочки**: что бы клиент ни передал,
sshd запускает только `gate.sh`, а тот разрешает ровно пять команд (всё остальное — отказ):

| Команда (после `ssh swarm-deploy@host`) | stdin | Что делает |
|---|---|---|
| `functions` | tar.gz содержимого `supabase/functions` (корень архива — сам каталог функций) | сохраняет копию текущих функций, выкладывает **все** разом (rsync `--delete`, рантайм-роутер `main`, `hello`, `deno.jsonc` не трогает), перезапускает `supabase-edge-functions`, ждёт ответа пробы; печатает строку результата, ненулевой код при ошибке |
| `migrations-applied` | — | печатает применённые версии миграций, по одной в строке |
| `migrate <версия> <имя>` | SQL файла миграции | накат одной транзакцией вместе с записью в `supabase_migrations.schema_migrations`; уже применённая — «пропускаю», код 0. Имя — `[a-z0-9_]` |
| `recorder-upload <сборка>` | zip рекордера (≤ 100 МБ, начинается с `PK\x03\x04`) | кладёт в Storage `swarm_drive/recorder/SwarmRecorder-<сборка>.zip` через API-шлюз `127.0.0.1:8400` с service-role ключом из `/srv/swarm/supabase/.env` (ключ в аргументы и вывод не попадает), **без перезаписи**: объект уже есть и совпадает по sha256 — «уже загружен», код 0; отличается — отказ. Номер сборки — только цифры. Печатает `sha256`; после заливки сам перечитывает объект и сверяет сумму |
| `maintenance announce <начало> <минут>` | необязательно: две строки своего текста — русский, английский (до 300 символов) | `public.maintenance_announce`: плашка, заморозка и уведомление в колокольчик одной транзакцией. Начало 0–1440, длительность 1–180 минут — только цифры |
| `maintenance cancel` / `status` | — | `public.maintenance_cancel()` — снять заморозку и свою плашку; `status` — строки `maintenance`, `deploy_notice` и число встреч в обработке |
| `maintenance notice <минут>` / `notice-off` / `notice-show` | для `notice` — те же две строки текста | плашка «скоро обновление» (строка `deploy_notice`, гаснет сама через 20 мин после срока), её снятие и показ |

Произвольного SQL шлюз не принимает: тексты запросов `maintenance` зашиты в `gate.sh`, аргументы — проверенные числа, текст уходит переменными psql. Telegram эта команда не трогает (только плашка в вебе и колокольчик). Решение — [docs/decisions/2026-10-16-maintenance-gate.md](../../docs/decisions/2026-10-16-maintenance-gate.md).

Клиентская сторона: `scripts/lib/swarm-server.sh` (`swarm_server <команда>`), `scripts/maintenance.sh`, `scripts/deploy-notice.sh`, `notice.yml`,
`scripts/deploy-window.sh go`, `scripts/migrate-server.sh`, `recorder-release.yml` (шаг заливки), composite-шаг
`.github/actions/swarm-deploy-ssh` (ключ из секретов CI).

## Как установлен

- Пользователь `swarm-deploy`, без пароля.
- `~swarm-deploy/.ssh/authorized_keys` — один ключ с принудительной командой:
  `command="sudo /opt/swarm-deploy/gate.sh",no-pty,… ssh-ed25519 AAAA… swarm-deploy`.
  Что клиент пытался выполнить, sshd кладёт в `SSH_ORIGINAL_COMMAND` — шлюз разбирает его сам.
- `/etc/sudoers.d/swarm-deploy`:
  ```
  Defaults:swarm-deploy env_keep += "SSH_ORIGINAL_COMMAND"
  swarm-deploy ALL=(root) NOPASSWD: /opt/swarm-deploy/gate.sh
  ```
  Без `env_keep` sudo выбросил бы `SSH_ORIGINAL_COMMAND`, и шлюз не узнал бы команду. NOPASSWD —
  только на `gate.sh`, больше ни на что.
- `/opt/swarm-deploy/gate.sh` — принадлежит root, не доступен пользователю на запись (иначе
  `sudo` превратился бы в повышение прав).
- Копии функций перед каждой выкладкой: `/var/backups/swarm-functions/functions-<время>.tgz`,
  хранится 10 последних.

Ключи: приватная часть — локально `~/Documents/workbench/private/swarm-deploy-key` и секрет
репозитория `SWARM_DEPLOY_SSH_KEY`; строка known_hosts сервера — секрет `SWARM_DEPLOY_KNOWN_HOSTS`.
Замена ключа: сгенерировать пару, заменить публичную часть в `authorized_keys` (сохранив
`command=…`), обновить оба места с приватной частью.

## Как обновить шлюз

1. Правка — здесь, в `deploy/server/gate.sh`, через обычный PR.
2. Положить на сервер от имени владельца сервера (у `swarm-deploy` прав на запись нет):
   ```bash
   scp deploy/server/gate.sh <админ>@95.111.249.216:/tmp/gate.sh
   ssh <админ>@95.111.249.216 'sudo install -o root -g root -m 0755 /tmp/gate.sh /opt/swarm-deploy/gate.sh && rm /tmp/gate.sh'
   ```
3. Проверить чтением: `ssh -i ~/Documents/workbench/private/swarm-deploy-key swarm-deploy@95.111.249.216 migrations-applied`
   (список версий) — или `make migrate-plan`.

Проверка команды `recorder-upload` без сервера — `scripts/test-gate.sh` (отказы и «не перезаписывать»
на подставном `curl`; `test-gate.sh porcha` ломает шлюз и требует, чтобы проверки покраснели; в CI — job
«Скрипты раскатки»). Шлюз после правки нужно **заново положить на сервер** (раздел выше).

## Откат функций

Шлюз сам печатает команду отката, если рантайм не ответил после перезапуска. Вручную на сервере:

```bash
ls -1t /var/backups/swarm-functions/            # выбрать копию «до»
tar -xzf /var/backups/swarm-functions/functions-<время>.tgz -C /srv/swarm/supabase/volumes/functions
docker restart supabase-edge-functions
```

Обычный путь отката кода — `git revert` и раскатка как обычно. Миграции откатом шлюза не
снимаются: транзакция откатывается только при сбое самого наката.
