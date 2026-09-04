#!/bin/bash
# Раскатка помеченных PR в НОЧНОЕ окно — руками этого делать не надо, зовёт
# .github/workflows/deploy-window.yml по расписанию.
#
# Правило владельца (2026-08-27, docs/decisions/2026-08-27-deploy-at-night.md): апдейты катятся
# всегда во внерабочее время. Окно — 23:00–05:59 по Белграду; автоматика бьёт в 23:00.
#
# Как пользоваться человеку: навесить на PR метку `deploy-window`. Ночью скрипт возьмёт САМЫЙ
# СТАРЫЙ помеченный PR, проверит, что он сливается и все чеки зелёные, вольёт его в main
# (Cloudflare Pages сам пересоберёт веб), снимет метку и напишет в PR, что уехало.
#
# Осознанные ограничения — чтобы автоматика не превратилась в «катает что попало»:
#   · ОДИН PR за прогон. Две раскатки за ночь подряд смешивают причины, если что-то сломается.
#   · Только `mergeStateStatus == CLEAN`: любой красный или ещё не добежавший чек — не катим,
#     метку не снимаем, пишем в PR причину и ждём следующей ночи.
#   · Метка снимается сразу после мёржа: повторно этот PR автоматика не тронет.
#   · Edge-функции катит САМА, сразу после мёржа (2026-08-28): иначе веб уезжал ночью, а функции
#     ждали человека с кнопкой — то есть окно всё равно требовало, чтобы кто-то бодрствовал.
#     Логика не дублируется: зовём тот же scripts/deploy-window.sh go, что и человек локально.
#   · Миграции и рекордер по-прежнему идут своими путями — их автооткатом не вернёшь.
#
# DRY_RUN=1 — показать решение и не делать ничего (так эта логика проверялась до попадания в main).
# FORCE=1   — обойти проверку окна (живой баг окно обгоняет; «да» владельца всё равно нужно).
set -uo pipefail

LABEL="${LABEL:-deploy-window}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"
REPO="${REPO:-GarroV/Swarm-brain}"

say() { printf '%s\n' "$*"; }
now_local() { TZ=Europe/Belgrade date '+%a %d.%m %H:%M %Z'; }

# Edge-функции после мёржа: тот же путь, что у человека локально (scripts/deploy-window.sh go) —
# он сам определит изменённые функции от метки prod-deployed (правка _shared/ тянет потребителей),
# задеплоит и передвинет метку. Свой список здесь НЕ собираем: две реализации одного решения —
# ровно то, из-за чего у claim и публикации два месяца жили разные правила выбора версии
# (docs/decisions/2026-08-28-fullness-over-recency.md).
#
# Проверку «кто в проде» в ночном окне пропускаем осознанно (владелец 2026-08-28: «какая нахуй
# запись ночью?»): в 23:00–05:59 не записывают и не работают, а обработка тезисов durable —
# прерванный тик добьёт следующий по крону. Днём (FORCE через workflow_dispatch) проверка нужна,
# поэтому пропуск включается только когда мы реально в ночном окне.
FUNCS_RESULT="не запускалась"
deploy_functions() {
  local hour; hour="$(TZ=Europe/Belgrade date +%H)"
  if [ "$((10#$hour))" -ge 23 ] || [ "$((10#$hour))" -lt 6 ]; then
    export SKIP_ACTIVITY_CHECK=1
  fi
  git fetch --tags --force -q origin main || true
  git checkout -q main 2>/dev/null || git checkout -q -B main origin/main
  git reset -q --hard origin/main
  if [ "${DEPLOY_DRY:-0}" = "1" ]; then
    ./scripts/deploy-window.sh plan || say "(план функций не собрался)"
    return 0
  fi
  if FORCE="$FORCE" ./scripts/deploy-window.sh go; then
    FUNCS_RESULT="раскатаны"
  else
    FUNCS_RESULT="НЕ раскатаны (см. лог прогона)"
    say "⚠ Функции не раскатались, а веб уже уехал — разобрать сегодня же."
  fi
}

# ── Окно ──────────────────────────────────────────────────────────────────────
HOUR="$(TZ=Europe/Belgrade date +%H)"
if [ "$FORCE" != "1" ] && [ "$((10#$HOUR))" -lt 23 ] && [ "$((10#$HOUR))" -ge 6 ]; then
  say "Сейчас $(now_local) — вне ночного окна (23:00–05:59). Ничего не делаю."
  exit 0
fi
say "Окно: $(now_local) — можно катить (dry-run=$DRY_RUN)"

# ── Выбор PR ──────────────────────────────────────────────────────────────────
PRS="$(gh pr list --repo "$REPO" --label "$LABEL" --state open \
        --json number,title,mergeable,mergeStateStatus,createdAt \
        --jq 'sort_by(.createdAt)')" || { say "Не смог получить список PR"; exit 1; }

COUNT="$(printf '%s' "$PRS" | jq 'length')"
if [ "$COUNT" = "0" ]; then
  say "PR с меткой «${LABEL}» нет — раскатывать нечего."
  exit 0
fi

