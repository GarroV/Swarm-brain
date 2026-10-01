#!/usr/bin/env bash
# Заморозка системы на время работ — «идут работы» на экране и отказ в изменениях.
#
# Чем отличается от плашки (./scripts/deploy-notice.sh): плашка ПРЕДУПРЕЖДАЕТ, эта команда
# ЗАПРЕЩАЕТ править данные. Плашка — для обычной ночной раскатки, заморозка — для переезда,
# где правка во время работ либо потеряется, либо ляжет поверх мигрирующей схемы.
#
#   ./scripts/maintenance.sh freeze [МИНУТ]   — заморозить на МИНУТ (по умолчанию 30);
#                                               LEAD_MIN=15 — начать через 15 мин, до того плашка
#   ./scripts/maintenance.sh unfreeze         — снять немедленно (или отменить плановую)
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
    LEAD=${LEAD_MIN:-0}
    if ! [[ "$MIN" =~ ^[0-9]+$ ]] || [ "$MIN" -lt 1 ] || [ "$MIN" -gt "$MAX_MIN" ]; then
      red "Минуты: целое от 1 до $MAX_MIN. Дольше — это уже не работы, а простой: продлите повторно."
      exit 2
    fi
    if ! [[ "$LEAD" =~ ^[0-9]+$ ]] || [ "$LEAD" -gt 1440 ]; then
      red "Начало: через 0..1440 минут, а не «${LEAD}»."
      exit 2
    fi
    # Всё — одной SQL-функцией (миграция 20260928200000, issue #609): плашка-предупреждение до
    # начала, заморозка с начала, уведомление в колокольчик всем рабочим воркспейсам. Одна
    # транзакция: заморозки без предупреждения или предупреждения без заморозки не бывает.
    # Повтор — та же заморозка: уведомления обновляются на месте, дублей нет.
    # Свой текст — только как SQL-строка с удвоенными кавычками (не длиннее 300 — режет функция).
    sql_text() { local q="'" t="${1:0:300}"; printf '%s%s%s' "$q" "${t//$q/$q$q}" "$q"; }
    OUT=$(q "select public.maintenance_announce($LEAD, $MIN, $(sql_text "${MSG_EN:-}"), $(sql_text "${MSG_RU:-}")) as res;") || {
      red "Если выше «function public.maintenance_announce does not exist» — миграция 20260928200000 не накатана."
      exit 1
    }
    echo "$OUT" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
res = (json.loads(m.group(0)).get('rows') or [{}])[0].get('res', {}) if m else {}
res = json.loads(res) if isinstance(res, str) else (res or {})
print(f\"Начало {res.get('starts_at')}, конец {res.get('until')}, уведомлено людей: {res.get('notified')}\")
"
    if [ "$LEAD" -gt 0 ]; then
      green "Объявлено: плашка сейчас, заморозка через $LEAD мин на $MIN мин. Снимется сама по сроку."
    else
      green "Заморожено на $MIN мин. Изменения не принимаются, чтение работает, владелец проходит."
    fi
    echo "Снять раньше срока (или отменить плановую): ./scripts/maintenance.sh unfreeze"
    ;;

  unfreeze)
    q "select public.maintenance_cancel();" >/dev/null || {
      red "Если выше «function public.maintenance_cancel does not exist» — миграция 20260928200000 не накатана."
      exit 1
    }
    green "Заморозка снята (плановая — отменена). Уведомления в колокольчике помечены «отменено»."
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
    v = rows[0]['value']
    until, starts = v.get('until'), v.get('starts_at')
    now = datetime.now(timezone.utc)
    left = (datetime.fromisoformat(until) - now).total_seconds()
    if left <= 0:
        print(f'Срок истёк ({until}) — режим уже не действует, запись снять можно.')
    elif starts and datetime.fromisoformat(starts) > now:
        print(f'Запланировано: заморозка с {starts} до {until}, сейчас висит плашка-предупреждение.')
    else:
        print(f'Заморожено до {until}')
"
    # Во время заморозки обработка встреч стоит (решение 01.10.2026): видно, сколько записей
    # принято и ждёт разморозки — после неё их подхватит первый тик meeting-process.
    WAIT=$(q "select count(*) as n from meetings where summary_status = 'processing';")
    echo "$WAIT" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
rows = json.loads(m.group(0)).get('rows') if m else None
print(f'Записей в обработке или в ожидании: {rows[0][\"n\"] if rows else \"?\"}')
"
    ;;

  *) red "Использование: ./scripts/maintenance.sh [freeze [минут]|unfreeze|status]"; exit 2 ;;
esac
