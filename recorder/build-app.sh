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

echo "[3/4] ad-hoc подпись…"
codesign --force --deep -s - "$APP"

echo "[4/4] проверка подписи…"
codesign -v --verbose=2 "$APP" 2>&1 || true

echo "Готово: $(pwd)/$APP"
echo "Запуск:  open $APP   (или двойной клик)"
echo "Логи:    log stream --predicate 'process == \"SwarmRecorder\"'  (или Console.app)"
