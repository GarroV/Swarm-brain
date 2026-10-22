#!/bin/bash
# Шлюз раскатки Swarm на своём сервере (GarroV/Swarm-brain #919).
# Вызывается ТОЛЬКО принудительной командой ключа пользователя swarm-deploy:
#   command="sudo /opt/swarm-deploy/gate.sh" в ~swarm-deploy/.ssh/authorized_keys
# Что пришло после ssh — в SSH_ORIGINAL_COMMAND; разрешено ровно шесть действий:
#   functions                 — stdin: tar.gz каталога supabase/functions → в рантайм + пересоздание контейнера
#   env-reload                — пересоздать рантайм функций без выкладки кода: подхватить смену functions.env (#1032)
#   migrations-applied        — список применённых версий миграций
#   migrate <версия>          — stdin: SQL миграции; накат одной транзакцией вместе с учётной записью
#   recorder-upload <сборка>  — stdin: zip рекордера; заливка в Storage swarm_drive/recorder/, без перезаписи
#   maintenance <действие> …  — плашка и заморозка (#978): announce <начало> <минут> | cancel | status |
#                               notice <минут> | notice-off | notice-show; stdin (необязательно) — две строки
#                               своего текста: русский, английский. SQL зашит здесь, аргументы — проверенные числа
# Канон: GarroV/Swarm-brain deploy/server/gate.sh.
set -Eeuo pipefail
umask 077

# GATE_STACK / GATE_GW нужны тестам (scripts/test-gate.sh); на сервере sudo сбрасывает окружение
# (env_reset, сохраняется только SSH_ORIGINAL_COMMAND), и действуют значения по умолчанию.
STACK="${GATE_STACK:-/srv/swarm/supabase}"
# Шлюз API (envoy), опубликован только на loopback хоста — тот же адрес, что у PROBE.
GW="${GATE_GW:-http://127.0.0.1:8400}"
FN="$STACK/volumes/functions"
KEEP=/var/backups/swarm-functions
DB=supabase-db
RUNTIME=supabase-edge-functions
PROBE="${GATE_PROBE:-http://127.0.0.1:8400/functions/v1/swarm-recorder-version}"
PROBE_TRIES="${GATE_PROBE_TRIES:-60}"
# Файлы compose проекта `swarm` на сервере; сервис рантайма функций в них называется functions.
# Пути абсолютные: `-f` считается от текущей папки (у шлюза это домашняя swarm-deploy), а не от
# --project-directory — с относительными compose не находил файлы (21.10.2026).
COMPOSE_FILES=(-f "$STACK/docker-compose.yml" -f "$STACK/docker-compose.swarm.yml")

sha256_() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
die() { echo "gate: $*" >&2; exit 1; }
psql_() { docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }
# Миграции — от роли postgres, как в облаке Supabase: иначе владельцем новых объектов станет supabase_admin.
psql_mig() { docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

# Пересоздание, а не `docker restart`: env_file (functions.env) читается только при создании контейнера,
# поэтому после рестарта новые секреты рантайм не видит (20.10.2026 так не доехали SECOND_STEP_REQUIRED
# и WORKSPACE_SECRETS_KEY, #1032). Тома — bind-mount с хоста, код функций при пересоздании не теряется.
recreate_runtime() {
  docker compose -p swarm --project-directory "$STACK" "${COMPOSE_FILES[@]}" \
    up -d --no-deps --force-recreate functions >/dev/null
}
# Ждёт ответа рантайма на пробу: 0 — отвечает, 1 — нет за PROBE_TRIES*2 секунд.
wait_runtime() {
  local _
  for _ in $(seq "$PROBE_TRIES"); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$PROBE")" = 200 ] && return 0
    sleep 2
  done
  return 1
}

ensure_ledger() {
  psql_ -tA >/dev/null <<'SQL'
set client_min_messages = warning;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[], applied_at timestamptz default now());
grant usage on schema supabase_migrations to postgres;
grant select, insert on supabase_migrations.schema_migrations to postgres;
SQL
}

