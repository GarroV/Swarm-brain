#!/usr/bin/env bash
# Гейт защищённых поверхностей: тронул раздел из реестра — покажи, что владелец просил.
#
# Зачем. 21.09.2026 раздел «Проекты» опустел у всей команды. Обе причины были ПОБОЧНЫМИ
# правками — ни одна не была работой над проектами: автовыбор вкладки делался ради кнопки
# «+ Проект», а запись в таблице `sprints` завела миграция ради раздела «Спринты». Памятка
# «будь внимателен» такое не ловит, поэтому проверка машинная (issue #425).
#
#   ./scripts/check-protected-paths.sh [<база>]     # по умолчанию origin/main
#
# Коды возврата:
#   0 — защищённое не тронуто, либо тронуто и есть трейлер Owner-approved
#   1 — тронуто защищённое без разрешения (в CI это красный чек)
set -euo pipefail

BASE=${1:-origin/main}
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"
REGISTRY=.github/protected-paths.txt

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

[ -f "$REGISTRY" ] || { red "Нет реестра $REGISTRY — гейт не может работать."; exit 1; }

# Диапазон считаем от точки расхождения: так в него попадают коммиты ветки и НЕ попадает то,
# что приехало в базу параллельно.
MERGE_BASE=$(git merge-base "$BASE" HEAD 2>/dev/null || echo "")
[ -n "$MERGE_BASE" ] || { red "Не нашёл общего предка с $BASE — нечего сравнивать."; exit 1; }

CHANGED=$(git diff --name-only "$MERGE_BASE" HEAD)
[ -n "$CHANGED" ] || { green "Изменений нет."; exit 0; }

# 1. Пути из реестра.
PATTERNS=$(grep -v '^[[:space:]]*#' "$REGISTRY" | grep -v '^[[:space:]]*$' || true)
HITS=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    # shellcheck disable=SC2254
    case "$file" in
      $pattern|$pattern/*) HITS="$HITS$file (реестр)"$'\n' ;;
    esac
  done <<< "$PATTERNS"
done <<< "$CHANGED"

# 2. Миграции, трогающие данные защищённых разделов. По имени файла этого не видно — смотрим
# содержимое: раздел «Проекты» уронила именно миграция, писавшая в таблицу соседнего раздела.
while IFS= read -r file; do
  case "$file" in
    supabase/migrations/*.sql)
      [ -f "$file" ] || continue
      if grep -qiE '\b(public\.)?(projects|sprints)\b' "$file"; then
        HITS="$HITS$file (миграция трогает projects/sprints)"$'\n'
      fi
      ;;
  esac
done <<< "$CHANGED"

HITS=$(printf '%s' "$HITS" | sed '/^$/d' | sort -u)

if [ -z "$HITS" ]; then
  green "Защищённые поверхности не тронуты."
  exit 0
fi

# Разрешение — трейлер в сообщении любого коммита ветки.
#
# Вывод собираем в переменную, а НЕ проверяем через `git log | grep -q`: с `set -o pipefail`
# такой пайп всегда неуспешен — `grep -q` закрывает канал на первом совпадении, `git log`
# получает SIGPIPE (141), и код пайплайна ненулевой ИМЕННО когда трейлер найден. Гейт при этом
# блокировал бы и правки с разрешением; поймано прогоном на живом примере.
APPROVAL=$(git log --format='%B' "$MERGE_BASE..HEAD" | grep -iE '^Owner-approved:[[:space:]]*[^[:space:]]' || true)

if [ -n "$APPROVAL" ]; then
  bold "Тронуто защищённое, разрешение владельца есть:"
  printf '%s\n' "$HITS" | sed 's/^/  · /'
  printf '%s\n' "$APPROVAL" | sed 's/^/  /'
  green "Проходим."
  exit 0
fi

red "СТОП: тронута защищённая поверхность, а разрешения владельца в истории нет."
printf '%s\n' "$HITS" | sed 's/^/  · /'
cat >&2 <<'HINT'

Так нельзя не потому, что правка плоха, а потому что эти разделы ломались именно
побочными изменениями — сделанными ради чего-то другого и потому не проверенными.

Если владелец просил про этот участок — скажи об этом в коммите:

    git commit --amend        # или отдельным коммитом в ветке
    …
    Owner-approved: владелец просил добавить перенос проекта между пространствами

Если не просил — вынеси правку из этой ветки и спроси.
Реестр защищённого: .github/protected-paths.txt
HINT
exit 1
