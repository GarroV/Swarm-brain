#!/usr/bin/env bash
# Включить проверку секрета вебхука swarm-bot в проде — одним прогоном, в правильном порядке.
#
# Порядок задан самим устройством бота (две переменные намеренно, см. ARCHITECTURE §env):
#   1. TELEGRAM_WEBHOOK_SECRET — новое случайное значение;
#   2. set_webhook — Telegram узнаёт секрет и начинает присылать его в заголовке;
#   3. TELEGRAM_WEBHOOK_ENFORCE=1 — бот отбивает апдейты без секрета;
#   4. проверка: запрос без секрета получает 401, а Telegram не жалуется на ошибки доставки.
# Если отбивку включить раньше шага 2, бот перестанет отвечать людям.
#
# set_webhook и webhook_info — cron-триггеры бота, им нужен X-Cron-Secret. Его значения в CI
# нет, поэтому вызов идёт из самой базы через pg_net с теми же заголовками, что у задания
# pg_cron `daily-report`: секрет не покидает базу и не попадает в журнал прогона.
#
# Запуск: CI-кнопка «Секрет вебхука бота (руками)» (.github/workflows/bot-webhook-secret.yml).
# Нужны SUPABASE_ACCESS_TOKEN и привязка `supabase link` (делает workflow).
set -euo pipefail

PROJECT_REF=vbqglndbxkpmreccpqmr
BOT_URL="https://${PROJECT_REF}.supabase.co/functions/v1/swarm-bot"
# Сколько ждать, пока функции подхватят новые секреты, и ответа pg_net.
SECRETS_SETTLE_SEC=20
RESPONSE_POLL_TRIES=30

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

q() {
  local out
  if ! out=$(supabase db query --linked "$1" 2>&1); then
    red "Запрос к проду не прошёл:"
    echo "$out" | sed 's/^/    /' >&2
    return 1
  fi
  echo "$out"
}

# Дёрнуть cron-триггер бота из базы и вернуть тело ответа (JSON одной строкой).
bot_trigger() {
  local flag="$1" id out
  out=$(q "
    select 'REQ=' || net.http_post(
      url := '$BOT_URL',
      body := jsonb_build_object('$flag', true),
      headers := (substring(command from 'headers := ''(\{[^'']*\})''::jsonb'))::jsonb
    ) from cron.job where jobname = 'daily-report';
  ")
  id=$(echo "$out" | grep -o 'REQ=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "$id" ] || { red "pg_net не принял запрос $flag (нет задания daily-report?)"; return 1; }
  for _ in $(seq "$RESPONSE_POLL_TRIES"); do
    sleep 2
    out=$(q "select 'CODE=' || coalesce(status_code::text, 'null') || ' BODY=' || coalesce(content, '')
             from net._http_response where id = $id;")
    if echo "$out" | grep -q 'CODE='; then
      if ! echo "$out" | grep -q 'CODE=200'; then
        red "$flag: бот ответил не 200: $(echo "$out" | grep -o 'CODE=[^ ]*')"
        return 1
      fi
      echo "$out" | grep -o 'BODY=.*' | cut -d= -f2-
      return 0
    fi
  done
  red "$flag: нет ответа от бота за $((RESPONSE_POLL_TRIES * 2)) с"
  return 1
}

probe_code() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BOT_URL" -H 'Content-Type: application/json' --data 'x'
}

echo "1/4 Новый TELEGRAM_WEBHOOK_SECRET"
SECRET=$(openssl rand -hex 32)
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$SECRET"
supabase secrets set --project-ref "$PROJECT_REF" "TELEGRAM_WEBHOOK_SECRET=$SECRET" >/dev/null
unset SECRET
sleep "$SECRETS_SETTLE_SEC"

echo "2/4 set_webhook — сообщить секрет Telegram"
RESP=$(bot_trigger set_webhook)
if ! echo "$RESP" | grep -q '"ok":true'; then
  red "Telegram не принял setWebhook: $RESP"
  red "Отбивку НЕ включаю — бот работает как раньше."
  exit 1
fi
green "   Telegram принял вебхук с секретом"

echo "3/4 TELEGRAM_WEBHOOK_ENFORCE=1"
supabase secrets set --project-ref "$PROJECT_REF" "TELEGRAM_WEBHOOK_ENFORCE=1" >/dev/null
sleep "$SECRETS_SETTLE_SEC"

echo "4/4 Проверка"
CODE=$(probe_code)
if [ "$CODE" != "401" ]; then
  red "Запрос без секрета получил $CODE, ждали 401. Проверь, раскатан ли swarm-bot с ENFORCE."
  exit 1
fi
green "   Запрос без секрета: 401"
INFO=$(bot_trigger webhook_info)
echo "   webhook_info: $(echo "$INFO" | grep -o '"pending_update_count":[0-9]*' || true) $(echo "$INFO" | grep -o '"last_error_message":"[^"]*"' || true)"
if echo "$INFO" | grep -q '"last_error_message":"[^"]*401'; then
  red "Telegram получает 401 — секрет у него не тот. Откат: supabase secrets unset TELEGRAM_WEBHOOK_ENFORCE"
  exit 1
fi
green "Готово: бот принимает только апдейты с секретом. Напиши боту в Telegram — он должен ответить."
