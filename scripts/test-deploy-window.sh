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
