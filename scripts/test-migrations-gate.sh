#!/usr/bin/env bash
# Проверка гейта миграций ночной раскатки (scripts/lib/migrations-gate.sh) на фикстурах:
# временный git-репозиторий с main, меткой prod-deployed и ветками PR, ответ Management API —
# подставной (MIGRATIONS_API_JSON), сеть не нужна.
#
#   scripts/test-migrations-gate.sh           — прогнать случаи на настоящей библиотеке
#   scripts/test-migrations-gate.sh porcha    — ещё и порча: испортить копию библиотеки
#                                               несколькими способами и убедиться, что прогон
#                                               КРАСНЕЕТ на каждой (и что порча применилась)
#   GATE_LIB=<путь> scripts/test-migrations-gate.sh — прогнать на другой копии библиотеки
#
# Зовёт CI (job «Скрипты раскатки»). Вопрос, на который отвечает: не вольёт ли автоматика PR,
# с которым код уедет раньше схемы (issues #444, #557).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LIB="${GATE_LIB:-$ROOT/scripts/lib/migrations-gate.sh}"
FAILS=0

ok()   { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }

# expect <название> <ожидаемый код> <ожидаемый кусок причины или ""> <команда...>
expect() {
  local name="$1" want_rc="$2" want_text="$3"; shift 3
  local rc=0
  "$@" || rc=$?
  if [ "$rc" != "$want_rc" ]; then
    fail "$name: код $rc, ждали $want_rc (причина: ${GATE_REASON:-—}; план: ${GATE_PLAN:-—})"
    return
  fi
  if [ -n "$want_text" ] && [[ "${GATE_REASON}${GATE_PLAN}" != *"$want_text"* ]]; then
    fail "$name: код верный, но в причине/плане нет «$want_text» (причина: ${GATE_REASON:-—}; план: ${GATE_PLAN:-—})"
    return
  fi
  ok "$name"
}

run_cases() {
  local tmp; tmp=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  (
    set -e
    cd "$tmp"
    git init -q -b main .
    git config user.email t@t; git config user.name t
    mkdir -p supabase/migrations supabase/functions/x
    echo "create table a();" > supabase/migrations/20260901000000_a.sql
    echo "x" > supabase/functions/x/index.ts
    git add -A; git commit -qm base
    git tag prod-deployed

    # PR без миграций.
    git checkout -q -b pr-code main
    echo "y" >> supabase/functions/x/index.ts; git commit -qam code
    # PR с новой миграцией.
    git checkout -q -b pr-migr main
    echo "alter table a add column b int;" > supabase/migrations/20260927120000_b.sql
    echo "z" >> supabase/functions/x/index.ts; git add -A; git commit -qm migr
    # PR, правящий уже существующую миграцию.
    git checkout -q -b pr-edit main
    echo "-- правка" >> supabase/migrations/20260901000000_a.sql; git commit -qam edit
    # PR, удаляющий существующую миграцию.
    git checkout -q -b pr-del main
    git rm -q supabase/migrations/20260901000000_a.sql; git commit -qm del
    # Миграция без версии в имени.
    git checkout -q -b pr-noversion main
    echo "select 1;" > supabase/migrations/fix_something.sql; git add -A; git commit -qm nov

    # main, в который РУКАМИ влили PR с миграцией (после prod-deployed) — случай #557.
    git checkout -q -b main-dirty main
    echo "alter table a add column c int;" > supabase/migrations/20260928000000_c.sql
    git add -A; git commit -qm "manual merge with migration"
    git checkout -q -b pr-code-on-dirty main-dirty
    echo "w" >> supabase/functions/x/index.ts; git commit -qam code2
    git checkout -q main
  ) || { fail "фикстура не собралась"; return; }

  (
    cd "$tmp" || exit 1
    # shellcheck source=lib/migrations-gate.sh
    . "$LIB"
    FAILS=0
    applied_a='[{"version":"20260901000000","name":"a"}]'
    applied_ab='[{"version":"20260901000000"},{"version":"20260927120000"}]'
    applied_ac='[{"version":"20260901000000"},{"version":"20260928000000"}]'

    MIGRATIONS_API_JSON="$applied_a"
    expect "PR без миграций — вливать"                    0 "миграций нет" pr_migrations_gate main pr-code prod-deployed
    expect "PR с ненакатанной миграцией — НЕ вливать"     1 "20260927120000_b.sql" pr_migrations_gate main pr-migr prod-deployed
    expect "причина отказа зовёт кнопку миграций"         1 "deploy-migrations.yml" pr_migrations_gate main pr-migr prod-deployed
    MIGRATIONS_API_JSON="$applied_ab"
    expect "PR с миграцией, уже накатанной кнопкой — вливать" 0 "на проде применены" pr_migrations_gate main pr-migr prod-deployed
    MIGRATIONS_API_JSON="$applied_a"
    expect "PR правит существующую миграцию — НЕ вливать" 1 "20260901000000_a.sql" pr_migrations_gate main pr-edit prod-deployed
    expect "PR удаляет существующую миграцию — НЕ вливать" 1 "существующий файл" pr_migrations_gate main pr-del prod-deployed
    expect "миграция без версии в имени — НЕ вливать"     1 "fix_something.sql" pr_migrations_gate main pr-noversion prod-deployed
    expect "в main уже лежит ненакатанная — НЕ вливать даже PR без миграций" 1 "20260928000000_c.sql" pr_migrations_gate main-dirty pr-code-on-dirty prod-deployed
    MIGRATIONS_API_JSON="$applied_ac"
    expect "в main миграция накатана — вливать"           0 "на проде применены" pr_migrations_gate main-dirty pr-code-on-dirty prod-deployed
    MIGRATIONS_API_JSON="не json"
    expect "ответ API не разобрать — НЕ вливать (проверить нечем)" 3 "проверить их на проде нечем" pr_migrations_gate main pr-migr prod-deployed
    expect "ответ API не нужен, если миграций нет"        0 "" pr_migrations_gate main pr-code prod-deployed
    unset MIGRATIONS_API_JSON
    SUPABASE_ACCESS_TOKEN="" expect "нет токена — НЕ вливать (проверить нечем)" 3 "нечем" pr_migrations_gate main pr-migr prod-deployed
    MIGRATIONS_API_JSON="$applied_a"
    expect "нет метки prod-deployed, а миграция есть — НЕ вливать" 3 "нет метки" pr_migrations_gate main pr-migr no-such-tag
    expect "голова PR не найдена — НЕ вливать"            3 "" pr_migrations_gate main no-such-branch prod-deployed
    exit "$FAILS"
  )
  FAILS=$((FAILS + $?))
}

