#!/usr/bin/env bash
# Проверка хука .githooks/pre-push (issue #943): метка на уже опубликованном коммите не гоняет
# scripts/check, ветка с новыми коммитами — гоняет. Хук запускается напрямую, на stdin — формат git:
# `<local ref> <local sha> <remote ref> <remote sha>`; scripts/check и gitleaks — заглушки.
#   ./scripts/test-pre-push.sh           — прогнать
#   ./scripts/test-pre-push.sh porcha    — порча: убрать пропуск гейта для меток, проверки обязаны покраснеть
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK=${HOOK:-$ROOT/.githooks/pre-push}

if [ "${1:-}" = "porcha" ]; then
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  sed 's#\[\[ "\$_remote_ref" == refs/tags/\* \]\]#false#' "$HOOK" > "$T/h"
  if cmp -s "$HOOK" "$T/h"; then echo "✘ порча не применилась — прогон ложно зелёный"; exit 1; fi
  if HOOK="$T/h" "$0" >"$T/out" 2>&1; then echo "✘ порча: проверки остались зелёными"; exit 1; fi
  echo "✔ порча: проверки покраснели ($(grep -m1 '✘' "$T/out"))"; exit 0
fi

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git init -q --bare "$T/origin.git"
git init -q -b main "$T/w" && cd "$T/w" || exit 1
git config user.email t@t; git config user.name t
git remote add origin "$T/origin.git"
mkdir -p scripts bin
printf '#!/bin/sh\necho ran >> "%s/check.log"\n' "$T" > scripts/check; chmod +x scripts/check
printf '#!/bin/sh\nexit 0\n' > "$T/gitleaks"; chmod +x "$T/gitleaks"
echo a > a; git add -A; git commit -qm base; git push -q origin main
git tag recorder-published                      # метка на опубликованном коммите
echo b > b; git add -A; git commit -qm unpublished
git tag unpublished-tag                         # метка на коммите, которого нет на origin
git fetch -q origin

ZERO=0000000000000000000000000000000000000000
bad=0
# hook <ref> <sha> → $RC; $RAN — запускался ли scripts/check
hook() {
  rm -f "$T/check.log"
  printf '%s %s %s %s\n' "$1" "$2" "$1" "$ZERO" | PATH="$T:$PATH" bash "$HOOK" origin >/dev/null 2>&1; RC=$?
  [ -e "$T/check.log" ] && RAN=1 || RAN=0
}
ok() { echo "✔ $1"; }; ko() { echo "✘ $1 (код $RC, check запускался: $RAN)"; bad=1; }

hook refs/tags/recorder-published "$(git rev-parse recorder-published)"
[ "$RC" = 0 ] && [ "$RAN" = 0 ] && ok "метка на опубликованном коммите — пропущена без scripts/check" || ko "метка на опубликованном коммите"
hook refs/tags/unpublished-tag "$(git rev-parse unpublished-tag)"
[ "$RAN" = 1 ] && ok "метка на неопубликованном коммите — гейт гоняется" || ko "метка на неопубликованном коммите"
hook refs/heads/feat/x "$(git rev-parse HEAD)"
[ "$RAN" = 1 ] && ok "ветка с новыми коммитами — гейт гоняется" || ko "ветка с новыми коммитами"
exit $bad
