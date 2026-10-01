# Гейт миграций раскатки: какие файлы миграций уезжают с релизом и применены ли они на проде.
# Подключается через `source` — общий для ручной раскатки (scripts/deploy-window.sh) и ночной
# автоматики (scripts/deploy-window-merge.sh). Одна реализация на оба пути: две реализации одного
# решения расходятся молча (docs/decisions/2026-08-28-fullness-over-recency.md).
#
# Зачем гейт (issue #509, #444, #557): функция или веб, которым нужна новая колонка, уехав раньше
# схемы, отвечают 400 и кладут раздел у всей команды до утра, когда никто не смотрит.
#
# Спрашиваем Management API, а не базу: прод-ключа в CI нет и не будет (решение 2026-08-28), а
# SUPABASE_ACCESS_TOKEN там есть — тот самый, которым и деплоятся функции.
#
# Тесты на фикстурах и порча — scripts/test-migrations-gate.sh (job «Скрипты раскатки» в CI).

GATE_PROJECT_REF="${PROJECT_REF:-vbqglndbxkpmreccpqmr}"
GATE_MIGR_DIR="supabase/migrations/"

# Какие из файлов НЕ применены, по ответу Management API (JSON-массив объектов с полем version).
#   $1 — файлы миграций, по одному в строке;  $2 — ответ API.
# Печатает неприменённые имена. Коды: 0 — всё применено (или файлов нет), 1 — есть неприменённые,
# 3 — ответ не разобрать (это «проверить нечем», а не «всё хорошо»).
missing_migrations() {
  local files="$1" applied="$2" pending
  [ -n "$files" ] || return 0
  pending=$(printf '%s' "$applied" | python3 -c '
import json, re, sys
try:
    data = json.load(sys.stdin)
    done = {str(m.get("version")) for m in data}
except Exception:
    sys.exit(3)
missing = []
for line in sys.argv[1].splitlines():
    name = line.strip().rsplit("/", 1)[-1]
    if not name:
        continue
    m = re.match(r"(\d{14})", name)
    # Файл без версии в имени пропускать нельзя: молчаливый пропуск и есть та дыра, что чинится.
    if not m or m.group(1) not in done:
        missing.append(name)
print("\n".join(missing))
' "$files") || return 3
  [ -z "$pending" ] && return 0
  printf '%s\n' "$pending"
  return 1
}

# То же, но с живым ответом прода. Коды как у missing_migrations; 3 — ещё и «нет токена или API
# не ответил». MIGRATIONS_API_JSON — подставить ответ API вместо сети (тесты на фикстурах).
pending_migrations() {
  local files="$1" applied
  [ -n "$files" ] || return 0
  if [ -n "${MIGRATIONS_API_JSON+set}" ]; then
    applied="$MIGRATIONS_API_JSON"
  else
    [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || return 3
    applied=$(curl -fsS -m 30 \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      "https://api.supabase.com/v1/projects/$GATE_PROJECT_REF/database/migrations" 2>/dev/null) || return 3
  fi
  missing_migrations "$files" "$applied"
}

# Новые файлы миграций между двумя ревизиями (BASE..HEAD).
added_migrations() {
  git diff --name-only --no-renames --diff-filter=A "$1..$2" -- "$GATE_MIGR_DIR"
}

# Уже существующие файлы миграций, которые PR правит, переименовывает или удаляет. Такое гейт по
# версиям не видит: версия на проде «применена», а новое содержимое не применится никогда.
# Поэтому это всегда ручная раскатка. Сравнение от общей базы (BASE...HEAD): то, что ушло в main
# после ответвления PR, к PR не относится.
touched_existing_migrations() {
  git diff --name-status --no-renames --diff-filter=MDT "$1...$2" -- "$GATE_MIGR_DIR"
}

# Решение ночной автоматики по одному PR: можно ли его влить, не пустив код вперёд схемы.
#   $1 — ревизия main (что уже влито);  $2 — голова PR;  $3 — метка прошлой раскатки (prod-deployed).
# Проверяются миграции PR И миграции, влитые в main с прошлой раскатки: если в main уже лежит
# ненакатанная миграция (PR влили руками), после мёржа любого PR раскатка функций откажет, а веб
# уже уедет — ровно случай #557.
# Код 0 — вливать можно. Иначе — нельзя, причина в переменной GATE_REASON (одной строкой, для
# комментария в PR); код 1 — миграции не накатаны или PR правит старые, 3 — проверить нечем.
# GATE_PLAN — что гейт увидел (для журнала прогона, в том числе сухого).
pr_migrations_gate() {
  local main_ref="$1" pr_ref="$2" base_tag="$3" touched pr_new main_new all rc pending
  GATE_REASON=""; GATE_PLAN=""
  touched=$(touched_existing_migrations "$main_ref" "$pr_ref") || {
    GATE_REASON="не смог сравнить PR с main — миграции проверить нечем."; return 3; }
  if [ -n "$touched" ]; then
    GATE_REASON="PR правит уже существующий файл миграции ($(printf '%s' "$touched" | awk '{print $2}' | xargs -n1 basename | paste -sd, -)). Такое катится только руками: версия на проде уже «применена», новое содержимое автоматика не накатит."
    GATE_PLAN="правка существующих миграций: $(printf '%s' "$touched" | tr '\n' ' ')"
    return 1
  fi
  pr_new=$(added_migrations "$main_ref" "$pr_ref") || {
    GATE_REASON="не смог получить список миграций PR — проверить нечем."; return 3; }
  main_new=""
  if [ -n "$base_tag" ] && git rev-parse -q --verify "$base_tag^{commit}" >/dev/null; then
    main_new=$(added_migrations "$base_tag" "$main_ref") || main_new=""
  elif [ -n "$pr_new" ]; then
    GATE_REASON="нет метки прошлой раскатки ($base_tag) — не понять, что уже в main и не накатано."; return 3
  fi
  all=$(printf '%s\n%s\n' "$main_new" "$pr_new" | sed '/^$/d' | sort -u)
  if [ -z "$all" ]; then
    GATE_PLAN="миграций нет"
    return 0
  fi
  GATE_PLAN="миграции релиза: $(printf '%s' "$all" | xargs -n1 basename | paste -sd, -)"
  rc=0; pending=$(pending_migrations "$all") || rc=$?
  case "$rc" in
    0) GATE_PLAN="$GATE_PLAN — на проде применены"; return 0 ;;
    1) GATE_REASON="на проде НЕ накатаны миграции: $(printf '%s' "$pending" | paste -sd, -). Код уехал бы раньше схемы. Сначала кнопка «Накат миграций БД» (deploy-migrations.yml) по «да» владельца — метка остаётся, следующий прогон увидит схему и вольёт PR."
       return 1 ;;
    *) GATE_REASON="в релизе есть миграции ($(printf '%s' "$all" | xargs -n1 basename | paste -sd, -)), а проверить их на проде нечем (нет SUPABASE_ACCESS_TOKEN или API не ответил). Это не «не накатаны» — проверка не выполнилась."
       return 3 ;;
  esac
}