echo "Гейт миграций ночной раскатки — $(basename "$LIB")"
run_cases

if [ "${1:-}" = "porcha" ]; then
  echo
  echo "Порча: каждая испорченная копия обязана покраснеть"
  # описание | perl-подстановка. Каждая — отдельная дыра, которую гейт обязан ловить.
  MUTATIONS=(
    'неприменённые считаются применёнными|s/if not m or m.group\(1\) not in done:/if False:/'
    'новые миграции PR не видны|s/--diff-filter=A "\$1\.\.\$2"/--diff-filter=X "\$1..\$2"/'
    'правка старых миграций не видна|s/--diff-filter=MDT/--diff-filter=X/'
    'миграции main не проверяются|s/main_new=\$\(added_migrations "\$base_tag" "\$main_ref"\) \|\| main_new=""/main_new=""/'
    '«проверить нечем» пропускается как «можно»|s/\*\) GATE_REASON=/*) return 0; GATE_REASON=/'
  )
  PORCHA_FAILED=0
  for m in "${MUTATIONS[@]}"; do
    desc="${m%%|*}"; expr="${m#*|}"
    broken=$(mktemp)
    perl -0pe "$expr" "$LIB" > "$broken"
    if cmp -s "$LIB" "$broken"; then
      echo "порча  ОТКАЗ    «${desc}» — подстановка ничего не изменила, проверка недействительна"
      PORCHA_FAILED=1; rm -f "$broken"; continue
    fi
    if GATE_LIB="$broken" "$0" >/dev/null 2>&1; then
      echo "порча  ДЫРА     «${desc}» — испорченная копия прошла зелёной"
      PORCHA_FAILED=1
    else
      echo "порча  поймана  «${desc}»"
    fi
    rm -f "$broken"
  done
  [ "$PORCHA_FAILED" = "0" ] || { echo "Порча гейта миграций: есть дыры или недействительные мутации."; exit 1; }
fi

if [ "$FAILS" -gt 0 ]; then
  echo "Гейт миграций: провалено случаев — $FAILS"
  exit 1
fi
echo "Гейт миграций: все случаи прошли."