read -r -a ARGV <<< "${SSH_ORIGINAL_COMMAND:-}"
CMD="${ARGV[0]:-}"
MAXARGS=3; [ "$CMD" = maintenance ] && MAXARGS=4   # maintenance announce <начало> <минут>
[ "${#ARGV[@]}" -le "$MAXARGS" ] || die "слишком много аргументов"
logger -t swarm-deploy "команда: ${CMD} ${ARGV[1]:-}"

case "$CMD" in
  functions)
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    # Распаковка — НЕ от root: архив приходит снаружи, и обход пути/ссылки внутри него не должны
    # дать прав больше, чем у swarm-deploy. До rsync пускаем только обычные файлы и каталоги.
    chown swarm-deploy:swarm-deploy "$TMP"
    head -c 52428800 | runuser -u swarm-deploy -- tar -xzf - -C "$TMP" --no-same-owner --no-same-permissions \
      || die "архив не распаковался"
    [ -f "$TMP/swarm-api/index.ts" ] && [ -d "$TMP/_shared" ] || die "в архиве нет supabase/functions"
    if find "$TMP" ! -type f ! -type d | grep -q .; then die "в архиве есть ссылки или спецфайлы — отказ"; fi
    if find "$TMP" -type f -links +1 | grep -q .; then die "в архиве есть жёсткие ссылки — отказ"; fi
    mkdir -p "$KEEP"; STAMP=$(date +%Y%m%d-%H%M%S)
    tar -czf "$KEEP/functions-$STAMP.tgz" -C "$FN" .
    ls -1t "$KEEP"/functions-*.tgz | tail -n +11 | xargs -r rm -f
    # main (роутер рантайма), hello и deno.jsonc — от self-hosted стека, в репозитории их нет.
    rsync -a --delete --checksum --exclude '/main/' --exclude '/hello/' --exclude '/deno.jsonc' \
      --exclude '*.test.ts' "$TMP"/ "$FN"/
    chown -R garva:garva "$FN"; chmod -R u=rwX,go=rX "$FN"
    if recreate_runtime; then RELOAD="контейнер пересоздан, functions.env перечитан"
    else
      echo "gate: ВНИМАНИЕ: пересоздать контейнер не вышло (compose), делаю docker restart — новые переменные functions.env рантайм НЕ увидит" >&2
      docker restart "$RUNTIME" >/dev/null; RELOAD="только перезапуск, functions.env НЕ перечитан"
    fi
    wait_runtime && { echo "функции выложены, рантайм отвечает ($RELOAD; копия до раскатки: functions-$STAMP.tgz)"; exit 0; }
    die "рантайм не ответил за $((PROBE_TRIES * 2)) секунд после перезапуска; откат: tar -xzf $KEEP/functions-$STAMP.tgz -C $FN && docker restart $RUNTIME"
    ;;
  env-reload)
    # Код функций не трогаем: только новый контейнер с актуальным functions.env.
    recreate_runtime || die "не удалось пересоздать сервис functions (compose проекта swarm в $STACK)"
    wait_runtime || die "рантайм не ответил за $((PROBE_TRIES * 2)) секунд после пересоздания; смотреть: docker logs $RUNTIME"
    echo "рантайм функций пересоздан и отвечает: functions.env перечитан"
    ;;
  migrations-applied)
    ensure_ledger
    psql_ -tA -c "select version from supabase_migrations.schema_migrations order by 1"
    ;;
  migrate)
    V="${ARGV[1]:-}"; NAME="${ARGV[2]:-}"
    [[ "$V" =~ ^[0-9]{8,14}$ ]] || die "версия миграции должна быть цифрами: '$V'"
    [[ -z "$NAME" || "$NAME" =~ ^[a-z0-9_]+$ ]] || die "имя миграции: только a-z0-9_"
    # SQL читается ПЕРВЫМ: `docker exec -i` в проверках ниже забирает stdin себе, и миграция,
    # прочитанная после них, всегда пуста (13.10.2026 — первый настоящий накат через шлюз).
    TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
    head -c 10485760 > "$TMP"
    [ -s "$TMP" ] || die "пустая миграция"
    ensure_ledger
    if [ -n "$(psql_ -tA -c "select 1 from supabase_migrations.schema_migrations where version='$V'" </dev/null)" ]; then
      echo "миграция $V уже применена — пропускаю"; exit 0
    fi
    { cat "$TMP"; printf '\n;insert into supabase_migrations.schema_migrations(version, name) values (%s, %s);\n' "'$V'" "'$NAME'"; } \
      | psql_mig --single-transaction -f - || die "миграция $V не применилась — транзакция откатена"
    echo "миграция $V применена"
    ;;
  recorder-upload)
    B="${ARGV[1]:-}"
    [[ "$B" =~ ^[0-9]{1,9}$ ]] || die "номер сборки — только цифры: '$B'"
    NAME="SwarmRecorder-$B.zip"
    # zip читается ПЕРВЫМ — по той же причине, что и миграция выше (`docker exec -i` съедает stdin).
    # Читаем на байт больше потолка: упёршийся в него архив отвергаем, а не режем молча.
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    head -c 104857601 > "$TMP/up.zip"
    [ -s "$TMP/up.zip" ] || die "пустой архив"
    [ "$(wc -c < "$TMP/up.zip")" -le 104857600 ] || die "архив больше 100 МБ"
    [ "$(head -c 4 "$TMP/up.zip" | od -An -tx1 | tr -d ' \n')" = 504b0304 ] || die "это не zip (нет сигнатуры PK)"
    SHA=$(sha256_ "$TMP/up.zip")
    URL="$GW/storage/v1/object/public/swarm_drive/recorder/$NAME"
    # Опубликованная сборка неизменна (#203): её сумма зашита в код. Уже есть — сверяем, не затираем.
    CODE=$(curl -s -o "$TMP/old.zip" -w '%{http_code}' -m 300 "$URL") || die "хранилище не ответило"
    case "$CODE" in
      200)
        [ "$(sha256_ "$TMP/old.zip")" = "$SHA" ] || die "$NAME уже лежит в хранилище и ОТЛИЧАЕТСЯ от присланного — не перезаписываю; подними номер сборки"
        echo "$NAME уже загружен, содержимое совпадает"; echo "sha256 $SHA"; exit 0 ;;
      400|404) ;;   # Storage отвечает 400 или 404 на отсутствующий объект
      *) die "проверка наличия $NAME: HTTP $CODE" ;;
    esac
    # Ключ — из окружения стека на сервере; в аргументы и вывод не попадает (curl читает его из файла).
    KEY=$(grep -m1 '^SERVICE_ROLE_KEY=' "$STACK/.env" | cut -d= -f2- | tr -d '"\r')
    [ -n "$KEY" ] || die "SERVICE_ROLE_KEY не найден в окружении стека"
    printf 'header = "authorization: Bearer %s"\n' "$KEY" > "$TMP/curl.cfg"
    CODE=$(curl -s -o "$TMP/resp" -w '%{http_code}' -m 600 -K "$TMP/curl.cfg" -X POST \
      -H 'content-type: application/zip' --data-binary "@$TMP/up.zip" \
      "$GW/storage/v1/object/swarm_drive/recorder/$NAME") || die "заливка не дошла до хранилища"
    [ "$CODE" = 200 ] || die "заливка $NAME: HTTP $CODE: $(head -c 300 "$TMP/resp")"
    CODE=$(curl -s -o "$TMP/back.zip" -w '%{http_code}' -m 300 "$URL") || die "проверка после заливки не дошла"
    [ "$CODE" = 200 ] && [ "$(sha256_ "$TMP/back.zip")" = "$SHA" ] || die "после заливки $NAME отдаётся не то (HTTP $CODE)"
    echo "$NAME загружен"; echo "sha256 $SHA"
    ;;
  maintenance)
    ACT="${ARGV[1]:-}"
    # Число — только цифры и в пределах: в SQL уходит значение, прошедшее проверку, а не строка клиента.
    num() { # num <имя> <значение> <мин> <макс>
      [[ "$2" =~ ^[0-9]{1,4}$ ]] || die "$1 — целое число цифрами, а не '$2'"
      [ "$2" -ge "$3" ] && [ "$2" -le "$4" ] || die "$1: от $3 до $4, а не $2"
    }
    # Свой текст плашки: stdin, строка 1 — по-русски, строка 2 — по-английски; не длиннее 300 символов
    # (столько же режет SQL-функция), без управляющих символов. В SQL попадает через переменные psql.
    read_texts() {
      local raw; raw=$(head -c 4096 || true)
      RU=$(printf '%s\n' "$raw" | sed -n 1p | tr -d '\000-\037' | cut -c1-300)
      EN=$(printf '%s\n' "$raw" | sed -n 2p | tr -d '\000-\037' | cut -c1-300)
    }
    case "$ACT" in
      announce)
        num "начало (минут до заморозки)" "${ARGV[2]:-}" 0 1440
        num "длительность (минут)" "${ARGV[3]:-}" 1 180
        read_texts
        psql_ -tA -v lead="${ARGV[2]}" -v dur="${ARGV[3]}" -v ru="$RU" -v en="$EN" <<'SQL' || die "объявление не записалось"
