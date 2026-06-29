#!/bin/bash
# Установка SwarmRecorder из исходников — без платного Apple-аккаунта.
# Локально собранное приложение Gatekeeper НЕ карантинит, TCC-разрешения стабильны.
# Нужны только Command Line Tools.
set -e
cd "$(dirname "$0")"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ОШИБКА: не найден '$1'. $2" >&2
    exit 1
  fi
}

# Preflight: всё нужное для сборки/подписи должно быть на месте — иначе понятная ошибка.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "ОШИБКА: нет Command Line Tools. Поставь:  xcode-select --install" >&2
  echo "        …дождись установки и повтори ./install.sh" >&2
  exit 1
fi
need_cmd git      "Нужны Command Line Tools (xcode-select --install)."
need_cmd swift    "Нужны Command Line Tools (xcode-select --install)."
need_cmd codesign "Нужны Command Line Tools (xcode-select --install)."

# Стабильная подпись обязательна (иначе TCC-грант слетает). Сам cert НЕ создаём здесь —
# это делает ./setup-signing.sh; build-app.sh подпишет им и упадёт, если cert отсутствует.
# Без -v: недоверенный self-signed cert для ПОДПИСИ годится (codesign -s работает; доверие не нужно).
if ! security find-identity -p codesigning 2>/dev/null | grep -q "SwarmRecorder Self-Signed"; then
  echo "ОШИБКА: нет стабильного cert «SwarmRecorder Self-Signed» — без него разрешения будут слетать." >&2
  echo "        Создай его один раз и повтори:  ./setup-signing.sh" >&2
  exit 1
fi

./build-app.sh

DEST="/Applications/SwarmRecorder.app"
echo "[install] ставлю в $DEST ..."
rm -rf "$DEST"
cp -R SwarmRecorder.app "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true   # на случай, если папка пришла из сети

# Перезапуск: `open` НЕ перезапускает уже работающее приложение — старый процесс остаётся
# в памяти, и свежий бинарник «не виден» (классическое «ничего не изменилось» после пересборки).
# Поэтому сначала глушим старый процесс, потом открываем новый. Во время записи (есть lock) —
# не трогаем: оборвать встречу хуже, чем отложить обновление до её конца.
LOCK="$HOME/Library/Application Support/SwarmRecorder/.recording"
if [ -f "$LOCK" ]; then
  echo "[install] ⚠️ идёт запись — новый бинарник установлен, но НЕ перезапускаю (оборвал бы встречу)."
  echo "[install]    после встречи: ⌘Q рекордера и открой заново — подхватит новую сборку."
else
  echo "[install] глушу старый процесс и открываю свежий…"
  pkill -x SwarmRecorder 2>/dev/null || true
  sleep 1
  open "$DEST"
fi

cat <<'NEXT'

Готово. Дальше:
  1. Токен уже прописан установщиком. Если ставил вручную — вставь через меню рекордера
     «Вставить токен…» (персональный smcp_-токен из бота: /recordertoken).
  2. Выдай разрешение «Screen & System Audio Recording» (системный звук): System Settings →
     Privacy & Security → включи SwarmRecorder (это же — пункт меню «Открыть настройки записи»).
     Затем ВЫЙДИ из рекордера (⌘Q) и открой заново — macOS применяет разрешение после перезапуска.
  3. «Записать встречу» (вручную) или по уведомлению о встрече. Разрешение теперь стабильно:
     выдаётся ОДИН раз и держится между пересборками/обновлениями (стабильная подпись).
NEXT
