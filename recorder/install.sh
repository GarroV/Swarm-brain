#!/bin/bash
# Установка SwarmRecorder из исходников — без платного Apple-аккаунта.
# Локально собранное приложение Gatekeeper НЕ карантинит, TCC-разрешения стабильны.
# Нужны только Command Line Tools.
set -e
cd "$(dirname "$0")"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Нужны Command Line Tools. Запусти:  xcode-select --install"
  echo "…дождись установки и повтори ./install.sh"
  exit 1
fi

./build-app.sh

DEST="/Applications/SwarmRecorder.app"
echo "[install] ставлю в $DEST…"
rm -rf "$DEST"
cp -R SwarmRecorder.app "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true   # на случай, если папка пришла из сети

echo "[install] открываю…"
open "$DEST"

cat <<'NEXT'

Готово. Дальше:
  1. Иконка в меню-баре → «Вставить токен…» (персональный smcp_-токен из бота: /mytoken).
  2. Выдай разрешение «Screen & System Audio Recording» (системный звук): System Settings →
     Privacy & Security → включи SwarmRecorder (это же — пункт меню «Открыть настройки записи»).
     Затем ВЫЙДИ из рекордера (⌘Q) и открой заново — macOS применяет разрешение после перезапуска.
  3. «Записать встречу» (вручную) или по уведомлению о встрече. Разрешение теперь стабильно:
     выдаётся ОДИН раз и держится между пересборками/обновлениями (стабильная подпись).
NEXT
