#!/usr/bin/env bash
# Проверка changed_functions из deploy-window.sh: правка общего модуля, который импортируется
# только другим общим модулем, обязана тянуть функции-потребители (issue #292).
# Запуск: ./scripts/test-deploy-window.sh [путь к deploy-window.sh]
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)/deploy-window.sh
SRC=${1:-$SRC}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
eval "$(sed -n '/^changed_functions() {/,/^}/p' "$SRC")"
cd "$T" && git init -q && git config user.email t@t && git config user.name t
mkdir -p supabase/functions/_shared/tasks supabase/functions/fn-a supabase/functions/fn-b
echo 'export const h = 1;' > supabase/functions/_shared/tasks/history.ts
echo 'import { h } from "./history.ts"; export const d = h;' > supabase/functions/_shared/tasks/db.ts
echo 'import { d } from "../_shared/tasks/db.ts";' > supabase/functions/fn-a/index.ts
echo 'export {};' > supabase/functions/fn-b/index.ts
git add -A && git commit -qm base
echo 'export const h = 2;' > supabase/functions/_shared/tasks/history.ts
git commit -qam change
GOT=$(changed_functions HEAD~1 | tr '\n' ' ')
if [ "$GOT" != "fn-a " ]; then
  echo "✘ правка _shared/tasks/history.ts (через _shared/tasks/db.ts) должна дать «fn-a», получено: «${GOT}»"
  exit 1
fi
echo "✔ транзитивный потребитель найден: ${GOT}"

# Сверка с продом (issue #243): функция, раскатанная ПОСЛЕ последней правки, помечается
# «уже на проде»; раскатанная ДО — нет.
eval "$(sed -n '/^prod_functions_json() {/,/^}/p;/^annotate_functions() {/,/^}/p' "$SRC")"
LAST=$(git log -1 --format=%ct)
printf '[{"slug":"fn-a","updated_at":%s},{"slug":"fn-b","updated_at":%s}]' \
  "$(( (LAST + 60) * 1000 ))" "$(( (LAST - 60) * 1000 ))" > "$T/prod.json"
OUT=$(PROD_FUNCTIONS_JSON_FILE="$T/prod.json" annotate_functions HEAD~1 $'fn-a\nfn-b')
if ! printf '%s\n' "$OUT" | grep -q '· fn-a — уже на проде'; then
  echo "✘ fn-a раскатана после правки — должна быть помечена «уже на проде», получено: ${OUT}"
  exit 1
fi
if printf '%s\n' "$OUT" | grep -q '· fn-b — уже на проде'; then
  echo "✘ fn-b раскатана до правки — пометки «уже на проде» быть не должно, получено: ${OUT}"
  exit 1
fi
echo "✔ сверка с продом: раскатанная после правки помечена, раскатанная до — нет"
