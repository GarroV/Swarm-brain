#!/usr/bin/env bash
# Накопитель раскатки: что готово, но ещё не на проде.
#
# Зачем: раскатка на Swarm — отдельное действие с отдельным «да» владельца и в согласованное
# окно (решение 24.08.2026, docs/decisions/2026-08-24-deploy-window.md). Без списка «что
# накопилось» одобренное теряется, а неодобренное уезжает вместе с соседним пушем.
#
#   ./scripts/deploy-window.sh plan   — показать, что накопилось с прошлой раскатки
#   ./scripts/deploy-window.sh go     — раскатать edge-функции и передвинуть метку
#   ./scripts/deploy-window.sh init   — поставить метку на текущий HEAD (первый раз)
#
# Окно: 23:00–06:59 по Белграду, любой день. Вне окна `go` отказывается — обойти осознанно:
# FORCE=1 ./scripts/deploy-window.sh go (живой баг окно обгоняет, но «да» владельца нужно всё равно).
set -euo pipefail

TAG=prod-deployed
PROJECT_REF=vbqglndbxkpmreccpqmr
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

base_ref() {
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
    || die "Метки $TAG нет. Первый раз: ./scripts/deploy-window.sh init (ставит её на текущий HEAD)."
  echo "$TAG"
}

# Гейт миграций (pending_migrations и др.) — общий с ночной автоматикой, см. scripts/lib/migrations-gate.sh.
# Зачем: до 25.09.2026 раскатка катила функции, не глядя на миграции, и код уезжал вперёд схемы
# (issue #509, случаи #494 и #508). Опаснее всего, что мину взрывает ЧУЖАЯ раскатка: достаточно
# влить такой PR в main, и ближайший ночной прогон по любому другому PR увезёт его функции вместе
# со своими. Коды pending_migrations: 0 — всё применено, 1 — есть неприменённые, 3 — проверить НЕЧЕМ.
# shellcheck source=lib/migrations-gate.sh
. "$REPO_ROOT/scripts/lib/migrations-gate.sh"

# Изменённые edge-функции. Правка в _shared/ тянет за собой всех её потребителей —
# иначе на проде окажется функция со старой копией общего модуля.
changed_functions() {
  local base=$1 direct queue seen consumers f bn importers
  direct=$(git diff --name-only "$base"..HEAD -- supabase/functions/ \
    | awk -F/ 'NF >= 4 && $3 != "_shared" {print $3}' | sort -u | grep -v '^_' || true)
  # Обход транзитивный: _shared → _shared → функция (issue #292). Изменённый history.ts
  # импортирует только _shared/tasks/db.ts, а уже его — swarm-api, swarm-bot, swarm-mcp; прежний
  # обход останавливался на первом шаге и печатал «функций нет».
  queue=$(git diff --name-only "$base"..HEAD -- supabase/functions/_shared/ \
    | grep -v '\.test\.ts$' || true)
  seen=$'\n'
  consumers=""
  while [ -n "$queue" ]; do
    f=$(printf '%s\n' "$queue" | head -1)
    queue=$(printf '%s\n' "$queue" | sed 1d)
    case "$seen" in *$'\n'"$f"$'\n'*) continue ;; esac
    seen+="$f"$'\n'
    bn=$(basename "$f")
    importers=$(grep -rl -- "$bn" supabase/functions --include='*.ts' 2>/dev/null \
      | grep -v '\.test\.ts$' || true)
    consumers+=$(printf '%s\n' "$importers" | awk -F/ 'NF >= 4 && $3 != "_shared" {print $3}')
    consumers+=$'\n'
    queue+=$'\n'$(printf '%s\n' "$importers" | awk -F/ '$3 == "_shared"')
    queue=$(printf '%s\n' "$queue" | sed '/^$/d')
  done
  printf '%s\n%s\n' "$direct" "$consumers" | sed '/^$/d' | sort -u
}

