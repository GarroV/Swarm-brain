#!/usr/bin/env bash
# Поднимает окружение записи и передаёт управление дальше.
#
# Порядок важен и не переставляется: экран → звук → null-sink → sink по умолчанию →
# САМОПРОВЕРКА. Без последнего шага контейнер стартует «успешно» и пишет тишину — тот
# самый молчаливый сбой, ради которого этот блок выделен отдельно.
set -euo pipefail

SINK="${SCRIBA_SINK_NAME:-scriba}"
SCREEN="${SCRIBA_SCREEN:-1280x720x24}"
OUTPUT_DIR="${SCRIBA_OUTPUT_DIR:-/recordings}"
DISPLAY_NUMBER="${DISPLAY#:}"

die() {
  echo "✘ entrypoint: $*" >&2
  exit 1
}

mkdir -p "$XDG_RUNTIME_DIR" "$OUTPUT_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# ── 1. Виртуальный экран ───────────────────────────────────────────────────────────────
# Chromium запускается в headed-режиме: headless чаще ломает звук и чаще палится детектом.
Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp -noreset >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

for _ in $(seq 1 100); do
  [ -e "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] && break
  sleep 0.1
done
[ -e "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] || die "Xvfb не поднял $DISPLAY за 10 с: $(cat /tmp/xvfb.log)"
kill -0 "$XVFB_PID" 2>/dev/null || die "Xvfb умер сразу после старта: $(cat /tmp/xvfb.log)"

# ── 2. Звук ────────────────────────────────────────────────────────────────────────────
# --exit-idle-time=-1 и --disallow-exit: демон не имеет права уйти, пока контейнер жив.
# Без этого PulseAudio тихо выходит в паузе между встречей и записью.
pulseaudio \
  --daemonize=yes \
  --exit-idle-time=-1 \
  --disallow-exit \
  --disable-shm=true \
  --log-target=stderr \
  2>/tmp/pulseaudio.log || die "pulseaudio не стартовал: $(cat /tmp/pulseaudio.log)"

for _ in $(seq 1 100); do
  pactl info >/dev/null 2>&1 && break
  sleep 0.1
done
pactl info >/dev/null 2>&1 || die "pactl не достучался до демона за 10 с: $(cat /tmp/pulseaudio.log)"

# ── 3. Виртуальная звуковая карта ──────────────────────────────────────────────────────
if ! pactl list short sinks | cut -f2 | grep -qx "$SINK"; then
  pactl load-module module-null-sink \
    sink_name="$SINK" \
    sink_properties=device.description="$SINK" >/dev/null \
    || die "не удалось создать null-sink «$SINK»"
fi

# set-default-sink обязателен: без него Chromium уедет в auto_null, а пишем мы из «$SINK».
pactl set-default-sink "$SINK" || die "не удалось выставить «$SINK» sink'ом по умолчанию"
pactl set-default-source "${SINK}.monitor" || die "не удалось выставить monitor-source по умолчанию"

# ── 4. Самопроверка ────────────────────────────────────────────────────────────────────
# monitor-source проверяется, а не предполагается: он появляется вместе с sink'ом, но
# «должен появиться» и «появился» — разные утверждения, и цена разницы здесь высокая.
node /app/src/container/verify-environment.ts || die "самопроверка звука не прошла"

exec "$@"
