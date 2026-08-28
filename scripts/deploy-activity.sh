#!/usr/bin/env bash
# Кто сейчас в проде — проверка ПЕРЕД раскаткой.
#
# Зачем: 27.08.2026 раскатка днём перезагрузила бы страницу под коллегой в момент вычитки
# встречи (пуш в main пересобирает веб → service worker сам делает reload). Ритуал «не забудь
# посмотреть» не работает, поэтому проверка машинная и умеет ОТКАЗАТЬ.
# Канон: docs/decisions/2026-08-27-deploy-notice.md
#
#   ./scripts/deploy-activity.sh          — отчёт + код возврата
#
# Коды возврата:
#   0 — чисто, никого нет
#   1 — люди работали только что (предупреждение: решает человек)
#   2 — СТОП: идёт запись или обработка встречи (данные встречи важнее любой раскатки)
set -euo pipefail

WRITE_WINDOW_MIN=${WRITE_WINDOW_MIN:-10}   # «человек только что работал»
RECORDER_FRESH_MIN=${RECORDER_FRESH_MIN:-3} # heartbeat свежее этого = рекордер жив

PROJECT_REF=vbqglndbxkpmreccpqmr
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# `--linked` ходит в прод через локальный кэш привязки (supabase/.temp/*, gitignored): там же
# лежит IPv4-адрес пулера, без которого CLI пытается подключиться по IPv6 и падает. Кэш
# подделывать нельзя — получается «привязка», которая не работает, что хуже отсутствия.
# Поэтому: нет привязки → отказ с готовой командой (fail-closed), а не тихий проход.
if [ ! -s supabase/.temp/pooler-url ]; then
  red "Этот worktree не привязан к проду, проверить активность нечем."
  echo "  Один раз здесь:  supabase link --project-ref $PROJECT_REF" >&2
  echo "  Либо запускай проверку из главной папки репозитория — она привязана." >&2
  exit 2
fi

# stderr НЕ глушим: с `set -e` упавший запрос давал бы пустой вывод и код 1 — сбой, который
# выглядит как «просто ничего не нашлось». Проверено на себе.
q() {
  local out
  if ! out=$(supabase db query --linked "$1" 2>&1); then
    red "Запрос к проду не прошёл:"
    echo "$out" | sed 's/^/    /' >&2
    return 1
  fi
  echo "$out"
}

# ── 1. Запись/обработка встречи — жёсткий стоп ────────────────────────────────
# recorder_last_recording + recorder_last_seen пишет meeting-heartbeat (allowed_users).
# Признак незавершённой обработки — summary_status = 'processing' (durable-обработка по кускам,
# миграция 20260626120000). ⚠️ НЕ `meetings.status`: там живут in_base/awaiting_review — это
# состояния вычитки, и предикат «status not in (done,error)» давал 144 из 144 строк.
REC_JSON=$(q "
select
  (select count(*) from allowed_users
    where recorder_last_recording is true
      and recorder_last_seen > now() - interval '$RECORDER_FRESH_MIN minutes') as recording,
  (select count(*) from meetings where summary_status = 'processing') as processing;
")
# Не смогли прочитать ответ — считаем, что встреча ИДЁТ: непонятное состояние прода не повод
# катить (fail-closed). Иначе упавший запрос молча читался бы как «чисто».
read -r RECORDING PROCESSING < <(echo "$REC_JSON" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
if not m:
    print('СБОЙ СБОЙ'); sys.exit(0)
r = json.loads(m.group(0))['rows'][0]
print(r['recording'], r['processing'])
")
if [ "$RECORDING" = "СБОЙ" ]; then
  red "Не удалось прочитать состояние прода (supabase db query). Не катим: непонятное состояние — не «чисто»."
  exit 2
fi

head_ "Встречи"
if [ "$RECORDING" != "0" ] || [ "$PROCESSING" != "0" ]; then
  [ "$RECORDING" != "0" ] && red "  ⛔ идёт запись: рекордеров в записи — $RECORDING"
  [ "$PROCESSING" != "0" ] && red "  ⛔ обработка не завершена: встреч в работе — $PROCESSING"
  red "СТОП. Раскатка подождёт: оборванная загрузка куска — это потерянная встреча."
  exit 2
fi
green "  чисто: записи нет, обработка пуста"

# ── 2. Люди — предупреждение ──────────────────────────────────────────────────
head_ "Люди за последние $WRITE_WINDOW_MIN мин"
PEOPLE_JSON=$(q "
with w as (
  select coalesce(assignee_telegram_ids[1], created_by_telegram_id) as uid, updated_at as ts, 'задачи' as what
    from tasks where updated_at > now() - interval '$WRITE_WINDOW_MIN minutes'
  union all
  select owner_id, created_at, 'записи' from entries
   where created_at > now() - interval '$WRITE_WINDOW_MIN minutes'
  union all
  select added_by_telegram_id, created_at, 'комментарии' from task_comments
   where created_at > now() - interval '$WRITE_WINDOW_MIN minutes'
)
select coalesce(nullif(trim(p.first_name || ' ' || coalesce(p.last_name, '')), ''), w.uid::text, 'неизвестно') as who,
       string_agg(distinct w.what, ', ') as what,
       count(*) as n,
       to_char(max(w.ts) at time zone 'Europe/Belgrade', 'HH24:MI') as last_seen
  from w left join user_profiles p on p.telegram_id = w.uid
 group by 1 order by max(w.ts) desc;
")

# Отчёт печатает python, а «есть ли кто» отдаёт кодом возврата: разбирать stdout шелла ради
# одного числа — источник тихих ошибок.
if echo "$PEOPLE_JSON" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
if not m:
    print('  не удалось прочитать ответ базы — считаю, что люди ЕСТЬ (безопасный дефолт)')
    sys.exit(1)
rows = json.loads(m.group(0)).get('rows') or []
for r in rows:
    print(f\"  · {r['who'].strip()} — {r['what']} ({r['n']}), последняя правка {r['last_seen']}\")
if not rows:
    print('  никого')
sys.exit(1 if rows else 0)
"; then
  head_ "Чисто — можно катить"
  exit 0
fi

red "Кто-то работает прямо сейчас — раскатка перезагрузит им страницу."
exit 1
