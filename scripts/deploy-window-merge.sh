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
#   · Ничего не деплоит сама: edge-функции, миграции и рекордер идут своими путями.
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

NUM="$(printf '%s' "$PRS" | jq -r '.[0].number')"
TITLE="$(printf '%s' "$PRS" | jq -r '.[0].title')"
MERGEABLE="$(printf '%s' "$PRS" | jq -r '.[0].mergeable')"
STATE="$(printf '%s' "$PRS" | jq -r '.[0].mergeStateStatus')"
say "Кандидат: #$NUM «${TITLE}» (mergeable=$MERGEABLE, состояние=$STATE)"
[ "$COUNT" -gt 1 ] && say "Ещё помечено: $((COUNT-1)) — они дождутся следующей ночи (по одному за прогон)."

# ── Гейты ─────────────────────────────────────────────────────────────────────
if [ "$MERGEABLE" != "MERGEABLE" ] || [ "$STATE" != "CLEAN" ]; then
  REASON="не влит: mergeable=$MERGEABLE, состояние=$STATE."
  case "$STATE" in
    DIRTY)    REASON="$REASON Конфликт с main — нужно развести руками." ;;
    UNSTABLE|BLOCKED) REASON="$REASON Есть красный или не добежавший чек." ;;
    UNKNOWN)  REASON="$REASON GitHub ещё считает состояние — попробую следующей ночью." ;;
  esac
  say "$REASON"
  if [ "$DRY_RUN" = "1" ]; then say "(dry-run: комментарий не пишу)"; exit 0; fi
  gh pr comment "$NUM" --repo "$REPO" \
    --body "🌙 Ночная раскатка: $REASON Метку оставил — вернусь следующей ночью." >/dev/null
  exit 0
fi

# ── Раскатка ──────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  say "(dry-run) ВЛИЛ БЫ #$NUM в main → Cloudflare Pages пересобрал бы веб; снял бы метку «${LABEL}»."
  exit 0
fi

gh pr merge "$NUM" --repo "$REPO" --merge \
  --subject "Merge pull request #$NUM (ночная раскатка $(TZ=Europe/Belgrade date '+%d.%m %H:%M'))" \
  || { say "Мёрж отбит"; gh pr comment "$NUM" --repo "$REPO" --body "🌙 Ночная раскатка: мёрж отбит GitHub'ом, метку оставил." >/dev/null; exit 1; }

gh pr edit "$NUM" --repo "$REPO" --remove-label "$LABEL" >/dev/null || say "(метку снять не удалось — снимите вручную)"

SHA="$(gh api "repos/$REPO/commits/main" --jq '.sha[0:7]')"
say "Влито #$NUM, main на $SHA"
gh pr comment "$NUM" --repo "$REPO" --body "$(cat <<EOF
🌙 **Влито в ночное окно** — $(now_local), main на \`$SHA\`.

Веб пересобирается Cloudflare Pages автоматически (1–5 минут). Метку \`$LABEL\` снял, повторно автоматика этот PR не тронет.

Проверить после сборки: открыть приложение и убедиться, что нужное поведение на месте. Откат — \`git revert -m 1 <коммит мёржа>\`, следующая сборка вернёт как было.
EOF
)" >/dev/null
