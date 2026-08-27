#!/bin/bash
# Пересобирает AppIcon.icns из кода марки (RoyArt.swift) — иконка приложения рисуется, а не лежит
# картинкой. Два файла компилируются вместе, поэтому геометрия у иконки и меню-бара одна.
set -e
cd "$(dirname "$0")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# top-level код при сборке нескольких файлов допустим только в main.swift — копируем под этим именем
cp gen-icon.swift "$TMP/main.swift"
swiftc -O -o "$TMP/gen-icon" "$TMP/main.swift" Sources/SwarmRecorder/RoyArt.swift
"$TMP/gen-icon"
iconutil -c icns AppIcon.iconset -o AppIcon.icns
rm -rf AppIcon.iconset
echo "AppIcon.icns пересобран: $(pwd)/AppIcon.icns"
