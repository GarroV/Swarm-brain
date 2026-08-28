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

# Два способа спросить прод, и оба обязаны быть надёжными:
#   · локально — `supabase db query --linked` (полный SQL, показывает и имена людей);
#   · в CI — REST (PostgREST) с service-role ключом: у раннера нет и не может быть кэша привязки
#     (supabase/.temp/*, gitignored), а ночная раскатка функций должна работать без человека
#     (docs/decisions/2026-08-27-deploy-at-night.md: «раскатка не должна требовать, чтобы кто-то
#     бодрствовал»). REST-путь включается сам, когда заданы SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
# Fail-closed остаётся: нет ни того, ни другого — отказ, а не тихий проход.
MODE=linked
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  MODE=rest
elif [ ! -s supabase/.temp/pooler-url ]; then
  red "Проверить активность нечем: нет ни привязки к проду, ни REST-доступа."
  echo "  Локально один раз:  supabase link --project-ref $PROJECT_REF" >&2
  echo "  В CI: задать SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY." >&2
  exit 2
fi

# Счётчик строк через PostgREST: Prefer: count=exact отдаёт итог в заголовке Content-Range
# («0-24/1234»). Пустой/непонятный ответ → «СБОЙ», и вызывающий трактует его как «встреча идёт».
rest_count() {
  local path=$1 hdrs
  hdrs=$(curl -sS -I -X GET "$SUPABASE_URL/rest/v1/$path" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Range: 0-0" -H "Prefer: count=exact" 2>&1) || { echo "СБОЙ"; return 0; }
  local total
  total=$(printf '%s' "$hdrs" | tr -d '\r' | awk -F'/' '/^[Cc]ontent-[Rr]ange:/ {print $2}')
  case "$total" in
    ''|*[!0-9]*)
      # Молчать нельзя: «СБОЙ» без причины неотличим от «прод недоступен» и от опечатки в фильтре.
      printf 'REST %s → не понял ответ:\n' "$path" >&2
      printf '%s\n' "$hdrs" | head -3 | sed 's/^/    /' >&2
      echo "СБОЙ" ;;
    *) echo "$total" ;;
  esac
}

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
if [ "$MODE" = "rest" ]; then
  # 'Z' вместо '+00:00': плюс в query-строке PostgREST читает как пробел, фильтр по времени
  # молча становится битым, а ответ — 400. Проверено при первом прогоне.
  FRESH_ISO=$(python3 -c "
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=$RECORDER_FRESH_MIN)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  RECORDING=$(rest_count "allowed_users?select=telegram_id&recorder_last_recording=is.true&recorder_last_seen=gt.$FRESH_ISO")
  PROCESSING=$(rest_count "meetings?select=id&summary_status=eq.processing")
  if [ "$RECORDING" = "СБОЙ" ] || [ "$PROCESSING" = "СБОЙ" ]; then RECORDING="СБОЙ"; fi
  REC_JSON=""
else
REC_JSON=$(q "
select
  (select count(*) from allowed_users
    where recorder_last_recording is true
      and recorder_last_seen > now() - interval '$RECORDER_FRESH_MIN minutes') as recording,
  (select count(*) from meetings where summary_status = 'processing') as processing;
")
fi
# Не смогли прочитать ответ — считаем, что встреча ИДЁТ: непонятное состояние прода не повод
# катить (fail-closed). Иначе упавший запрос молча читался бы как «чисто».
if [ "$MODE" != "rest" ]; then
read -r RECORDING PROCESSING < <(echo "$REC_JSON" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
if not m:
    print('СБОЙ СБОЙ'); sys.exit(0)
r = json.loads(m.group(0))['rows'][0]
print(r['recording'], r['processing'])
")
fi
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

# REST-путь (CI): имён не показываем — PostgREST не сделает union с join'ом, а ради предупреждения
# достаточно факта «кто-то писал». Считаем по трём таблицам, как в SQL-версии.
if [ "$MODE" = "rest" ]; then
  SINCE_ISO=$(python3 -c "
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=$WRITE_WINDOW_MIN)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  T=$(rest_count "tasks?select=id&updated_at=gt.$SINCE_ISO")
  E=$(rest_count "entries?select=id&created_at=gt.$SINCE_ISO")
  C=$(rest_count "task_comments?select=id&created_at=gt.$SINCE_ISO")
  if [ "$T" = "СБОЙ" ] || [ "$E" = "СБОЙ" ] || [ "$C" = "СБОЙ" ]; then
    red "  не удалось прочитать состояние прода — считаю, что люди ЕСТЬ (безопасный дефолт)"
    exit 1
  fi
  TOTAL=$((T + E + C))
  if [ "$TOTAL" -gt 0 ]; then
    red "  правок за $WRITE_WINDOW_MIN мин: задачи $T, записи $E, комментарии $C"
    red "Кто-то работает прямо сейчас — раскатка перезагрузит им страницу."
    exit 1
  fi
  green "  никого"
  head_ "Чисто — можно катить"
  exit 0
fi

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
