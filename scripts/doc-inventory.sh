#!/usr/bin/env bash
# doc-inventory.sh — собирает «code-mirroring» инвентари ИЗ КОДА (источник правды), чтобы
# сверить с таблицами в docs/ и поймать дрифт. НЕ редактирует доки — только печатает markdown.
#
# Зачем: эндпоинты / env / edge-функции / таблицы БД быстрее всего расходятся с докой.
# Запускать перед крупным мёржем или при drift-аудите (скилл keeping-docs-current):
#   ./scripts/doc-inventory.sh            # всё
#   ./scripts/doc-inventory.sh endpoints  # один раздел: endpoints|env|functions|tables|callbacks|dups
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

if want dups; then
  echo "## Дубли строк в таблицах docs/ (один файл описан дважды — источник дрифта)"
  # Ключ строки — первая колонка в обратных кавычках. Две строки с одним ключом В ОДНОЙ таблице
  # гарантированно расходятся: следующая правка уходит в ОДНУ копию, вторая остаётся заведомо
  # ложной и выглядит так же убедительно. Появляются одинаково — строку дописывают в конец
  # таблицы вместо правки существующей (issue #224: smartLists.ts, SmartListNav.tsx, TaskModal.tsx).
  #
  # Область сравнения — ОДНА таблица, а не файл: `WEB_JWT_SECRET` законно стоит и в таблице
  # секретов edge-функций, и в таблице переменных Cloudflare Pages. У таблиц эндпоинтов первая
  # колонка — метод, поэтому там ключом берём «метод + путь», иначе каждый второй GET был бы дублем.
  awk '
    !/^\|/ { split("", seen); next }
    /^\|[[:space:]]*[`*]*[A-Za-z_\/]/ {
      split($0, f, "|")
      k=f[2]; v=f[3]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      bare=k; gsub(/[`*]/, "", bare)
      if (bare ~ /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/) k = k " " v
      if (k in seen) { printf "- %s: %s — строки %s и %d\n", FILENAME, k, seen[k], FNR; bad=1 }
      else seen[k]=FNR
    }
    END { if (!bad) print "- (дублей нет)" }
  ' docs/*.md
  echo
fi
