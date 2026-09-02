#!/bin/bash
# Пересобирает AppIcon.icns из марки Resources/BeeMark.png (тот же файл приложение кладёт в
# бандл для меню-бара и виджета — источник один, разъехаться не может).
set -e
cd "$(dirname "$0")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
swiftc -O -o "$TMP/gen-icon" Sources/RecorderKit/MarkRenderer.swift gen-icon.swift
"$TMP/gen-icon"
iconutil -c icns AppIcon.iconset -o AppIcon.icns
rm -rf AppIcon.iconset
echo "AppIcon.icns пересобран: $(pwd)/AppIcon.icns"
