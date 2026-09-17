#!/usr/bin/env bash
# Порог покрытия — ОТНОСИТЕЛЬНЫЙ: не ниже, чем на прошлой приёмке этого проекта.
# Абсолютная цифра остаётся ориентиром в принципах проекта, но блок по ней не
# заворачивается: абсолютный порог подталкивает дописывать тесты без ассертов ради
# процента, а такой тест засчитывается выполненной проверкой.
#
# Считаем по lcov: LF — строк всего, LH — строк покрыто. У `deno coverage` флага
# порога нет вовсе, у vitest он абсолютный — поэтому считаем сами, одинаково для
# обоих стеков.
#
# Использование: scripts/gate-coverage.sh <путь к lcov.info> <имя базы>
set -euo pipefail

lcov_path="${1:?укажите путь к lcov.info}"
baseline_name="${2:?укажите имя базы, например bot или server}"
promote="${3:-}"   # --promote: поднять базу. Зовёт ТОЛЬКО диспетчер на приёмке.
baseline_file="reports/coverage-baseline-${baseline_name}.txt"

if [[ ! -s "$lcov_path" ]]; then
  echo "КРАСНЫЙ: отчёт о покрытии $lcov_path пуст или отсутствует." >&2
  echo "Пустой отчёт означает, что прогон не регистрировал проверок, а не что покрытие полное." >&2
  exit 1
fi

read -r found hit < <(awk -F: '
  /^LF:/ { found += $2 }
  /^LH:/ { hit   += $2 }
  END    { print found+0, hit+0 }
' "$lcov_path")

if [[ "$found" -eq 0 ]]; then
  echo "КРАСНЫЙ: в $lcov_path ноль исполняемых строк (LF=0) — измерять нечего." >&2
  exit 1
fi

current=$(awk -v h="$hit" -v f="$found" 'BEGIN { printf "%.2f", h * 100 / f }')

if [[ ! -f "$baseline_file" ]]; then
  mkdir -p "$(dirname "$baseline_file")"
  printf '%s\n' "$current" > "$baseline_file"
  echo "БАЗА: покрытие $baseline_name = ${current}% записано как отправная точка ($hit/$found строк)."
  echo "Условие «не ниже прошлой приёмки» начнёт применяться со следующего прогона."
  exit 0
fi

baseline=$(tr -d '[:space:]' < "$baseline_file")

if awk -v c="$current" -v b="$baseline" 'BEGIN { exit !(c + 0.005 < b) }'; then
  echo "КРАСНЫЙ: покрытие $baseline_name упало — было ${baseline}%, стало ${current}% ($hit/$found строк)." >&2
  echo "Порог относительный: падение и есть то, ради чего роль заведена." >&2
  exit 1
fi

echo "покрытие $baseline_name: ${current}% (база ${baseline}%, $hit/$found строк)"

# Базу поднимает ТОЛЬКО приёмка, и только явным флагом. Причина конкретная: строка
# базы одна на всех, а блоки идут параллельно в своих копиях. Поднимая её у себя,
# каждый блок готовит конфликт при слиянии и, что хуже, поднимает порог соседям,
# которые под него не работали. Замечено блоком conference-link на первой же сдаче.
if awk -v c="$current" -v b="$baseline" 'BEGIN { exit !(c > b) }'; then
  if [[ "$promote" == "--promote" ]]; then
    printf '%s\n' "$current" > "$baseline_file"
    echo "база поднята до ${current}% (приёмка)"
  else
    echo "покрытие выросло на $(awk -v c="$current" -v b="$baseline" 'BEGIN{printf "%.2f", c-b}') п.п. — базу поднимет приёмка (--promote)"
  fi
fi
