# Гейт миграций раскатки: какие файлы миграций уезжают с релизом и применены ли они на проде.
# Подключается через `source` — общий для ручной раскатки (scripts/deploy-window.sh) и ночной
# автоматики (scripts/deploy-window-merge.sh). Одна реализация на оба пути: две реализации одного
# решения расходятся молча (docs/decisions/2026-08-28-fullness-over-recency.md).
#
# Зачем гейт (issue #509, #444, #557): функция или веб, которым нужна новая колонка, уехав раньше
# схемы, отвечают 400 и кладут раздел у всей команды до утра, когда никто не смотрит.
#
# Спрашиваем шлюз на своём сервере (`swarm_server migrations-applied names`, scripts/lib/swarm-server.sh),
# а не базу: пароля базы в CI нет и не будет (решение 2026-08-28), есть только ключ шлюза, который
# умеет ровно три команды. С 13.10.2026 прод — свой сервер; облачный Management API мёртв (#919).
#
# Тесты на фикстурах и порча — scripts/test-migrations-gate.sh (job «Скрипты раскатки» в CI).

GATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=swarm-server.sh
. "$GATE_LIB_DIR/swarm-server.sh"
GATE_MIGR_DIR="supabase/migrations/"

# Общий preflight перед первой записью: ledger — строки «версия<TAB>имя».
# 0 — план (имена неприменённых файлов), 2 — конфликт/несовместимый протокол, 3 — пустой ledger.
migration_plan() {
  printf '%s' "$2" | python3 -c '
import re, sys

def reject(message, code=2):
    print(message)
    sys.exit(code)

done = {}
for line in sys.stdin:
    if not line.strip():
        continue
    fields = line.rstrip("\r\n").split("\t")
    if len(fields) != 2 or not re.fullmatch(r"\d{8,14}", fields[0]) or not fields[1]:
        reject("Шлюз не вернул номер и имя миграции. Сначала обновите шлюз: migrations-applied names.")
    version, name = fields
    if version in done and done[version] != name:
        reject(f"Конфликт ledger: у версии {version} несколько имён.")
    done[version] = name
if not done:
    reject("Сервер вернул пустой ledger миграций: проверить имена нечем.", 3)

seen = {}
missing = []
for line in sys.argv[1].splitlines():
    filename = line.strip().rsplit("/", 1)[-1]
    if not filename or filename.startswith("_"):
        continue
    match = re.fullmatch(r"(\d{8,14})_(.+)\.sql", filename)
    if not match:
        reject(f"Нет корректного номера и имени миграции: {filename}")
    version, expected_name = match.groups()
    if version in seen:
        if seen[version] != filename:
            reject(f"Конфликт номера {version}: {seen[version]} и {filename}")
        continue
    seen[version] = filename
    if version in done and done[version] != expected_name:
        reject(f"Конфликт миграции {version}: в ledger имя {done[version]}, в файле {expected_name}.")
    if version not in done:
        missing.append(filename)
print("\n".join(missing))
' "$1"
}

# Какие из файлов НЕ применены по номеру и имени.
#   $1 — файлы миграций, по одному в строке;  $2 — ledger «версия<TAB>имя».
# Печатает неприменённые имена. Коды: 0 — всё применено (или файлов нет), 1 — есть неприменённые,
# 3 — список применённых пуст (в ledger сервера они есть всегда: пустой ответ — это «проверить
# нечем», а не «всё хорошо»).
missing_migrations() {
  local files="$1" applied="$2" pending rc=0
  [ -n "$files" ] || return 0
  [ -n "$(printf '%s' "$applied" | tr -d '[:space:]')" ] || return 3
  pending=$(migration_plan "$files" "$applied") || rc=$?
  case "$rc" in
    0) ;;
    2) printf '%s\n' "$pending"; return 1 ;; # Доказанный конфликт нельзя обойти MIGRATIONS_OK.
    *) printf '%s\n' "$pending" >&2; return 3 ;;
  esac
  [ -z "$pending" ] && return 0
  printf '%s\n' "$pending"
  return 1
}

# То же, но с живым списком с сервера. Коды как у missing_migrations; 3 — ещё и «нет ключа или
# сервер не ответил». MIGRATIONS_APPLIED — подставить список вместо сети (тесты на фикстурах).
pending_migrations() {
  local files="$1" applied
  [ -n "$files" ] || return 0
  if [ -n "${MIGRATIONS_APPLIED+set}" ]; then
    applied="$MIGRATIONS_APPLIED"
  else
    applied=$(swarm_server migrations-applied names) || return 3
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
    *) GATE_REASON="в релизе есть миграции ($(printf '%s' "$all" | xargs -n1 basename | paste -sd, -)), а проверить их на проде нечем (нет ключа раскатки или сервер не ответил). Это не «не накатаны» — проверка не выполнилась."
       return 3 ;;
  esac
}
