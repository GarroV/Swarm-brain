#!/usr/bin/env bash
# Смоук записи звука и проверка самого смоука.
#
# Три прогона подряд, и красный среди них обязателен:
#   1. звучащая страница          → смоук ОБЯЗАН пройти;
#   2. Chromium с --mute-audio    → смоук ОБЯЗАН покраснеть (это и есть главная грабля);
#   3. молчащая страница          → смоук ОБЯЗАН покраснеть.
# Проверка, которая не падает на испорченном входе, — не проверка, поэтому «зелёный» тут
# складывается из одного успеха и двух подтверждённых отказов.
#
#   bot/container/smoke.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${COMPOSE_PROJECT_NAME:-scriba-container}"
SERVICE="${SCRIBA_SMOKE_SERVICE:-scriba}"
CONTAINER="${SCRIBA_SMOKE_CONTAINER:-scriba-container-solo}"
compose() { docker compose -p "$PROJECT" -f "$HERE/docker-compose.yml" "$@"; }

failures=0
step() { # step <что ждём: pass|fail> <название> <переменные окружения...>
  local expectation="$1" title="$2"; shift 2
  local env_args=()
  for pair in "$@"; do env_args+=(-e "$pair"); done

  printf '\n──── %s (ждём: %s)\n' "$title" "$expectation"
  docker exec "${env_args[@]}" "$CONTAINER" node /app/src/container/smoke-audio.ts
  local code=$?

  if [ "$expectation" = pass ] && [ "$code" -eq 0 ]; then
    printf '✔ %s: прошёл, как и должен\n' "$title"
  elif [ "$expectation" = fail ] && [ "$code" -ne 0 ]; then
    printf '✔ %s: покраснел, как и должен (код %s)\n' "$title" "$code"
  else
    printf '✘ %s: код %s — это НЕ то, чего ждали\n' "$title" "$code"
    failures=$((failures + 1))
  fi
}

compose up -d "$SERVICE" || exit 1

step pass "1/3 звучащая страница" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/tone.html SCRIBA_SMOKE_EXPECT=sound

step fail "2/3 Chromium с --mute-audio" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/tone.html SCRIBA_SMOKE_EXPECT=sound \
  SCRIBA_SMOKE_FORCE_MUTE=1

step fail "3/3 молчащая страница" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/silence.html SCRIBA_SMOKE_EXPECT=sound

printf '\n──── память контейнера под нагрузкой\n'
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' "$CONTAINER"

if [ "$failures" -ne 0 ]; then
  printf '\n✘ ИТОГ: %s прогонов из трёх повели себя не так, как обязаны\n' "$failures" >&2
  exit 1
fi
printf '\n✔ ИТОГ: смоук ловит звук и краснеет и на --mute-audio, и на тишине\n'
