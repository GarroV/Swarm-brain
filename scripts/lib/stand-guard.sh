# Сторож общего тестового стенда базы на MUSPELHEIM (issue #998): схема стенда обязана совпадать с
# миграциями main, иначе тесты базы краснеют не по коду и этому находится сто объяснений.
# Подключается через `source` из scripts/with-local-db (только для общего стенда: свой контур на
# машине и контур CI поднимаются с нуля по миграциям checkout и в сторожe не нуждаются).
#
# Почему сверка по журналу миграций стенда (supabase_migrations.schema_migrations), а не «сброс на
# каждый прогон»: стенд общий, сброс из-под одной сессии роняет прогон соседней, а минута на
# пересоздание — это цена, которую платят все, чтобы застраховать единицы. Сверка стоит одну
# секунду. Что она ловит: отставание от main (дописываем недостающее сами — вперёд, по одной
# миграции, в транзакции, с записью в журнал) и чужие следы — миграции, которых нет ни в main,
# ни в этой ветке (накатаны руками через psql или с чужой ветки): их не откатить на месте,
# поэтому прогон ОТКАЗЫВАЕТ с командой пересоздания (scripts/stand-reset).
# Миграции самой ветки на стенд сами не едут: это правка общего стенда непроверенным SQL, её
# делают осознанно — scripts/stand-reset --branch.
#
# Тесты на фикстурах и порча — scripts/test-stand-guard.sh (job «Скрипты раскатки» в CI).

STAND_DB_CONTAINER=${SWARM_TEST_DB_CONTAINER:-supabase_db_swarm}
STAND_MIGR_DIR="supabase/migrations"

# Версии миграций по списку имён файлов (stdin), по одной в строке, отсортированные.
# Шаблон новой таблицы (`_…`) — не миграция. Файл без версии в имени пропускать нельзя: молчаливый
# пропуск и есть та дыра, что чинится, — код 2.
stand_versions() {
  local line name bad=0 out=""
  # Без конвейера перед циклом: переменная bad живёт в подоболочке и до return не дошла бы.
  while IFS= read -r line; do
    name=${line##*/}
    case "$name" in ''|_*) continue ;; *.sql) ;; *) continue ;; esac
    if [[ "$name" =~ ^([0-9]{8,14})_ ]]; then
      out+="${BASH_REMATCH[1]}"$'\n'
    else
      echo "stand-guard: файл миграции без версии в имени: $name" >&2
      bad=1
    fi
  done < <(cat)
  printf '%s' "$out" | sort -u
  return $bad
}

# План по трём спискам версий (файлы): main, журнал стенда, ветка (checkout).
# Печатает по строке на находку: `MISSING_MAIN <v>` — main впереди стенда (докатываем),
# `MISSING_BRANCH <v>` — миграция ветки не на стенде, `FOREIGN <v>` — на стенде есть то, чего нет
# ни в main, ни в ветке. Пустой вывод — стенд совпадает.
stand_plan() {
  local main="$1" ledger="$2" branch="$3"
  comm -23 "$main" "$ledger" | sed 's/^/MISSING_MAIN /'
  comm -23 <(comm -23 "$branch" "$main") "$ledger" | sed 's/^/MISSING_BRANCH /'
  comm -13 <(sort -u "$main" "$branch") "$ledger" | sed 's/^/FOREIGN /'
}

stand_ssh_psql() { # SQL со stdin → psql в контейнере базы стенда
  ssh -o ConnectTimeout=8 "$REMOTE_HOST" \
    "docker exec -i $STAND_DB_CONTAINER psql -U postgres -v ON_ERROR_STOP=1 -q -tA $*" | tr -d '\r'
}

# Докатить на стенд одну миграцию main: файл и запись в журнал — одной транзакцией.
stand_apply_main_migration() {
  local version="$1" file name
  file=$(git ls-tree --name-only origin/main "$STAND_MIGR_DIR/" | grep "/${version}_" | head -1)
  [ -n "$file" ] || { echo "stand-guard: в origin/main нет файла миграции $version" >&2; return 1; }
  name=$(basename "$file" .sql); name=${name#*_}
  {
    git show "origin/main:$file"
    printf "\n;\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" \
      "$version" "$name"
  } | stand_ssh_psql -1 >/dev/null
}

# Главная точка: 0 — стенд совпадает (возможно, после докатки), 1 — отказ с причиной в stderr.
stand_guard() {
  local tmp ledger plan v
  tmp=$(mktemp -d) || return 1
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  git fetch -q origin main 2>/dev/null || echo "stand-guard: git fetch не удался — сверяю с последним известным origin/main" >&2
  git rev-parse -q --verify origin/main >/dev/null || { echo "stand-guard: нет origin/main, сверять не с чем" >&2; return 1; }

  git ls-tree --name-only origin/main "$STAND_MIGR_DIR/" | stand_versions > "$tmp/main" || return 1
  ls "$STAND_MIGR_DIR" | stand_versions > "$tmp/branch" || return 1
  [ -s "$tmp/main" ] || { echo "stand-guard: в origin/main не нашлось миграций" >&2; return 1; }

  if ! ledger=$(echo "select version from supabase_migrations.schema_migrations" | stand_ssh_psql); then
    echo "stand-guard: не смог прочитать журнал миграций стенда ($REMOTE_HOST, контейнер $STAND_DB_CONTAINER)" >&2
    return 1
  fi
  printf '%s\n' "$ledger" | grep -E '^[0-9]+$' | sort -u > "$tmp/ledger"
  [ -s "$tmp/ledger" ] || { echo "stand-guard: журнал миграций стенда пуст — стенд не создан. Собери: scripts/stand-reset" >&2; return 1; }

  plan=$(stand_plan "$tmp/main" "$tmp/ledger" "$tmp/branch")

  while read -r v; do
    [ -n "$v" ] || continue
    echo "stand-guard: стенд отстаёт от main — докатываю миграцию $v" >&2
    stand_apply_main_migration "$v" || { echo "stand-guard: миграция $v не накатилась — стенд не тронут (транзакция откатилась). Пересоздай: scripts/stand-reset" >&2; return 1; }
  done < <(printf '%s\n' "$plan" | sed -n 's/^MISSING_MAIN //p')

  local foreign branch_missing
  foreign=$(printf '%s\n' "$plan" | sed -n 's/^FOREIGN //p' | tr '\n' ' ')
  branch_missing=$(printf '%s\n' "$plan" | sed -n 's/^MISSING_BRANCH //p' | tr '\n' ' ')
  if [ -n "$foreign" ]; then
    echo "stand-guard: ОТКАЗ — на стенде есть миграции, которых нет ни в main, ни в этой ветке: $foreign" >&2
    echo "  Это чужая ветка или накат руками. Тесты на таком стенде краснеют не по коду." >&2
    echo "  Вернуть стенд к main: scripts/stand-reset   (с миграциями этой ветки: scripts/stand-reset --branch)" >&2
    return 1
  fi
  if [ -n "$branch_missing" ]; then
    echo "stand-guard: ОТКАЗ — миграции этой ветки не на стенде: $branch_missing" >&2
    echo "  Стенд общий и держит схему main. Чтобы прогнать тесты на миграциях ветки: scripts/stand-reset --branch" >&2
    echo "  (пересоздаст стенд: main + твои миграции; соседние сессии при следующем прогоне получат отказ и вернут main)." >&2
    return 1
  fi
  echo "stand-guard: схема стенда = миграции main ($(wc -l < "$tmp/main" | tr -d ' ') шт.)" >&2
  return 0
}
