#!/usr/bin/env bash
# Окно входа аккаунта бота. Порядок: экран → VNC (только localhost внутри контейнера) →
# noVNC наружу → Chromium на странице входа Google → человек вошёл и закрыл браузер →
# выгрузка входа (login-export.ts) → выход. Код выхода — итог: 0 только при сохранённом входе.
#
# Ключ доступа к окну — файл /run/scriba-login/key (монтируется только на чтение), а не
# переменная окружения: окружение видно в описании контейнера. Пароль Google здесь не бывает.
set -euo pipefail

KEY_FILE="${SCRIBA_LOGIN_KEY_FILE:-/run/scriba-login/key}"
OUT_FILE="${SCRIBA_LOGIN_OUT:-/account/google-state.json}"
PROFILE="$(mktemp -d /tmp/scriba-profile.XXXXXX)"
SCREEN="${SCRIBA_LOGIN_SCREEN:-1280x800x24}"
DISPLAY_NUMBER="${DISPLAY#:}"
WIDTH="${SCREEN%%x*}"
HEIGHT="${SCREEN#*x}"
HEIGHT="${HEIGHT%%x*}"

die() {
  echo "✘ login: $*" >&2
  exit 1
}

cleanup() {
  # Профиль браузера — полная копия сессии: после выгрузки он не нужен и не должен остаться.
  rm -rf "$PROFILE" /tmp/scriba-vnc.pass
  kill "${VNC_PID:-}" "${WS_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT

[ -r "$KEY_FILE" ] || die "нет ключа доступа к окну ($KEY_FILE)"
[ -w "$(dirname "$OUT_FILE")" ] || die "каталог входа $(dirname "$OUT_FILE") не доступен на запись"

Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp -noreset >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 100); do
  [ -e "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] && break
  sleep 0.1
done
[ -e "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] || die "Xvfb не поднял $DISPLAY: $(cat /tmp/xvfb.log)"

# VNC слушает только localhost контейнера; наружу смотрит noVNC, и только на адресе Tailscale
# (так публикует порт stand.ps1). Пароль VNC — ключ окна (VNC берёт первые 8 символов).
x11vnc -storepasswd "$(tr -d '\r\n' <"$KEY_FILE")" /tmp/scriba-vnc.pass >/dev/null 2>&1 \
  || die "x11vnc не сохранил пароль окна"
x11vnc -display "$DISPLAY" -rfbauth /tmp/scriba-vnc.pass -localhost -rfbport 5900 \
  -forever -shared -quiet -noxdamage >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
WS_PID=$!
sleep 1
kill -0 "$VNC_PID" 2>/dev/null || die "x11vnc не стартовал: $(cat /tmp/x11vnc.log)"
kill -0 "$WS_PID" 2>/dev/null || die "websockify не стартовал: $(cat /tmp/websockify.log)"
echo "окно входа готово: noVNC на порту 6080 контейнера"

CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
[ -x "$CHROME" ] || die "Chromium из образа Playwright не найден"

# Обычный браузер, не под управлением Playwright: страница входа Google отказывает браузеру
# с флагами автоматизации. Песочница включена (профиль seccomp задаёт запуск контейнера).
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  --lang=en-US \
  --window-position=0,0 \
  --window-size="${WIDTH},${HEIGHT}" \
  "https://accounts.google.com/ServiceLogin?hl=en&continue=https%3A%2F%2Fmeet.google.com%2F%3Fhl%3Den" \
  >/tmp/chrome.log 2>&1 || true
echo "браузер закрыт — выгружаю вход"

# Итог выгрузки — строкой рядом со входом: контейнер окна убирается сам, и его журнал вместе
# с ним. В строке только вердикт и время, без содержимого входа.
RESULT="$(dirname "$OUT_FILE")/last-login.txt"
set +e
node /app/src/orchestrator/login-export.ts "$PROFILE" "$OUT_FILE" 2>&1 | tee /tmp/export.log
CODE=${PIPESTATUS[0]}
set -e
{ date -u '+%Y-%m-%dT%H:%M:%SZ'; grep -E '✔|✘' /tmp/export.log | tail -1; } >"$RESULT"
exit "$CODE"
