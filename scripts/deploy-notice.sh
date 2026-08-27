#!/usr/bin/env bash
# Объявление «скоро обновление» — плашка в вебе.
#
# Зачем: пуш в main пересобирает веб, после чего service worker сам перезагружает открытые
# страницы. Люди должны узнать об этом заранее, а не поймать reload посреди правки.
# Канон: docs/decisions/2026-08-27-deploy-notice.md
#
#   ./scripts/deploy-notice.sh set [МИНУТ]   — объявить (по умолчанию через 15 мин)
#   ./scripts/deploy-notice.sh off           — снять
#   ./scripts/deploy-notice.sh show          — что сейчас объявлено
#
# ⚠️ Это ПРАВКА ПРОД-ДАННЫХ, то есть по правилу раскатки — под «да» владельца
# (docs/decisions/2026-08-24-deploy-window.md). Строка не секретная и гаснет сама, но
# запускать её «просто посмотреть» не надо.
#
# `until` = at + GRACE: плашка гаснет САМА, даже если скрипт упал и не снял её. Забытая
# плашка «идёт обновление» на неделю — ровно тот молчаливый сбой, который мы ловим в других
# местах, поэтому срок годности зашит в данные, а не в дисциплину.
set -euo pipefail

LEAD_MIN=${2:-15}     # за сколько минут предупреждаем
GRACE_MIN=${GRACE_MIN:-20} # сколько плашка живёт ПОСЛЕ момента раскатки

PROJECT_REF=vbqglndbxkpmreccpqmr
KEY=deploy_notice
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

case "${1:-show}" in
  set)
    # to_jsonb от timestamptz даёт полный ISO со смещением (+00:00) — такой формат парсится
    # Date() во всех браузерах, в отличие от усечённого «+00».
    q "
      insert into app_settings (key, value, updated_at)
      values ('$KEY', jsonb_build_object(
        'at',    to_jsonb((now() + interval '$LEAD_MIN minutes')::timestamptz),
        'until', to_jsonb((now() + interval '$((LEAD_MIN + GRACE_MIN)) minutes')::timestamptz)
      ), now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    " >/dev/null
    green "Объявлено: обновление через $LEAD_MIN мин, плашка гаснет сама через $((LEAD_MIN + GRACE_MIN)) мин."
    echo "Дальше: подождать, затем ./scripts/deploy-window.sh go (он снимет объявление сам)."
    ;;

  off)
    q "delete from app_settings where key = '$KEY';" >/dev/null
    green "Объявление снято."
    ;;

  show)
    OUT=$(q "select value, updated_at from app_settings where key = '$KEY';")
    echo "$OUT" | python3 -c "
import json, re, sys
m = re.search(r'\{.*\}', sys.stdin.read(), re.S)
rows = json.loads(m.group(0)).get('rows') if m else None
if not rows:
    print('Объявления нет.')
else:
    v = rows[0]['value']
    print(f\"Объявлено: раскатка {v.get('at')}, плашка гаснет {v.get('until')}\")
"
    ;;

  *) red "Использование: ./scripts/deploy-notice.sh [set [минут]|off|show]"; exit 2 ;;
esac
