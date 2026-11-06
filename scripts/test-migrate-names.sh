#!/usr/bin/env bash
# Регрессии #775: настоящий клиент наката, временные SQL-файлы и подставной SSH.
# Ни сети, ни базы: writes показывает, дошёл ли хоть один SQL до команды migrate.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts/lib" "$T/supabase/migrations" "$T/bin"
cp "${MIGRATE_SCRIPT:-$ROOT/scripts/migrate-server.sh}" "$T/scripts/migrate-server.sh"
cp "${GATE_LIB:-$ROOT/scripts/lib/migrations-gate.sh}" "$T/scripts/lib/migrations-gate.sh"
cp "$ROOT/scripts/lib/swarm-server.sh" "$T/scripts/lib/swarm-server.sh"
: > "$T/key"
cat > "$T/bin/ssh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *' migrations-applied names')
    if [ "${NAMES_SUPPORTED:-1}" = 1 ]; then cat "$FIXTURE/ledger"; else cut -f1 "$FIXTURE/ledger"; fi ;;
  *' migrations-applied') cut -f1 "$FIXTURE/ledger" ;;
  *' migrate '*) printf '%s\n' "$*" >> "$FIXTURE/writes"; cat >> "$FIXTURE/sql" ;;
  *) exit 99 ;;
esac
STUB
chmod +x "$T/bin/ssh"
bad=0
run() {
  OUT=$(cd "$T" && FIXTURE="$T" PATH="$T/bin:$PATH" SWARM_DEPLOY_KEY_FILE="$T/key" \
    SWARM_DEPLOY_HOST=fixture.invalid bash scripts/migrate-server.sh "$@" 2>&1); RC=$?
}
expect() {
  local ok=1
  if [ "$2" = 0 ]; then [ "$RC" = 0 ] || ok=0; else [ "$RC" != 0 ] || ok=0; fi
  [ -z "$3" ] || [[ "$OUT" == *"$3"* ]] || ok=0
  if [ "$ok" = 1 ]; then echo "✔ $1"; else echo "✘ $1 (код $RC: $OUT)"; bad=1; fi
}
no_writes() {
  if [ ! -s "$T/writes" ]; then echo "✔ $1: SQL не отправлен"; else echo "✘ $1: SQL уже отправлен"; bad=1; fi
}
reset_files() { rm -f "$T"/supabase/migrations/*.sql "$T/writes" "$T/sql"; }

printf '20261003130000\toriginal\n' > "$T/ledger"
echo 'select 1;' > "$T/supabase/migrations/20261003130000_collision.sql"
run --dry-run; expect "другая миграция под применённым номером — отказ dry-run" nz "20261003130000"
run; expect "другая миграция под применённым номером — отказ наката" nz "collision"
no_writes "коллизия имени"

# Полный preflight до ПЕРВОЙ записи: ранняя новая миграция не должна уехать до поздней коллизии.
echo 'select 2;' > "$T/supabase/migrations/20261003120000_new.sql"
run; expect "вся пачка проверяется до первого SQL" nz "original"
no_writes "preflight пачки"

reset_files
echo 'select 1;' > "$T/supabase/migrations/20261003130000_original.sql"
run; expect "совпали номер и имя — идемпотентный пропуск" 0 "Неприменённых миграций нет"
no_writes "совпадающая пара"
NAMES_SUPPORTED=0 run; expect "старый шлюз без имён — понятный отказ" nz "им"
no_writes "старый протокол"

reset_files
printf '20261003130000\toriginal\n20261003130000\tcollision\n' > "$T/ledger"
echo 'select 1;' > "$T/supabase/migrations/20261003130000_collision.sql"
run; expect "две несовместимые строки ledger — отказ, а не последняя побеждает" nz "ledger"
no_writes "неоднозначный ledger"
printf '20261003130000\toriginal\n' > "$T/ledger"

reset_files
echo 'select 2;' > "$T/supabase/migrations/20261003140000_first.sql"
echo 'select 3;' > "$T/supabase/migrations/20261003140000_second.sql"
run; expect "один локальный номер у двух файлов — отказ до SQL" nz "20261003140000"
no_writes "локальный дубликат номера"

reset_files
echo 'select 2;' > "$T/supabase/migrations/20261003140000_next.sql"
run --dry-run; expect "новая пара видна в dry-run" 0 "20261003140000_next.sql"
no_writes "dry-run новой пары"
run; expect "новая пара накатывается" 0 "накачено миграций — 1"
if [ "$(wc -l < "$T/writes" | tr -d ' ')" = 1 ] && grep -q 'migrate 20261003140000 next' "$T/writes" \
  && grep -q 'select 2' "$T/sql"; then echo "✔ отправлены точные номер, имя и SQL"; else echo "✘ отправлены неверные миграции"; bad=1; fi
exit "$bad"
