#!/usr/bin/env sh
# gate-coverage.sh N [отчёт] — красный, если покрытие строк ниже N процентов.
# Порог относительный: хранится в scripts/coverage-floor.txt и поднимается по факту
# приёмки, а не назначается абсолютной цифрой (решение admissio по замеру 61 дефекта).
set -eu
MIN="${1:?порог в процентах}"; REPORT="${2:-reports/cov.lcov}"
awk -F: -v min="$MIN" '
  /^LF:/ { found += $2 }
  /^LH:/ { hit   += $2 }
  END {
    if (found == 0) { print "покрытие: нет данных — отчёт пуст"; exit 1 }
    pct = hit * 100 / found
    printf "покрытие строк: %.1f%% (порог %s%%)\n", pct, min
    if (pct + 0.0001 < min) exit 1
  }' "$REPORT"
