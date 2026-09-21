#!/bin/sh
# Раскатка стенда на GitHub Pages одной командой.
#
# Ветка `stand` — это ВИТРИНА, а не история: в ней лежит только собранный стенд,
# и каждая раскатка перезаписывает её целиком (force). Держать там что-то ценное
# нельзя. Исходник живёт в docs/redesign/stand на рабочей ветке.
#
# Почему отдельная ветка, а не Pages из /docs: Pages отдаёт весь корень, и из /docs
# наружу уехала бы вся внутренняя документация как сайт. Здесь наружу видно ровно
# то, что мы показываем коллегам.
#
# Использование:  sh docs/redesign/stand/publish.sh
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$SRC" rev-parse --show-toplevel)
REMOTE=$(git -C "$REPO" remote get-url origin)
FROM=$(git -C "$REPO" rev-parse --short HEAD)

# стенд обязан быть зелёным: витрину с поломанной вёрсткой коллегам не отдаём
node "$SRC/check.js" >/dev/null || { echo "СТОП: прогон стенда красный, наружу не катим"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R "$SRC"/. "$TMP"/
rm -rf "$TMP/check.js" "$TMP/publish.sh"
# Jekyll на статике только мешает; robots закрывает черновик от поисковиков
: > "$TMP/.nojekyll"
printf 'User-agent: *\nDisallow: /\n' > "$TMP/robots.txt"

cd "$TMP"
git init -q
git checkout -q -b stand
git add -A
git -c user.name="$(git -C "$REPO" config user.name)" -c user.email="$(git -C "$REPO" config user.email)" \
  commit -qm "stand: раскатка из $FROM"
git push -q --force "$REMOTE" stand
echo "раскатано из $FROM → https://garrov.github.io/Swarm-brain/"
