#!/usr/bin/env bash
# Проверка команд recorder-upload и maintenance шлюза раскатки (deploy/server/gate.sh, issue #919) без сервера:
# отказы до любого обращения к хранилищу и логика «не перезаписывать» на подставном curl.
#   ./scripts/test-gate.sh           — прогнать проверки
#   ./scripts/test-gate.sh porcha    — порча: ломаем шлюз и убеждаемся, что проверки краснеют
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GATE=${GATE:-$ROOT/deploy/server/gate.sh}

if [ "${1:-}" = "porcha" ]; then
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  fail=0
  # имя порчи ~ что заменить (regex для sed) ~ на что
  while IFS='~' read -r name from to; do
    sed "s#$from#$to#" "$GATE" > "$T/g.sh"
    if cmp -s "$GATE" "$T/g.sh"; then echo "✘ порча «${name}» не применилась — прогон ложно зелёный"; fail=1; continue; fi
    if GATE="$T/g.sh" "$0" >"$T/out" 2>&1; then echo "✘ порча «${name}»: проверки остались зелёными"; fail=1
    else echo "✔ порча «${name}»: проверки покраснели ($(grep -m1 '✘' "$T/out"))"; fi
  done <<'LIST'
нет проверки начала~\[ "\$2" -ge "\$3" \] \&\& \[ "\$2" -le "\$4" \] || die~true
нет проверки цифр в аргументе~\^\[0-9\]{1,4}\$~^.{1,12}$
SQL не из переменных~select public.maintenance_announce(:lead, :dur, :'en', :'ru');~select public.maintenance_announce(${ARGV[2]}, ${ARGV[3]}, :'en', :'ru');
нет проверки zip~= 504b0304 ] || die~= 504b0304 ] || true
нет проверки цифр~\[0-9\]{1,9}~[0-9]{0,9}
env-reload без пересоздания~up -d --no-deps --force-recreate functions~restart supabase-edge-functions
нет ожидания рантайма~wait_runtime || die "рантайм не ответил за \$((PROBE_TRIES \* 2)) секунд после пересоздания~true || die "рантайм не ответил за \$((PROBE_TRIES \* 2)) секунд после пересоздания
перезапись отличающегося~die "$NAME уже лежит~echo "$NAME уже лежит
пропуск чужого имени миграции~\[ "$APPLIED_NAME" = "$NAME" \] || die~true || die
names инициализирует ledger вместо чистого SELECT~psql_ -tA -F~ensure_ledger; psql_ -tA -F
LIST
  exit $fail
fi

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/stack" "$T/store"
echo 'SERVICE_ROLE_KEY=sekret-key-value' > "$T/stack/.env"
# Подставной curl: GET публичного URL отдаёт файл из $T/store (404, если нет), POST кладёт тело в
# store (200) и пишет вызов в calls.
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
out=""; method=GET; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;; -X) method=$2; shift ;; --data-binary) data=${2#@}; shift ;;
    -w|-m|-K|-H) shift ;; -s) ;; *) url=$1 ;;
  esac; shift
done
name=${url##*/}
if [ "$method" = POST ]; then echo "POST $name" >> "$STORE/calls"; cp "$data" "$STORE/$name"; : > "$out"; printf 200; exit 0; fi
if [ -f "$STORE/$name" ]; then cp "$STORE/$name" "$out"; printf 200; else : > "$out"; printf 404; fi
STUB
chmod +x "$T/bin/curl"
# Подставной docker: пишет аргументы и stdin каждого вызова в $STORE/docker — по нему видно, что ушло в базу.
cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
{ echo "ARGS: $*"; cat; echo "---"; } >> "$STORE/docker"
case "$*" in
  *"select version, name from supabase_migrations.schema_migrations"*) cat "$STORE/ledger" ;;
  *"select version from supabase_migrations.schema_migrations"*) cut -f1 "$STORE/ledger" ;;
  *"where version='20261003130000'"*)
    [ ! -f "$STORE/ledger-fail" ] || exit 1
    if [ -s "$STORE/ledger" ]; then
      case "$*" in *"select 1 from"*) echo 1 ;; *) printf 'applied:%s\n' "$(cut -f2 "$STORE/ledger")" ;; esac
    fi ;;
esac
STUB
chmod +x "$T/bin/docker"

bad=0
# run <stdin-файл> <команда...> → $RC, $OUT
run() {
  local in=$1; shift
  OUT=$(SSH_ORIGINAL_COMMAND="$*" PATH="$T/bin:$PATH" STORE="$T/store" GATE_STACK="$T/stack" GATE_GW=http://gw \
    bash "$GATE" < "$in" 2>&1); RC=$?
}
expect() { # expect <имя> <rc: 0|nz> <подстрока вывода>
  local ok=1
  if [ "$2" = 0 ]; then [ "$RC" = 0 ] || ok=0; else [ "$RC" != 0 ] || ok=0; fi
  [ -z "$3" ] || printf '%s' "$OUT" | grep -qF -- "$3" || ok=0
  if [ "$ok" = 1 ]; then echo "✔ $1"; else echo "✘ $1 (код $RC, вывод: $OUT)"; bad=1; fi
}

