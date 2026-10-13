#!/bin/bash
# Шлюз раскатки Swarm на своём сервере (GarroV/Swarm-brain #919).
# Вызывается ТОЛЬКО принудительной командой ключа пользователя swarm-deploy:
#   command="sudo /opt/swarm-deploy/gate.sh" в ~swarm-deploy/.ssh/authorized_keys
# Что пришло после ssh — в SSH_ORIGINAL_COMMAND; разрешено ровно три действия:
#   functions                 — stdin: tar.gz каталога supabase/functions → в рантайм + перезапуск
#   migrations-applied        — список применённых версий миграций
#   migrate <версия>          — stdin: SQL миграции; накат одной транзакцией вместе с учётной записью
# Канон: GarroV/Swarm-brain deploy/server/gate.sh.
set -Eeuo pipefail
umask 077

STACK=/srv/swarm/supabase
FN="$STACK/volumes/functions"
KEEP=/var/backups/swarm-functions
DB=supabase-db
RUNTIME=supabase-edge-functions
PROBE=http://127.0.0.1:8400/functions/v1/swarm-recorder-version

die() { echo "gate: $*" >&2; exit 1; }
psql_() { docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }
# Миграции — от роли postgres, как в облаке Supabase: иначе владельцем новых объектов станет supabase_admin.
psql_mig() { docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

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
[ "${#ARGV[@]}" -le 3 ] || die "слишком много аргументов"
CMD="${ARGV[0]:-}"
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
    docker restart "$RUNTIME" >/dev/null
    for _ in $(seq 60); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$PROBE")" = 200 ] && { echo "функции выложены, рантайм отвечает (копия до раскатки: functions-$STAMP.tgz)"; exit 0; }
      sleep 2
    done
    die "рантайм не ответил за 2 минуты после перезапуска; откат: tar -xzf $KEEP/functions-$STAMP.tgz -C $FN && docker restart $RUNTIME"
    ;;
  migrations-applied)
    ensure_ledger
    psql_ -tA -c "select version from supabase_migrations.schema_migrations order by 1"
    ;;
  migrate)
    V="${ARGV[1]:-}"; NAME="${ARGV[2]:-}"
    [[ "$V" =~ ^[0-9]{8,14}$ ]] || die "версия миграции должна быть цифрами: '$V'"
    [[ -z "$NAME" || "$NAME" =~ ^[a-z0-9_]+$ ]] || die "имя миграции: только a-z0-9_"
    ensure_ledger
    if [ -n "$(psql_ -tA -c "select 1 from supabase_migrations.schema_migrations where version='$V'")" ]; then
      echo "миграция $V уже применена — пропускаю"; exit 0
    fi
    TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
    head -c 10485760 > "$TMP"
    [ -s "$TMP" ] || die "пустая миграция"
    { cat "$TMP"; printf '\n;insert into supabase_migrations.schema_migrations(version, name) values (%s, %s);\n' "'$V'" "'$NAME'"; } \
      | psql_mig --single-transaction -f - || die "миграция $V не применилась — транзакция откатена"
    echo "миграция $V применена"
    ;;
  *) die "неизвестная команда: '${CMD}'. Разрешено: functions | migrations-applied | migrate <версия> [имя]" ;;
esac
