#!/usr/bin/env bash
# Генерирует changelog из conventional-commits git-истории.
# Источник истины — git-лог, а не ручной файл (убирает конфликты при параллельной работе).
#
# Использование:
#   scripts/changelog.sh                 # с последнего тега (или весь лог, если тегов нет)
#   scripts/changelog.sh v1.2.0          # с указанного ref до HEAD
#   scripts/changelog.sh > RELEASE.md    # сохранить в файл
set -euo pipefail

since="${1:-}"
if [ -z "$since" ]; then
  since=$(git describe --tags --abbrev=0 2>/dev/null || true)
fi
range=""
[ -n "$since" ] && range="${since}..HEAD"

echo "# Changelog (сгенерировано $(date +%Y-%m-%d))"
[ -n "$since" ] && printf '\n_С %s по HEAD_\n' "$since"

emit() {
  local type="$1" title="$2" lines
  lines=$(git log --no-merges --pretty=format:'%s|%h' $range | grep -E "^${type}(\(.+\))?: " || true)
  [ -z "$lines" ] && return
  printf '\n## %s\n\n' "$title"
  while IFS='|' read -r subject hash; do
    printf -- '- %s (%s)\n' "${subject#*: }" "$hash"
  done <<< "$lines"
}

emit feat     "✨ Features"
emit fix      "🐛 Fixes"
emit perf     "⚡ Performance"
emit refactor "♻️ Refactor"
emit docs     "📝 Docs"
emit test     "✅ Tests"
emit chore    "🔧 Chore"
emit ci       "👷 CI"