# Берём самый старый ГОДНЫЙ, а не просто самый старый. Раньше скрипт брал `.[0]` и при
# негодном кандидате выходил — один PR с конфликтом в голове очереди блокировал раскатку
# ЦЕЛИКОМ и молча: помечено три PR, чеки зелёные, а ночью не уезжает ничего (issue #239,
# случай 04.09.2026 — #215 висел DIRTY с 03.09 и держал за собой #235 и #237).
# «Один PR за ночь» сохраняется: перебор останавливается на первом годном.
NUM=""; TITLE=""; SKIPPED=""
for i in $(seq 0 $((COUNT - 1))); do
  N="$(printf '%s' "$PRS" | jq -r ".[$i].number")"
  T="$(printf '%s' "$PRS" | jq -r ".[$i].title")"
  M="$(printf '%s' "$PRS" | jq -r ".[$i].mergeable")"
  ST="$(printf '%s' "$PRS" | jq -r ".[$i].mergeStateStatus")"
  # UNKNOWN — это «GitHub ещё не считал», а не «не влить». Мержабельность вычисляется ЛЕНИВО,
  # по запросу: первый ответ про свежий PR (или про любой после сдвига main) приходит UNKNOWN,
  # а следующий — уже CLEAN. Считать это отказом нельзя: скрипт перескочил бы годный PR и
  # раскатал СЛЕДУЮЩИЙ, чего владелец не ждёт. Поэтому переспрашиваем, а пропускаем лишь то,
  # что осталось неопределённым и после повторов.
  ATTEMPT=0
  while { [ "$M" = "UNKNOWN" ] || [ "$ST" = "UNKNOWN" ]; } && [ "$ATTEMPT" -lt 3 ]; do
    ATTEMPT=$((ATTEMPT + 1))
    say "#$N: состояние ещё не посчитано — переспрашиваю ($ATTEMPT/3)"
    sleep 10
    FRESH="$(gh pr view "$N" --repo "$REPO" --json mergeable,mergeStateStatus 2>/dev/null)" || break
    M="$(printf '%s' "$FRESH" | jq -r '.mergeable')"
    ST="$(printf '%s' "$FRESH" | jq -r '.mergeStateStatus')"
  done
  if [ "$M" = "MERGEABLE" ] && [ "$ST" = "CLEAN" ]; then
    NUM="$N"; TITLE="$T"; MERGEABLE="$M"; STATE="$ST"
    say "Кандидат: #$NUM «${TITLE}» (mergeable=$MERGEABLE, состояние=$STATE)"
    break
  fi
  # Негодного НЕ пропускаем молча: метку оставляем, но говорим ему и в лог, почему он потерял
  # очередь — иначе PR стоит неделями, а автор думает, что не наступило окно.
  REASON="не влит: mergeable=$M, состояние=$ST."
  case "$ST" in
    DIRTY)            REASON="$REASON Конфликт с main — нужно развести руками." ;;
    UNSTABLE|BLOCKED) REASON="$REASON Есть красный или не добежавший чек." ;;
    UNKNOWN)          REASON="$REASON GitHub не посчитал состояние даже после трёх попыток." ;;
  esac
  say "Пропускаю #$N «${T}»: $REASON"
  SKIPPED="$SKIPPED $N"
  if [ "$DRY_RUN" != "1" ]; then
    gh pr comment "$N" --repo "$REPO" \
      --body "🌙 Ночная раскатка: $REASON Метку оставил, но очередь не держу — беру следующий PR." >/dev/null || true
  fi
done

if [ -z "$NUM" ]; then
  say "Годных PR с меткой «${LABEL}» нет (пропущено:${SKIPPED:- —}) — раскатывать нечего."
  exit 0
fi
[ -n "$SKIPPED" ] && say "Пропущены как негодные:${SKIPPED}"
REMAINING=$((COUNT - 1))
[ "$REMAINING" -gt 0 ] && say "Ещё помечено: $REMAINING — дождутся следующей ночи (по одному за прогон)."

# ── Раскатка ──────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  say "(dry-run) ВЛИЛ БЫ #$NUM в main → Cloudflare Pages пересобрал бы веб; снял бы метку «${LABEL}»."
  say "(dry-run) что уехало бы из функций:"
  DEPLOY_DRY=1 deploy_functions
  exit 0
fi

gh pr merge "$NUM" --repo "$REPO" --merge \
  --subject "Merge pull request #$NUM (ночная раскатка $(TZ=Europe/Belgrade date '+%d.%m %H:%M'))" \
  || { say "Мёрж отбит"; gh pr comment "$NUM" --repo "$REPO" --body "🌙 Ночная раскатка: мёрж отбит GitHub'ом, метку оставил." >/dev/null; exit 1; }

gh pr edit "$NUM" --repo "$REPO" --remove-label "$LABEL" >/dev/null || say "(метку снять не удалось — снимите вручную)"

SHA="$(gh api "repos/$REPO/commits/main" --jq '.sha[0:7]')"
say "Влито #$NUM, main на $SHA"

deploy_functions
gh pr comment "$NUM" --repo "$REPO" --body "$(cat <<EOF
🌙 **Влито в ночное окно** — $(now_local), main на \`$SHA\`.

Веб пересобирается Cloudflare Pages автоматически (1–5 минут). Edge-функции: **$FUNCS_RESULT**. Метку \`$LABEL\` снял, повторно автоматика этот PR не тронет.

Проверить после сборки: открыть приложение и убедиться, что нужное поведение на месте. Откат — \`git revert -m 1 <коммит мёржа>\`, следующая сборка вернёт как было.
EOF
)" >/dev/null
