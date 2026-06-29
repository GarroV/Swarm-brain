#!/usr/bin/env bash
# doc-inventory.sh — собирает «code-mirroring» инвентари ИЗ КОДА (источник правды), чтобы
# сверить с таблицами в docs/ и поймать дрифт. НЕ редактирует доки — только печатает markdown.
#
# Зачем: эндпоинты / env / edge-функции / таблицы БД быстрее всего расходятся с докой.
# Запускать перед крупным мёржем или при drift-аудите (скилл keeping-docs-current):
#   ./scripts/doc-inventory.sh            # всё
#   ./scripts/doc-inventory.sh endpoints  # один раздел: endpoints|env|functions|tables|callbacks
#
# Сверять с: QUICK_REF.md (🧭 индекс) и ARCHITECTURE.md (§swarm-api / §Переменные окружения /
# §Таблицы БД / §Callback-коды). Расхождение = или код не задокументирован, или дока устарела.

set -euo pipefail
cd "$(dirname "$0")/.."
FN=supabase/functions
SECTION="${1:-all}"

want() { [ "$SECTION" = "all" ] || [ "$SECTION" = "$1" ]; }

if want endpoints; then
  echo "## swarm-api endpoints (из routePath в swarm-api/index.ts)"
  grep -oE 'routePath === "[^"]+"|routePath\.match\(/\^[^)]+' "$FN/swarm-api/index.ts" \
    | sed -E 's/routePath === "([^"]+)"/\1/; s#routePath\.match\(/\^##; s#\\##g' \
    | sort -u | sed 's/^/- /'
  echo
fi

if want env; then
  echo "## ENV (Deno.env.get по всем edge-функциям)"
  grep -rhoE 'Deno\.env\.get\("[^"]+"\)' "$FN" --include='*.ts' \
    | sed -E 's/Deno\.env\.get\("([^"]+)"\)/\1/' | sort -u | sed 's/^/- /'
  echo
fi

if want functions; then
  echo "## Edge Functions (каталоги $FN/, кроме _shared)"
  ls -1 "$FN" | grep -vE '^(_|deno\.json$)' | sort | sed 's/^/- /'
  echo
fi

if want tables; then
  echo "## Таблицы БД (из .from(\"...\") по всем функциям)"
  grep -rhoE '\.from\("[a-z_]+"\)' "$FN" --include='*.ts' \
    | sed -E 's/\.from\("([a-z_]+)"\)/\1/' | sort -u | sed 's/^/- /'
  echo
fi

if want callbacks; then
  echo "## Callback/session-префиксы бота (startsWith в swarm-bot)"
  grep -rhoE 'startsWith\("[a-z_]+' "$FN/swarm-bot" --include='*.ts' \
    | sed -E 's/startsWith\("//' | sort -u | sed 's/^/- /'
  echo
fi
