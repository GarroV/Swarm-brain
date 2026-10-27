#!/usr/bin/env bash
# Сторож «MCP снаружи» (#1082): путь до Swarm MCP целиком и снаружи, без токена и без секретов.
# Зовёт .github/workflows/mcp-outside.yml; локально: MCP_FUNCTIONS_URL=https://…/functions/v1 scripts/mcp-outside.sh
#
# Здоровая картина СЕГОДНЯ (замерено 27.10.2026; поведение сервера не менялось):
#   · initialize без токена  → HTTP 200 и serverInfo (рукопожатие работает и без токена);
#   · tools/call без токена  → JSON-RPC error -32001 «Unauthorized», НЕ result (дверь на данные заперта);
#   · GET swarm-setup        → HTTP 200 и bash-скрипт установщика;
#   · GET swarm-setup/version и /bridge согласованы: sha256 из /version == sha256 тела /bridge.
# Если сервер перейдёт на стандарт «без токена — HTTP 401 с resource_metadata» (mcp-server), ожидание
# initialize поменять здесь и в docs/SETUP_CLAUDE_DESKTOP.md.
#
# Свой User-Agent: на стандартный curl/Python-urllib край Cloudflare может ответить 403 (проверка
# браузера) — сторож краснел бы на исправной двери.
set -u

BASE="${MCP_FUNCTIONS_URL:-}"
if [ -z "$BASE" ]; then
  echo "не задан MCP_FUNCTIONS_URL — сторожу нечего проверять" >&2
  exit 2
fi
BASE="${BASE%/}"
UA="swarm-mcp-watch/1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() {
  # Адрес в сообщение не подставляется: проверяется только форма ответов.
  echo "MCP СНАРУЖИ НЕДОСТУПЕН: $*" >&2
  exit 1
}

# $1 — метка, $2 — url, $3 — тело POST (пусто = GET). Результат: код в CODE, тело в $WORK/body.
probe() {
  if [ -n "$3" ]; then
    CODE="$(curl -sS --max-time 15 -A "$UA" -X POST "$2" -H 'Content-Type: application/json' -d "$3" -o "$WORK/body" -w '%{http_code}' 2>"$WORK/err")" \
      || fail "$1: адрес не ответил ($(head -c 120 "$WORK/err" | tr -d '\n'))"
  else
    CODE="$(curl -sS --max-time 15 -A "$UA" "$2" -o "$WORK/body" -w '%{http_code}' 2>"$WORK/err")" \
      || fail "$1: адрес не ответил ($(head -c 120 "$WORK/err" | tr -d '\n'))"
  fi
}

probe "initialize" "$BASE/swarm-mcp" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
[ "$CODE" = "200" ] || fail "initialize без токена отвечает $CODE, а не 200"
grep -q '"serverInfo"' "$WORK/body" || fail "initialize без токена вернул ответ без serverInfo"
echo "рукопожатие отвечает (initialize без токена: $CODE, serverInfo есть)"

probe "tools/call" "$BASE/swarm-mcp" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_tasks","arguments":{}}}'
grep -q '"error"' "$WORK/body" || fail "tools/call без токена не вернул отказ (HTTP $CODE) — дверь на данные открыта или сломана"
grep -q '"result"' "$WORK/body" && fail "tools/call без токена вернул result — дверь на данные открыта"
echo "дверь на данные заперта (tools/call без токена: отказ)"

probe "setup" "$BASE/swarm-setup" ''
[ "$CODE" = "200" ] || fail "установщик отвечает $CODE, а не 200 — подключиться никто не сможет"
head -c 20 "$WORK/body" | grep -q '^#!/bin/bash' || fail "установщик отдаёт не bash-скрипт"
echo "установщик отдаётся ($CODE)"

probe "version" "$BASE/swarm-setup/version" ''
[ "$CODE" = "200" ] || fail "версия моста отвечает $CODE, а не 200 — само-обновление моста не сработает"
SHA_ADV="$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{64\}\)".*/\1/p' "$WORK/body" | head -n 1)"
[ -n "$SHA_ADV" ] || fail "версия моста отдана без sha256"
probe "bridge" "$BASE/swarm-setup/bridge" ''
[ "$CODE" = "200" ] || fail "мост отвечает $CODE, а не 200"
if command -v sha256sum >/dev/null 2>&1; then SHA_REAL="$(sha256sum "$WORK/body" | cut -d' ' -f1)"; else SHA_REAL="$(shasum -a 256 "$WORK/body" | cut -d' ' -f1)"; fi
[ "$SHA_ADV" = "$SHA_REAL" ] || fail "отпечаток моста из /version не совпал с телом /bridge — само-обновление моста будет отвергать новую версию"
echo "мост и его отпечаток согласованы"

echo "ДОСТУПЕН СНАРУЖИ"
