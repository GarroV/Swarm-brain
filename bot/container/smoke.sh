#!/usr/bin/env bash
# Смоук записи звука и проверка самого смоука.
#
# Четыре прогона подряд, и красный среди первых трёх обязателен:
#   1. звучащая страница          → смоук ОБЯЗАН пройти;
#   2. Chromium с --mute-audio    → смоук ОБЯЗАН покраснеть (это и есть главная грабля);
#   3. молчащая страница          → смоук ОБЯЗАН покраснеть;
#   4. два контейнера параллельно → у соседа ОБЯЗАНА быть тишина (изоляция границей
#      контейнера, а не именем sink'а — sink у обоих одинаковый намеренно).
# Проверка, которая не падает на испорченном входе, — не проверка, поэтому «зелёный» тут
# складывается из одного успеха, двух подтверждённых отказов и одной подтверждённой
# изоляции.
#
#   bot/container/smoke.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${COMPOSE_PROJECT_NAME:-scriba-container}"
SERVICE="${SCRIBA_SMOKE_SERVICE:-scriba}"
CONTAINER="${SCRIBA_SMOKE_CONTAINER:-scriba-container-solo}"
PAIR_A="${SCRIBA_SMOKE_PAIR_A:-scriba-container-a}"
PAIR_B="${SCRIBA_SMOKE_PAIR_B:-scriba-container-b}"
compose() { docker compose -p "$PROJECT" -f "$HERE/docker-compose.yml" "$@"; }

failures=0
step() { # step <что ждём: pass|fail> <контейнер> <название> <переменные окружения...>
  local expectation="$1" container="$2" title="$3"; shift 3
  local env_args=()
  for pair in "$@"; do env_args+=(-e "$pair"); done

  printf '\n──── %s (ждём: %s)\n' "$title" "$expectation"
  docker exec "${env_args[@]}" "$container" node /app/src/container/smoke-audio.ts
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

step pass "$CONTAINER" "1/4 звучащая страница" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/tone.html SCRIBA_SMOKE_EXPECT=sound

step fail "$CONTAINER" "2/4 Chromium с --mute-audio" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/tone.html SCRIBA_SMOKE_EXPECT=sound \
  SCRIBA_SMOKE_FORCE_MUTE=1

step fail "$CONTAINER" "3/4 молчащая страница" \
  SCRIBA_SMOKE_PAGE=file:///opt/scriba/silence.html SCRIBA_SMOKE_EXPECT=sound

printf '\n──── память контейнера под нагрузкой\n'
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' "$CONTAINER"

# ── 4/4 Изоляция двух контейнеров ─────────────────────────────────────────────────────
# Гасим solo, поднимаем пару под profiles=pair. Sink и demo-страница внутри одинаковые
# намеренно: изоляция обязана держаться на границе контейнера, а не на разных именах.
# A звучит, B молчит; ждём, что B ПОДТВЕРДИТ тишину. Если B услышал tone из A — изоляция
# нарушена, шаг покраснеет и это оно.
printf '\n──── 4/4 два контейнера параллельно (ждём: pass — оба)\n'
compose stop "$SERVICE" >/dev/null 2>&1 || true
compose --profile pair up -d scriba-a scriba-b || exit 1
# Тишине нужно чуть больше секунд, чем звуку: должно успеть записаться, что её нет.
docker exec -e SCRIBA_SMOKE_PAGE=file:///opt/scriba/tone.html \
            -e SCRIBA_SMOKE_EXPECT=sound \
            -e SCRIBA_SMOKE_SECONDS=6 \
            "$PAIR_A" node /app/src/container/smoke-audio.ts &
pid_a=$!
docker exec -e SCRIBA_SMOKE_PAGE=file:///opt/scriba/silence.html \
            -e SCRIBA_SMOKE_EXPECT=silence \
            -e SCRIBA_SMOKE_SECONDS=6 \
            "$PAIR_B" node /app/src/container/smoke-audio.ts &
pid_b=$!
wait "$pid_a"; code_a=$?
wait "$pid_b"; code_b=$?

if [ "$code_a" -eq 0 ] && [ "$code_b" -eq 0 ]; then
  printf '✔ 4/4 изоляция подтверждена: A слышит свой tone, B — свою тишину\n'
elif [ "$code_a" -ne 0 ]; then
  printf '✘ 4/4 A (звучащий) не прошёл (код %s) — до изоляции дело не дошло\n' "$code_a" >&2
  failures=$((failures + 1))
else
  printf '✘ 4/4 B услышал звук соседа (код %s) — контейнеры НЕ изолированы\n' "$code_b" >&2
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  printf '\n✘ ИТОГ: %s прогонов из четырёх повели себя не так, как обязаны\n' "$failures" >&2
  exit 1
fi
printf '\n✔ ИТОГ: смоук ловит звук, краснеет на --mute-audio и тишине, изоляция контейнеров держится\n'
