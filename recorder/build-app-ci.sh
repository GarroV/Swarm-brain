#!/bin/bash
# CI-сборка ПРЕДсобранного SwarmRecorder.app для дистрибуции (issue #19).
# Universal (arm64 + x86_64), deployment target macOS 13.0 (запускается на 13+), ad-hoc подпись.
# На машине пользователя установщик (swarm-recorder-setup) переподписывает per-machine cert'ом —
# здесь только ad-hoc, чтобы бандл был корректным. Собирается на macOS-раннере (macos-14) в CI,
# а не на dev-машине (там может быть более новый SDK → бинарь не запустится на старой macOS).
#
# Вывод: recorder/SwarmRecorder-<BUILD>.zip (ditto, keepParent). Публикуется как release asset
# тега recorder-build-<BUILD> (см. .github/workflows/recorder-release.yml).
set -euo pipefail
cd "$(dirname "$0")"

BUILD="$(tr -dc '0-9' < VERSION 2>/dev/null || true)"; [ -n "$BUILD" ] || BUILD="1"
TARGET_MIN="13.0"

# ${BUILD} в скобках ОБЯЗАТЕЛЬНО: дальше идёт «…» (U+2026), и bash на macos-раннере приклеивает
# многобайтовый символ к имени переменной → «BUILD…: unbound variable», а set -u валит сборку
# до первого swift build. Так молча не собрались релизы 20/21/22 (issue #40).
echo "[ci] swift build arm64 + x86_64 (macosx${TARGET_MIN}), build ${BUILD}…"
swift build -c release --arch arm64  -Xswiftc -target -Xswiftc "arm64-apple-macosx$TARGET_MIN"
swift build -c release --arch x86_64 -Xswiftc -target -Xswiftc "x86_64-apple-macosx$TARGET_MIN"

APP="SwarmRecorder.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create \
  ".build/arm64-apple-macosx/release/SwarmRecorder" \
  ".build/x86_64-apple-macosx/release/SwarmRecorder" \
  -output "$APP/Contents/MacOS/SwarmRecorder"
lipo -info "$APP/Contents/MacOS/SwarmRecorder"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SwarmRecorder</string>
  <key>CFBundleDisplayName</key><string>Swarm Recorder</string>
  <key>CFBundleExecutable</key><string>SwarmRecorder</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>io.dodobrands.swarmrecorder</string>
  <key>CFBundleVersion</key><string>${BUILD}</string>
  <key>CFBundleShortVersionString</key><string>1.${BUILD}.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>SwarmRecorder записывает звук встречи, чтобы подготовить тезисы.</string>
  <key>NSAudioCaptureUsageDescription</key><string>SwarmRecorder записывает системный звук встречи (собеседников), чтобы подготовить тезисы.</string>
  <key>NSAppleEventsUsageDescription</key><string>SwarmRecorder читает URL активной вкладки браузера, чтобы определить комнату звонка (Meet/Контур) для дедупа встреч.</string>
</dict>
</plist>
PLIST

# Ad-hoc подпись (на машине юзера переподпишется per-machine cert'ом для стабильного TCC).
codesign --force --timestamp=none -s - "$APP"
codesign -dv "$APP" 2>&1 | grep -iE "Identifier|Signature|format" || true

OUT="SwarmRecorder-$BUILD.zip"
rm -f "$OUT"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT"
echo "[ci] готово: $(pwd)/$OUT (build $BUILD)"
