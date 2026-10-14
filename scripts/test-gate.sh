#!/usr/bin/env bash
# Проверка команды recorder-upload шлюза раскатки (deploy/server/gate.sh, issue #919) без сервера:
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
нет проверки zip~= 504b0304 ] || die~= 504b0304 ] || true
нет проверки цифр~\[0-9\]{1,9}~[0-9]{0,9}
перезапись отличающегося~die "$NAME уже лежит~echo "$NAME уже лежит
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
  printf '%s' "$OUT" | grep -qF -- "$3" || ok=0
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

exit $bad
