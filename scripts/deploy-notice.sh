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
# Свой текст плашки вместо «Обновление через N мин» — переменные NOTICE_RU / NOTICE_EN
# (веб показывает их как есть, см. DeployNoticeBar). Тот же скрипт зовёт кнопка в Actions
# `.github/workflows/notice.yml` — она ходит на сервер ключом шлюза из секретов репозитория.
# С 16.10.2026 (#978) скрипт говорит с прод-базой через команду `maintenance` шлюза раскатки
# (deploy/server/gate.sh), а не через облачный `supabase link`: SQL зашит в шлюзе, сюда уходят
# только числа и текст плашки.
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
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"
# shellcheck source=lib/swarm-server.sh
. "$REPO_ROOT/scripts/lib/swarm-server.sh"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# Текст — в одну строку каждый (шлюз читает ровно две строки: русский, английский).
one_line() { printf '%s' "${1:-}" | tr '\r\n' '  '; }

case "${1:-show}" in
  set)
    case "$LEAD_MIN" in ''|*[!0-9]*) red "Минуты — целое число, а не «${LEAD_MIN}»"; exit 2 ;; esac
    printf '%s\n%s\n' "$(one_line "${NOTICE_RU:-}")" "$(one_line "${NOTICE_EN:-}")" \
      | swarm_server maintenance notice "$LEAD_MIN" >/dev/null
    green "Объявлено: обновление через $LEAD_MIN мин, плашка гаснет сама через $((LEAD_MIN + 20)) мин."
    echo "Дальше: подождать, затем ./scripts/deploy-window.sh go (он снимет объявление сам)."
    ;;

  off)
    swarm_server maintenance notice-off </dev/null >/dev/null
    green "Объявление снято."
    ;;

  show)
    swarm_server maintenance notice-show </dev/null
    ;;

  *) red "Использование: ./scripts/deploy-notice.sh [set [минут]|off|show]"; exit 2 ;;
esac
