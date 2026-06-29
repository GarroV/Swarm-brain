#!/bin/bash
# Дев-вотчер рекордера. Запусти ОДИН раз в терминале — дальше каждое изменение кода в
# recorder/Sources/*.swift САМО пересобирается (build-app.sh) и переустанавливается (install.sh).
# Ручной "./build-app.sh && ./install.sh" больше не нужен. Ctrl+C — выйти.
#
# Без зависимостей (poll по mtime раз в 2с). Не пересобирает во время активной записи
# (лок .recording) — чтобы не оборвать встречу; соберёт, как только запись закончится.
set -u
cd "$(dirname "$0")"
LOCK="$HOME/Library/Application Support/SwarmRecorder/.recording"
last=""

echo "👀 Слежу за recorder/Sources — меняю код → авто-сборка + установка."
echo "   (не трогаю во время записи; Ctrl+C — выход)"

while true; do
  cur=$(find Sources -name '*.swift' -exec stat -f '%m' {} \; 2>/dev/null | sort -n | tail -1)
  if [ -n "$cur" ] && [ "$cur" != "$last" ]; then
    if [ -z "$last" ]; then
      last="$cur"                      # первый проход — не пересобираем (уже установлено)
    elif [ -f "$LOCK" ]; then
      :                                # идёт запись — ждём её конца, last НЕ двигаем
    else
      echo ""
      echo "🔁 $(date +%H:%M:%S) изменения → пересборка…"
      if ./build-app.sh >/tmp/swarm-recbuild.log 2>&1 && ./install.sh >>/tmp/swarm-recbuild.log 2>&1; then
        echo "✅ обновлено и перезапущено"
      else
        echo "❌ сборка/установка упала — лог: /tmp/swarm-recbuild.log"
        tail -5 /tmp/swarm-recbuild.log
      fi
      last="$cur"
    fi
  fi
  sleep 2
done
