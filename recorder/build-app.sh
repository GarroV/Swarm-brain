#!/bin/bash
# Собирает запускаемый SwarmRecorder.app БЕЗ полного Xcode — только CommandLineTools.
# swift build → сборка .app-бандла → ad-hoc подпись. TCC-разрешения работают для локального теста.
# (Полный Xcode не требуется; он лишь удобнее для отладки.)
set -e
cd "$(dirname "$0")"

echo "[1/4] swift build (release)…"
swift build -c release

APP="SwarmRecorder.app"
BIN=".build/release/SwarmRecorder"
echo "[2/4] собираю бандл $APP…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/SwarmRecorder"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SwarmRecorder</string>
  <key>CFBundleDisplayName</key><string>Swarm Recorder</string>
  <key>CFBundleExecutable</key><string>SwarmRecorder</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>io.dodobrands.swarmrecorder</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>SwarmRecorder записывает звук встречи, чтобы подготовить тезисы.</string>
  <key>NSAudioCaptureUsageDescription</key><string>SwarmRecorder записывает системный звук встречи (собеседников), чтобы подготовить тезисы.</string>
  <key>NSAppleEventsUsageDescription</key><string>SwarmRecorder читает URL активной вкладки браузера, чтобы определить комнату звонка (Meet/Контур) для дедупа встреч.</string>
</dict>
</plist>
PLIST

echo "[3/4] подпись…"
# Стабильная самоподпись: TCC привязывает разрешения к designated requirement
# (identifier + certificate leaf), а не к cdhash. Один и тот же cert → DR не меняется
# между пересборками → «System Audio Recording» выдаётся ОДИН раз и держится.
# Ad-hoc (-s -) не имеет cert → DR схлопывается в cdhash → грант слетает каждую сборку.
# Cert создаётся один раз (см. README, раздел «Стабильная подпись (TCC)»).
IDENTITY="SwarmRecorder Self-Signed"
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  # Раньше здесь был молчаливый ad-hoc fallback — он ронял TCC (грант слетал каждую сборку).
  # Теперь это ЖЁСТКАЯ ОШИБКА: без стабильного cert подписывать нельзя, иначе разрешения
  # «System Audio Recording» будут молча сбрасываться. Cert ставится один раз.
  echo "ОШИБКА: нет стабильного cert «$IDENTITY» — без него TCC-разрешения будут слетать." >&2
  echo "        Создай его один раз и повтори сборку:" >&2
  echo "          ./setup-signing.sh" >&2
  echo "        (подробнее — recorder/README.md → «Стабильная подпись (TCC)»)." >&2
  exit 1
fi
codesign --force --timestamp=none -s "$IDENTITY" "$APP"
if codesign -d --requirements - "$APP" 2>&1 | grep -q 'certificate leaf'; then
  echo "  → стабильная подпись (DR cert-based) — TCC-грант переживёт пересборки ✅"
else
  echo "ОШИБКА: подпись не cert-based (DR без certificate leaf) — TCC сбросится"; exit 1
fi

echo "[4/4] проверка подписи…"
codesign -v --verbose=2 "$APP" 2>&1 || true

echo "Готово (бандл собран): $(pwd)/$APP"
echo "НЕ запускай отсюда — установи в /Applications:  ./install.sh"
echo "  (запуск из папки сборки = другой путь → TCC-грант привяжется к нему и сбросится)"
echo "Логи:    log stream --predicate 'process == \"SwarmRecorder\"'  (или Console.app)"