# Сверка накопителя с продом (issue #243). Метку двигает только `go`: функция, выкатанная мимо
# него (ручной `supabase functions deploy`, отдельная кнопка), так и висит «к раскатке», и шум
# прячет то, что действительно ждёт. Поэтому для каждой функции сравниваем время её раскатки на
# проде с последним коммитом, который её касается (её папка или _shared — с запасом: правка в
# _shared считается правкой всех). Раскатана позже — помечаем «уже на проде». Без токена или
# без ответа API — говорим, что не сверено, а не молчим.
prod_functions_json() {
  # Подмена ответа API — только для scripts/test-deploy-window.sh.
  if [ -n "${PROD_FUNCTIONS_JSON_FILE:-}" ]; then cat "$PROD_FUNCTIONS_JSON_FILE"; return; fi
  [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || return 3
  curl -fsS -m 30 -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/functions" 2>/dev/null || return 3
}

annotate_functions() {
  local base=$1 funcs=$2 json f prod_ms last_s
  if ! json=$(prod_functions_json); then
    echo "$funcs" | sed 's/^/  · /'
    echo "  (с продом не сверено: нет SUPABASE_ACCESS_TOKEN или API не ответил)"
    return
  fi
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    prod_ms=$(printf '%s' "$json" | jq -r --arg s "$f" '.[] | select(.slug == $s) | .updated_at // empty')
    last_s=$(git log -1 --format=%ct "$base"..HEAD -- "supabase/functions/$f" supabase/functions/_shared)
    if [ -n "$prod_ms" ] && [ -n "$last_s" ] && [ "$((prod_ms / 1000))" -gt "$last_s" ]; then
      echo "  · $f — уже на проде: раскатана после последней правки, мимо метки"
    else
      echo "  · $f"
    fi
  done <<< "$funcs"
}

case "${1:-plan}" in
  init)
    git tag -f "$TAG" HEAD >/dev/null
    git push -f origin "refs/tags/$TAG" >/dev/null 2>&1 || echo "(метка локальная — пуш не прошёл)"
    echo "Метка $TAG стоит на $(git rev-parse --short HEAD). Дальше: ./scripts/deploy-window.sh plan"
    ;;

  plan|go)
    BASE=$(base_ref)
    FUNCS=$(changed_functions "$BASE")
    WEB=$(git diff --name-only "$BASE"..HEAD -- miniapp/ | wc -l | tr -d ' ')
    MIGR=$(git diff --name-only --diff-filter=A "$BASE"..HEAD -- supabase/migrations/ || true)
    REC=$(git diff --name-only "$BASE"..HEAD -- recorder/ | wc -l | tr -d ' ')
    COMMITS=$(git log --oneline "$BASE"..HEAD | wc -l | tr -d ' ')

    head_ "Накопилось с прошлой раскатки ($(git rev-parse --short "$BASE"), $COMMITS коммит(ов))"
    git log --oneline "$BASE"..HEAD | sed 's/^/  /'

    head_ "Edge-функции к раскатке"
    [ -n "$FUNCS" ] && annotate_functions "$BASE" "$FUNCS" || echo "  (нет)"

    head_ "Веб (miniapp)"
    if [ "$WEB" -gt 0 ]; then
      echo "  $WEB файл(ов) — раскатается САМ при пуше в main (Cloudflare Pages), отдельной команды нет"
    else
      echo "  (нет)"
    fi

    head_ "Миграции БД"
    MIGR_PENDING=""
    MIGR_STATE=0
    if [ -n "$MIGR" ]; then
      echo "$MIGR" | sed 's/^/  · /'
      echo "  ⚠ накатывать вручную и НОЧЬЮ — тяжёлое идёт вне утреннего окна"
      MIGR_PENDING=$(pending_migrations "$MIGR") || MIGR_STATE=$?
      case "$MIGR_STATE" in
        0) echo "  ✅ на проде уже применены — функции можно катить" ;;
        1) echo "  ⛔ НЕ применены на проде:"; echo "$MIGR_PENDING" | sed 's/^/       · /' ;;
        *) echo "  ⚠ проверить нечем (нет SUPABASE_ACCESS_TOKEN или API не ответил)" ;;
      esac
    else
      echo "  (нет)"
    fi

    head_ "Рекордер"
    [ "$REC" -gt 0 ] && echo "  $REC файл(ов) — отдельный runbook recorder/README.md (LATEST_BUILD)" || echo "  (нет)"

    [ "${1:-plan}" = "plan" ] && exit 0

    # ── go ──────────────────────────────────────────────────────────────────────
    # Окно — НОЧНОЕ (решение владельца 2026-08-27, docs/decisions/2026-08-27-deploy-at-night.md):
    # «катим апдейты всегда во внерабочее время. т.е. ночью». Утреннее 09:00–10:00 отменено.
    HOUR=$(TZ=Europe/Belgrade date +%H)
    if [ "$((10#$HOUR))" -lt 23 ] && [ "$((10#$HOUR))" -ge 7 ]; then
      [ "${FORCE:-0}" = "1" ] || die "Сейчас $(TZ=Europe/Belgrade date '+%a %H:%M') по Белграду — вне окна раскатки (23:00–06:59).