printf 'PK\003\004zipbody' > "$T/good.zip"
printf 'PK\003\004other' > "$T/other.zip"
printf 'not a zip' > "$T/bad.zip"
: > "$T/empty.zip"
{ printf 'PK\003\004'; head -c 104857600 /dev/zero; } > "$T/huge.zip"

run "$T/good.zip" recorder-upload 12a;            expect "номер сборки не из цифр — отказ" nz "только цифры"
run "$T/good.zip" recorder-upload;                expect "номер сборки не передан — отказ" nz "только цифры"
run "$T/good.zip" recorder-upload 1 2 3;          expect "больше трёх аргументов — отказ" nz "слишком много"
run "$T/empty.zip" recorder-upload 1;             expect "пустой архив — отказ" nz "пустой архив"
run "$T/bad.zip" recorder-upload 1;               expect "не zip — отказ" nz "не zip"
run "$T/huge.zip" recorder-upload 1;              expect "архив больше 100 МБ — отказ" nz "больше 100"
[ ! -e "$T/store/calls" ] && echo "✔ отказы не дошли до хранилища" || { echo "✘ отказ дошёл до хранилища"; bad=1; }

run "$T/good.zip" recorder-upload 7;              expect "новая сборка — загружена, сумма напечатана" 0 "sha256 $(shasum -a 256 "$T/good.zip" | cut -d' ' -f1)"
cmp -s "$T/good.zip" "$T/store/SwarmRecorder-7.zip" && echo "✔ в хранилище лежит присланное" || { echo "✘ в хранилище не то"; bad=1; }
printf '%s' "$OUT" | grep -q sekret && { echo "✘ ключ попал в вывод"; bad=1; } || echo "✔ ключ не в выводе"
run "$T/good.zip" recorder-upload 7;              expect "повтор того же — «уже загружен»" 0 "уже загружен"
[ "$(grep -c POST "$T/store/calls")" = 1 ] && echo "✔ повтор не заливал второй раз" || { echo "✘ повтор залил снова"; bad=1; }
run "$T/other.zip" recorder-upload 7;             expect "другое содержимое под тем же номером — отказ" nz "ОТЛИЧАЕТСЯ"
cmp -s "$T/good.zip" "$T/store/SwarmRecorder-7.zip" && echo "✔ существующий объект не тронут" || { echo "✘ существующий объект перезаписан"; bad=1; }


# ── maintenance: плашка и заморозка (#978) ────────────────────────────────────────────────────
: > "$T/none"
D="$T/store/docker"
run "$T/none" maintenance;                              expect "maintenance без действия — отказ" nz "неизвестное действие"
run "$T/none" maintenance drop;                         expect "неизвестное действие — отказ" nz "неизвестное действие"
run "$T/none" maintenance announce "1;droptable" 5; expect "announce: SQL вместо числа — отказ" nz "целое число цифрами"
run "$T/none" maintenance announce 1 "5;select1";      expect "announce: SQL в длительности — отказ" nz "целое число цифрами"
run "$T/none" maintenance announce -1 5;                expect "announce: отрицательное начало — отказ" nz "целое число цифрами"
run "$T/none" maintenance announce 1 0;                 expect "announce: нулевая длительность — отказ" nz "от 1 до 180"
run "$T/none" maintenance announce 1 181;               expect "announce: длительность больше 180 — отказ" nz "от 1 до 180"
run "$T/none" maintenance announce 1441 5;              expect "announce: начало дальше суток — отказ" nz "от 0 до 1440"
run "$T/none" maintenance announce 1;                   expect "announce без длительности — отказ" nz "целое число цифрами"
run "$T/none" maintenance announce 1 5 6;               expect "announce с лишним аргументом — отказ" nz "слишком много"
run "$T/none" maintenance notice abc;                   expect "notice: не число — отказ" nz "целое число цифрами"
run "$T/none" maintenance cancel x y z w;               expect "maintenance с пятью словами — отказ" nz "слишком много"
[ ! -e "$D" ] && echo "✔ отказы не дошли до базы" || { echo "✘ отказ дошёл до базы: $(cat "$D")"; bad=1; }

