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
# Окно: 23:00–05:59 по Белграду, любой день. Вне окна `go` отказывается — обойти осознанно:
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

# Изменённые edge-функции. Правка в _shared/ тянет за собой всех её потребителей —
# иначе на проде окажется функция со старой копией общего модуля.
changed_functions() {
  local base=$1 direct shared_files consumers
  direct=$(git diff --name-only "$base"..HEAD -- supabase/functions/ \
    | awk -F/ '$3 != "" && $3 != "_shared" {print $3}' | sort -u | grep -v '^_' || true)
  shared_files=$(git diff --name-only "$base"..HEAD -- supabase/functions/_shared/ \
    | grep -v '\.test\.ts$' || true)
  consumers=""
  if [ -n "$shared_files" ]; then
    for f in $shared_files; do
      local bn; bn=$(basename "$f")
      consumers+=$(grep -rl -- "$bn" supabase/functions --include='*.ts' 2>/dev/null \
        | awk -F/ '$3 != "" && $3 != "_shared" {print $3}' || true)
      consumers+=$'\n'
    done
  fi
  printf '%s\n%s\n' "$direct" "$consumers" | sed '/^$/d' | sort -u
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
    [ -n "$FUNCS" ] && echo "$FUNCS" | sed 's/^/  · /' || echo "  (нет)"

    head_ "Веб (miniapp)"
    if [ "$WEB" -gt 0 ]; then
      echo "  $WEB файл(ов) — раскатается САМ при пуше в main (Cloudflare Pages), отдельной команды нет"
    else
      echo "  (нет)"
    fi

    head_ "Миграции БД"
    [ -n "$MIGR" ] && { echo "$MIGR" | sed 's/^/  · /'; echo "  ⚠ накатывать вручную и НОЧЬЮ — тяжёлое идёт вне утреннего окна"; } || echo "  (нет)"

    head_ "Рекордер"
    [ "$REC" -gt 0 ] && echo "  $REC файл(ов) — отдельный runbook recorder/README.md (LATEST_BUILD)" || echo "  (нет)"

    [ "${1:-plan}" = "plan" ] && exit 0

    # ── go ──────────────────────────────────────────────────────────────────────
    # Окно — НОЧНОЕ (решение владельца 2026-08-27, docs/decisions/2026-08-27-deploy-at-night.md):
    # «катим апдейты всегда во внерабочее время. т.е. ночью». Утреннее 09:00–10:00 отменено.
    HOUR=$(TZ=Europe/Belgrade date +%H)
    if [ "$((10#$HOUR))" -lt 23 ] && [ "$((10#$HOUR))" -ge 6 ]; then
      [ "${FORCE:-0}" = "1" ] || die "Сейчас $(TZ=Europe/Belgrade date '+%a %H:%M') по Белграду — вне окна раскатки (23:00–05:59).
Днём в Swarm работают, поэтому апдейты уезжают ночью.
Живой баг окно обгоняет — тогда: FORCE=1 ./scripts/deploy-window.sh go"
      echo; echo "⚠ Вне окна, но FORCE=1 — раскатываю."
    fi

    # Кто в проде прямо сейчас. Запись/обработка встречи — стоп без обхода окном: оборванный
    # кусок аудио это потерянная встреча. Люди в вебе — предупреждение (им прилетит reload).
    #
    # SKIP_ACTIVITY_CHECK=1 — для ночной АВТОМАТИКИ (владелец 2026-08-28: «какая нахуй запись
    # ночью?»). В окне 23:00–05:59 никто не записывает встречу и не работает в вебе, а обработка
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
