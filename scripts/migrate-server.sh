#!/usr/bin/env bash
# Накат миграций из supabase/migrations на свой сервер Swarm через шлюз (issue #919).
#
#   ./scripts/migrate-server.sh --dry-run   — показать, какие миграции не применены; ничего не менять
#   ./scripts/migrate-server.sh             — накатить неприменённые по порядку версий
#
# Берёт файлы supabase/migrations/<версия>_<имя>.sql, сверяет версии с `migrations-applied` шлюза и
# каждую неприменённую катит `swarm_server migrate <версия> <имя> < файл` (одна транзакция вместе с
# учётной записью, повтор безопасен). Останавливается на первой ошибке: следующая миграция может
# зависеть от упавшей. Файл без версии в имени (шаблон `_template_new_table.sql` — не миграция) в
# накат не попадает.
#
# Разрешение владельца обязательно, как на любую раскатку. Порядок: сначала миграция, потом функции.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"
# shellcheck source=lib/swarm-server.sh
. "$REPO_ROOT/scripts/lib/swarm-server.sh"

DRY=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "Использование: ./scripts/migrate-server.sh [--dry-run]" >&2; exit 2 ;;
esac

# Пустой ответ — не «всё применено»: в ledger сервера версии есть всегда.
applied=$(swarm_server migrations-applied) || { echo "Не получил список применённых миграций с сервера — накат остановлен." >&2; exit 3; }
[ -n "$(printf '%s' "$applied" | tr -d '[:space:]')" ] \
  || { echo "Сервер вернул пустой список применённых миграций — так не бывает, накат остановлен." >&2; exit 3; }

pending=()
for f in supabase/migrations/[0-9]*_*.sql; do
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  printf '%s\n' "$applied" | grep -qx -- "$version" && continue
  pending+=("$version $name $f")
done

if [ "${#pending[@]}" -eq 0 ]; then
  echo "Неприменённых миграций нет."
  exit 0
fi

# Версии с одинаковым числом цифр сортируются как строки; разной длины (00000000, 20260519) —
# тоже верно, потому что порядок задаёт лексикографика, как и у самого CLI.
# Без mapfile: на macOS bash 3.2 его нет (#942).
sorted=()
while IFS= read -r line; do sorted+=("$line"); done < <(printf '%s\n' "${pending[@]}" | sort)
pending=("${sorted[@]}")

echo "Неприменённые миграции (${#pending[@]}):"
for p in "${pending[@]}"; do echo "  · ${p##* }"; done
[ "$DRY" = "1" ] && { echo "Сухой прогон — ничего не накатываю."; exit 0; }

for p in "${pending[@]}"; do
  read -r version name file <<< "$p"
  echo "→ $version $name"
  swarm_server migrate "$version" "$name" < "$file" || { echo "✘ миграция $version не применилась — остановился." >&2; exit 1; }
done
echo "Готово: накачено миграций — ${#pending[@]}."
