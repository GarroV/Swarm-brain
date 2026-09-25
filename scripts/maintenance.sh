#!/usr/bin/env bash
# Заморозка системы на время работ — «идут работы» на экране и отказ в изменениях.
#
# Чем отличается от плашки (./scripts/deploy-notice.sh): плашка ПРЕДУПРЕЖДАЕТ, эта команда
# ЗАПРЕЩАЕТ править данные. Плашка — для обычной ночной раскатки, заморозка — для переезда,
# где правка во время работ либо потеряется, либо ляжет поверх мигрирующей схемы.
#
#   ./scripts/maintenance.sh freeze [МИНУТ]   — заморозить (по умолчанию 30)
#   ./scripts/maintenance.sh unfreeze         — снять немедленно
#   ./scripts/maintenance.sh status           — что сейчас
#
# ⚠️ Это ПРАВКА ПРОД-ДАННЫХ и остановка работы команды — по правилу раскатки только по явному
# «да» владельца (docs/decisions/2026-08-24-deploy-window.md).
#
# Срок ОБЯЗАТЕЛЕН и ограничен сверху: режим гаснет сам, даже если скрипт упал, сессия
# оборвалась, а человек ушёл спать. Забытая заморозка — это лежащий продукт, и единственная
# защита от неё — срок годности в самих данных, а не в чьей-то памяти.
set -euo pipefail

PROJECT_REF=vbqglndbxkpmreccpqmr
KEY=maintenance
MAX_MIN=180
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

if [ ! -s supabase/.temp/pooler-url ]; then
  red "Этот worktree не привязан к проду."
  echo "  Один раз здесь:  supabase link --project-ref $PROJECT_REF" >&2
  exit 2
fi

q() {
  local out
  if ! out=$(supabase db query --linked "$1" 2>&1); then
    red "Запрос к проду не прошёл:"
    echo "$out" | sed 's/^/    /' >&2
    return 1
  fi
  echo "$out"
}

case "${1:-status}" in
  freeze)
    MIN=${2:-30}
    if ! [[ "$MIN" =~ ^[0-9]+$ ]] || [ "$MIN" -lt 1 ] || [ "$MIN" -gt "$MAX_MIN" ]; then
      red "Минуты: целое от 1 до $MAX_MIN. Дольше — это уже не работы, а простой: продлите повторно."
      exit 2
    fi
    # Тексты двуязычные с первой версии: продукт говорит по-английски и по-русски.
    MSG_EN=${MSG_EN:-"Swarm is being updated. Your data is safe — please come back in a few minutes."}
    MSG_RU=${MSG_RU:-"Идёт обновление Swarm. Данные на месте — зайдите, пожалуйста, через несколько минут."}
    q "
      insert into app_settings (key, value, updated_at)
      values ('$KEY', jsonb_build_object(
        'until',      to_jsonb((now() + interval '$MIN minutes')::timestamptz),
        'started_at', to_jsonb(now()::timestamptz),
        'message_en', to_jsonb('$MSG_EN'::text),
        'message_ru', to_jsonb('$MSG_RU'::text)
      ), now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    " >/dev/null
    green "Заморожено на $MIN мин. Изменения не принимаются, чтение работает, владелец проходит."
    echo "Снять раньше срока: ./scripts/maintenance.sh unfreeze"
    ;;

  unfreeze)
    q "delete from app_settings where key = '$KEY';" >/dev/null
    green "Заморозка снята."
    ;;

  status)
    OUT=$(q "select value from app_settings where key = '$KEY';")
    echo "$OUT" | python3 -c "
import json, re, sys
from datetime import datetime, timezone
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
rows = json.loads(m.group(0)).get('rows') if m else None
if not rows:
    print('Заморозки нет.')
else:
    until = rows[0]['value'].get('until')
    left = (datetime.fromisoformat(until) - datetime.now(timezone.utc)).total_seconds()
    print(f'Заморожено до {until}' if left > 0 else f'Срок истёк ({until}) — режим уже не действует, запись снять можно.')
"
    ;;

  *) red "Использование: ./scripts/maintenance.sh [freeze [минут]|unfreeze|status]"; exit 2 ;;
esac
