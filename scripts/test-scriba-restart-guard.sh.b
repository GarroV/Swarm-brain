#!/usr/bin/env bash
# wait_for_meetings из scriba-prod/stand.sh на подставном счётчике встреч (issue #1143):
# при живых встречах up ждёт и отказывает по потолку, FORCE_DURING_MEETINGS=1 обходит, при нуле
# не ждёт. Запуск: ./scripts/test-scriba-restart-guard.sh [путь к stand.sh | porcha]; porcha — на испорченной копии.
set -uo pipefail
TEST_DIR=$(cd "$(dirname "$0")" && pwd)
SRC=$TEST_DIR/scriba-prod/stand.sh
if [ "${1:-}" = "porcha" ]; then
  # Два испорченных стенда: без ожидания и без обхода. Каждый обязан красить проверку.
  P=$(mktemp -d); trap 'rm -rf "$P"' EXIT
  sed 's/^  \[ "\$n" -gt 0 \] || return 0$/  return 0/' "$SRC" > "$P/a.sh"
  sed 's/= "1" \]; then$/= "x" ]; then/' "$SRC" > "$P/b.sh"
  for f in a b; do
    cmp -s "$P/$f.sh" "$SRC" && { echo "✘ порча $f не применилась"; exit 2; }
    if "$0" "$P/$f.sh" >"$P/out" 2>&1; then echo "✘ порча $f не покрашена: проверка зелёная"; exit 1; fi
    echo "✔ порча $f краснеет: $(grep -m1 '✘' "$P/out")"
  done
  exit 0
fi
[ -z "${1:-}" ] || SRC=$1
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
say() { echo "$*"; }
die() { echo "DIE: $*"; exit 1; }
sleep() { :; }
eval "$(sed -n '/^wait_for_meetings() {/,/^}/p' "$SRC")"
# shellcheck disable=SC2034
WAIT_POLL_SECONDS=30
# Подставной счёт: берёт значения из файла по очереди, последнее повторяет.
meetings_running() {
  local v; v=$(head -1 "$T/seq")
  [ "$(wc -l < "$T/seq")" -le 1 ] || sed -i.bak 1d "$T/seq"
  echo "$v"
}
fail() { echo "✘ $*"; exit 1; }
run() { ( "$@" ) 2>&1; }

printf '0\n' > "$T/seq"; WAIT_MAX_SECONDS=100
out=$(run wait_for_meetings) || fail "при нуле встреч не должен отказывать: $out"
echo "$out" | grep -q 'жду' && fail "при нуле встреч не должен ждать"

printf '2\n2\n1\n0\n' > "$T/seq"
out=$(run wait_for_meetings) || fail "должен дождаться: $out"
echo "$out" | grep -q 'жду окончания 2 встреч' || fail "нет строки ожидания: $out"
echo "$out" | grep -q 'встреч не осталось' || fail "нет строки об окончании: $out"

# shellcheck disable=SC2034
printf '1\n' > "$T/seq"; WAIT_MAX_SECONDS=90
out=$(run wait_for_meetings) && fail "по потолку должен отказать: $out"
echo "$out" | grep -q 'DIE: за 90 с встречи не кончились' || fail "нет причины отказа: $out"

printf '1\n' > "$T/seq"
out=$(FORCE_DURING_MEETINGS=1 run wait_for_meetings) || fail "обход не сработал: $out"
echo "$out" | grep -q 'FORCE_DURING_MEETINGS=1' || fail "обход без предупреждения: $out"
echo "✔ ожидание встреч перед перезапуском: ждёт, отказывает по потолку, обход работает"
