#!/usr/bin/env bash
# Проверка сторожа общего тестового стенда (scripts/lib/stand-guard.sh) на фикстурах: списки версий
# подставные, ни сервер, ни git не нужны.
#
#   scripts/test-stand-guard.sh           — прогнать случаи на настоящей библиотеке
#   scripts/test-stand-guard.sh porcha    — ещё и порча: испортить копию библиотеки несколькими
#                                           способами и убедиться, что прогон КРАСНЕЕТ на каждой
#                                           (и что порча применилась)
#   GUARD_LIB=<путь> scripts/test-stand-guard.sh — прогнать на другой копии библиотеки
#
# Вопрос, на который отвечает: заметит ли сторож стенд, разошедшийся с main (issue #998).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LIB="${GUARD_LIB:-$ROOT/scripts/lib/stand-guard.sh}"
FAILS=0
ok()   { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }

# plan <main> <ledger> <branch> — версии через пробел; печатает план одной строкой.
plan() {
  local tmp; tmp=$(mktemp -d)
  printf '%s\n' $1 | sort -u > "$tmp/main"
  printf '%s\n' $2 | sort -u > "$tmp/ledger"
  printf '%s\n' $3 | sort -u > "$tmp/branch"
  # shellcheck source=/dev/null
  ( . "$LIB"; stand_plan "$tmp/main" "$tmp/ledger" "$tmp/branch" ) | tr '\n' ';'
  rm -rf "$tmp"
}
expect() { # название, ожидаемый план, main, ledger, branch
  local got; got=$(plan "$3" "$4" "$5")
  if [ "$got" = "$2" ]; then ok "$1"; else fail "$1: план «$got», ждали «$2»"; fi
}

run_cases() {
  expect "стенд = main: находок нет" "" "1 2 3" "1 2 3" "1 2 3"
  expect "ветка равна main: находок нет" "" "1 2 3" "1 2 3" "1 2 3"
  expect "стенд отстаёт на две миграции main" "MISSING_MAIN 2;MISSING_MAIN 3;" "1 2 3" "1" "1 2 3"
  expect "миграция ветки не на стенде" "MISSING_BRANCH 4;" "1 2 3" "1 2 3" "1 2 3 4"
  expect "миграция ветки на стенде (после --branch): можно" "" "1 2 3" "1 2 3 4" "1 2 3 4"
  expect "накат руками, которого нет ни в main, ни в ветке" "FOREIGN 9;" "1 2 3" "1 2 3 9" "1 2 3"
  expect "чужая ветка на стенде, моя ветка без неё" "FOREIGN 4;" "1 2 3" "1 2 3 4" "1 2 3"
  expect "ветка старее main: main-миграции в ней нет — не чужое" "" "1 2 3" "1 2 3" "1 2"
  expect "отстаёт и одновременно чужое" "MISSING_MAIN 3;FOREIGN 9;" "1 2 3" "1 2 9" "1 2"

  local v rc
  v=$( . "$LIB"; printf '%s\n' supabase/migrations/20260901000000_a.sql supabase/migrations/_template_new_table.sql \
    supabase/migrations/20260927120000_b.sql README.md | stand_versions 2>/dev/null; echo "rc=$?")
  if [ "$v" = $'20260901000000\n20260927120000\nrc=0' ]; then ok "версии: шаблон и не-sql пропущены"; else fail "версии: «$v»"; fi
  if ( . "$LIB"; printf '%s\n' supabase/migrations/oops.sql | stand_versions >/dev/null 2>&1 ); then
    fail "файл миграции без версии пропущен молча"
  else
    ok "файл миграции без версии — ошибка, не пропуск"
  fi
}

run_cases
[ "$FAILS" -eq 0 ] || { echo "stand-guard: $FAILS случаев красные"; exit 1; }

if [ "${1:-}" = "porcha" ]; then
  echo "порча сторожа:"
  BROKEN=0
  corrupt() { # название, что заменить, на что
    local copy; copy=$(mktemp)
    FROM="$2" TO="$3" perl -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$LIB" > "$copy"
    if cmp -s "$copy" "$LIB"; then fail "порча «$1» не применилась (подстановка ничего не изменила)"; rm -f "$copy"; return; fi
    if GUARD_LIB="$copy" "$0" >/dev/null 2>&1; then
      fail "порча «$1»: прогон остался зелёным — сторож этого не проверяет"
      BROKEN=1
    else
      ok "порча «$1»: прогон покраснел"
    fi
    rm -f "$copy"
  }
  corrupt "чужие миграции не ловятся" "comm -13 <(sort -u \"\$main\" \"\$branch\") \"\$ledger\"" "true"
  corrupt "отставание от main не ловится" 'comm -23 "$main" "$ledger" | sed' 'true | sed'
  corrupt "миграции ветки не ловятся" 'comm -23 <(comm -23 "$branch" "$main") "$ledger"' 'true'
  corrupt "шаблон считается миграцией" "''|_*) continue ;;" "'') continue ;;"
  [ "$FAILS" -eq 0 ] || exit 1
fi
exit "$FAILS"