Днём в Swarm работают, поэтому апдейты уезжают ночью.
Живой баг окно обгоняет — тогда: FORCE=1 ./scripts/deploy-window.sh go"
      echo; echo "⚠ Вне окна, но FORCE=1 — раскатываю."
    fi

    # Кто в проде прямо сейчас. Запись/обработка встречи — стоп без обхода окном: оборванный
    # кусок аудио это потерянная встреча. Люди в вебе — предупреждение (им прилетит reload).
    #
    # SKIP_ACTIVITY_CHECK=1 — для ночной АВТОМАТИКИ (владелец 2026-08-28: «какая нахуй запись
    # ночью?»). В окне 23:00–06:59 никто не записывает встречу и не работает в вебе, а обработка
    # тезисов durable: meeting-process двигает встречу шагами и хранит process_state, поэтому
    # прерванный деплоем тик добьёт следующий (крон раз в минуту) — терять нечего. Заодно это
    # снимает потребность в прод-ключе внутри CI: у раннера нет кэша привязки к базе, и проверка
    # там могла бы работать только с service-role ключом в секретах публичного репозитория.
    # Для РУЧНОЙ раскатки (в т.ч. FORCE днём) проверка остаётся обязательной.
    if [ "${SKIP_ACTIVITY_CHECK:-0}" = "1" ]; then
      head_ "Кто в проде"
      echo "  проверка пропущена: ночное окно (записи и людей нет), обработка тезисов durable"
      ACT=0
    else
    head_ "Кто в проде"
    ACT=0; ./scripts/deploy-activity.sh || ACT=$?
    if [ "$ACT" = "2" ]; then
      die "Раскатка отменена: идёт запись или обработка встречи. Это НЕ обходится FORCE."
    elif [ "$ACT" = "3" ]; then
      # Не «идёт запись», а «неизвестно». Раньше оба случая говорили про запись встречи, и
      # человек ждал события, которого нет: в CI привязки к проду нет никогда (прод-ключ там не
      # держим, решение 2026-08-28), поэтому кнопка раскатки падала ВСЕГДА (issue #429).
      die "Проверить активность нечем — состояние прода неизвестно (причина выше).
Про запись встречи это НИЧЕГО не говорит: проверка просто не выполнилась.
Проверь сам (идёт ли запись, обрабатываются ли встречи, работает ли кто-то в вебе)
и запусти осознанно: кнопка раскатки → «Пропустить проверку кто в проде»."
    elif [ "$ACT" = "1" ]; then
      [ "${FORCE:-0}" = "1" ] || die "В системе кто-то работает — раскатка перезагрузит ему страницу.
Объяви обновление и подожди:  make notice MIN=15
Либо осознанно:               FORCE=1 ./scripts/deploy-window.sh go"
      echo "⚠ Люди в системе, но FORCE=1 — раскатываю."
    fi
    fi
    # Релиз без функций — нормальный случай: правка только веба уезжает САМА при мёрже в main
    # (Cloudflare Pages). Раскатывать нечего, но метку двинуть надо — иначе следующий plan
    # снова покажет эти коммиты, и в шуме потеряется то, что действительно ждёт раскатки.
    # Код вперёд схемы не пускаем: функция, которой нужна новая колонка, ответит 400 и
    # положит раздел у всей команды до утра (issue #509). FORCE здесь НЕ обходит — он про
    # окно и про людей в системе, а не про то, что база к этому коду не готова.
    if [ -n "$FUNCS" ] && [ "$MIGR_STATE" != "0" ]; then
      if [ "$MIGR_STATE" = "1" ]; then
        die "Раскатка отменена: в релизе есть миграции, которых НЕТ на проде:
$(echo "$MIGR_PENDING" | sed 's/^/  · /')
Функции ждут этих изменений схемы — уехав раньше, они начнут отвечать 400.
Сначала накатить миграции (кнопка «Миграции БД» в Actions), потом раскатывать."
      fi
      [ "${MIGRATIONS_OK:-0}" = "1" ] || die "Раскатка отменена: в релизе есть миграции, а проверить их на проде НЕЧЕМ (причина выше).
Это НЕ значит «миграции не накатаны» — проверка просто не выполнилась.
Убедись сам, что схема на проде готова к этому коду, и запусти осознанно:
  MIGRATIONS_OK=1 ./scripts/deploy-window.sh go"
      echo "⚠ Проверить миграции нечем, но MIGRATIONS_OK=1 — раскатываю."
    fi

    if [ -n "$FUNCS" ]; then
      head_ "Раскатка"
      # shellcheck disable=SC2086
      supabase functions deploy $FUNCS --no-verify-jwt --project-ref "$PROJECT_REF"
    elif [ "$WEB" -gt 0 ] || [ "$COMMITS" -gt 0 ]; then
      head_ "Edge-функций к раскатке нет"
      echo "  Веб уехал сам при мёрже в main (Cloudflare Pages) — двигаю только метку."
    else
      die "Нечего раскатывать и нечего отмечать: с прошлой раскатки ничего не менялось."
    fi

    # Плашка сделала свою работу — снимаем сразу, не дожидаясь `until`: люди не должны видеть
    # «скоро обновление» после того, как оно прошло.
    ./scripts/deploy-notice.sh off >/dev/null 2>&1 || echo "(объявление снять не удалось — оно погаснет само по until)"

    git tag -f "$TAG" HEAD >/dev/null
    git push -f origin "refs/tags/$TAG" >/dev/null 2>&1 || echo "(метка осталась локальной)"
    head_ "Готово. Метка $TAG → $(git rev-parse --short HEAD)"
    echo "Дальше по правилу: проверить на реальном окружении и отчитаться владельцу."
    ;;

  *) die "Использование: ./scripts/deploy-window.sh [plan|go|init]" ;;
esac
