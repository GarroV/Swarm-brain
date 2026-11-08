#!/usr/bin/env bash
# Замер CPU и памяти живых контейнеров встреч scriba для сравнения «до/после» SCRIBA_AUDIO_ONLY (#1049).
# Только читает: `docker stats --no-stream` и `docker ps`, ничего не меняет и не останавливает.
#
#   scripts/scriba-meeting-stats.sh [секунды=10] [проект=scriba] > замер.tsv
#
# Каждые N секунд — по строке на контейнер встречи (имя `<проект>-meeting-<run>`):
#   время(UTC)  контейнер  cpu_%  память  память_%  pids
# cpu_% — как у docker: 100 = одно ядро. Прервать — Ctrl+C. Запускать на VPS самому владельцу/оператору.
set -uo pipefail

interval="${1:-10}"
project="${2:-scriba}"

printf 'time_utc\tcontainer\tcpu_pct\tmem\tmem_pct\tpids\n'
while true; do
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  names="$(docker ps --filter "name=^${project}-meeting-" --format '{{.Names}}')"
  if [ -n "$names" ]; then
    # shellcheck disable=SC2086
    docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}' $names |
      while IFS= read -r row; do printf '%s\t%b\n' "$now" "$row"; done
  fi
  sleep "$interval"
done