printf 'Работы с 23:00\nMaintenance at 23:00\n' > "$T/texts"
run "$T/texts" maintenance announce 15 40;              expect "announce: принят" 0 ""
grep -q -- '-v lead=15 -v dur=40' "$D" && echo "✔ в базу ушли проверенные числа" || { echo "✘ числа не дошли: $(cat "$D")"; bad=1; }
grep -qF -- '-v ru=Работы с 23:00 -v en=Maintenance at 23:00' "$D" && echo "✔ тексты ушли переменными psql" || { echo "✘ тексты не дошли: $(cat "$D")"; bad=1; }
grep -qF 'public.maintenance_announce(:lead, :dur' "$D" && echo "✔ SQL зашит в шлюз" || { echo "✘ SQL не тот"; bad=1; }
printf "x'); drop table users; --\n" > "$T/evil"
: > "$D"
run "$T/evil" maintenance announce 0 1
grep -q 'drop table users' "$D" && ! grep -v '^ARGS' "$D" | grep -q 'drop table users' \
  && echo "✔ чужой текст не попал в тело SQL" || { echo "✘ чужой текст оказался в SQL: $(cat "$D")"; bad=1; }
: > "$D"
run "$T/none" maintenance cancel;                       expect "cancel: принят" 0 ""
grep -qF 'maintenance_cancel()' "$D" && echo "✔ cancel зовёт maintenance_cancel" || { echo "✘ cancel не дошёл"; bad=1; }
run "$T/none" maintenance status;                       expect "status: принят" 0 ""
grep -qF "key = 'maintenance'" "$D" && echo "✔ status читает строку заморозки" || { echo "✘ status не дошёл"; bad=1; }

# ── env-reload: пересоздание рантайма (#1032) ─────────────────────────────────────────────────
: > "$T/store/swarm-recorder-version"   # проба рантайма отвечает 200
: > "$D"
run "$T/none" env-reload;                               expect "env-reload: принят, пробу дождался" 0 "functions.env перечитан"
grep -qF 'compose -p swarm' "$D" && grep -qF -- "-f $T/stack/docker-compose.swarm.yml" "$D" && grep -qF 'up -d --no-deps --force-recreate functions' "$D" \
  && echo "✔ env-reload пересоздаёт сервис functions проекта swarm" || { echo "✘ env-reload не пересоздал: $(cat "$D")"; bad=1; }
grep -q 'ARGS: restart' "$D" && { echo "✘ env-reload ограничился рестартом"; bad=1; } || echo "✔ env-reload без docker restart"
rm "$T/store/swarm-recorder-version"
OUT=$(SSH_ORIGINAL_COMMAND="env-reload" PATH="$T/bin:$PATH" STORE="$T/store" GATE_STACK="$T/stack" GATE_GW=http://gw \
  GATE_PROBE_TRIES=1 bash "$GATE" </dev/null 2>&1); RC=$?
[ "$RC" != 0 ] && printf '%s' "$OUT" | grep -qF "рантайм не ответил" \
  && echo "✔ env-reload: рантайм молчит — понятный отказ" || { echo "✘ env-reload не отказал при молчащем рантайме (код $RC: $OUT)"; bad=1; }

# ── номер + имя миграции (#775), без настоящего SQL ──────────────────────────────────────────
printf '20261003130000\toriginal\n' > "$T/store/ledger"
printf 'select 42;\n' > "$T/migration.sql"
run "$T/migration.sql" migrate 20261003140000
expect "без имени нельзя завести неподдающуюся сверке строку ledger" nz "имя"
run "$T/none" migrations-applied
expect "старый список миграций остаётся списком версий" 0 "20261003130000"
[[ "$OUT" != *original* ]] || { echo "✘ default migrations-applied изменил формат"; bad=1; }
: > "$D"
run "$T/none" migrations-applied names
expect "новый список содержит номер и имя" 0 $'20261003130000\toriginal'
if grep -qE 'create schema|grant usage|grant select' "$D"; then echo "✘ names исполнил DDL/GRANT вместо чистого чтения"; bad=1;
else echo "✔ names — только SELECT существующего ledger"; fi
run "$T/migration.sql" migrate 20261003130000 original
expect "совпадающая пара — идемпотентный пропуск" 0 "уже применена"
: > "$D"
run "$T/migration.sql" migrate 20261003130000 collision
expect "применён тот же номер с другим именем — отказ" nz "original"
if grep -qF 'select 42;' "$D"; then echo "✘ коллизия дошла до SQL"; bad=1; else echo "✔ коллизия не исполнила SQL"; fi
: > "$D"; : > "$T/store/ledger-fail"
run "$T/migration.sql" migrate 20261003130000 original
expect "не удалось прочитать имя — отказ до SQL" nz "миграц"
if grep -qF 'select 42;' "$D"; then echo "✘ ошибка ledger дошла до SQL"; bad=1; else echo "✔ ошибка ledger не исполнила SQL"; fi
rm "$T/store/ledger-fail"
run "$T/migration.sql" migrate 20261003140000 next
expect "новая версия — применяется" 0 "применена"
grep -qF 'select 42;' "$D" && echo "✔ новая миграция дошла до транзакции" || { echo "✘ новая миграция потеряла SQL"; bad=1; }

exit $bad