select public.maintenance_announce(:lead, :dur, :'en', :'ru');
SQL
        ;;
      cancel)
        psql_ -tA <<'SQL' || die "отмена не записалась"
select public.maintenance_cancel();
SQL
        ;;
      status)
        psql_ -tA <<'SQL' || die "статус не прочитался"
select 'now=' || now();
select 'maintenance=' || coalesce((select value::text from public.app_settings where key = 'maintenance'), 'нет');
select 'deploy_notice=' || coalesce((select value::text from public.app_settings where key = 'deploy_notice'), 'нет');
select 'meetings_processing=' || count(*) from public.meetings where summary_status = 'processing';
SQL
        ;;
      notice)
        num "минут до обновления" "${ARGV[2]:-}" 0 1440
        read_texts
        # Плашка гаснет сама: until = момент обновления + 20 минут (как у scripts/deploy-notice.sh).
        psql_ -tA -v lead="${ARGV[2]}" -v ru="$RU" -v en="$EN" <<'SQL' || die "плашка не записалась"
insert into public.app_settings (key, value, updated_at)
values ('deploy_notice', jsonb_strip_nulls(jsonb_build_object(
  'at',    to_jsonb((now() + make_interval(mins => :lead))::timestamptz),
  'until', to_jsonb((now() + make_interval(mins => :lead + 20))::timestamptz),
  'ru',    nullif(:'ru'::text, ''),
  'en',    nullif(:'en'::text, ''))), now())
on conflict (key) do update set value = excluded.value, updated_at = now();
select 'плашка записана';
SQL
        ;;
      notice-off)
        psql_ -tA <<'SQL' || die "плашка не снялась"
delete from public.app_settings where key = 'deploy_notice';
select 'плашка снята';
SQL
        ;;
      notice-show)
        psql_ -tA <<'SQL' || die "плашка не прочиталась"
select 'deploy_notice=' || coalesce((select value::text from public.app_settings where key = 'deploy_notice'), 'нет');
SQL
        ;;
      *) die "maintenance: неизвестное действие '${ACT}'. Разрешено: announce <начало> <минут> | cancel | status | notice <минут> | notice-off | notice-show" ;;
    esac
    ;;
  *) die "неизвестная команда: '${CMD}'. Разрешено: functions | env-reload | migrations-applied | migrate <версия> [имя] | recorder-upload <сборка> | maintenance <действие>" ;;
esac
