#!/usr/bin/env bash
# Смоук edge-функций: одни и те же проверки против ЛЮБОГО контура (local/staging/prod) —
# параметр только base URL функций. Используется в пред-проде: гоняем на staging до прода.
#
#   ./scripts/smoke.sh <FUNCTIONS_BASE_URL>
#   ./scripts/smoke.sh http://100.64.116.67:8020/functions/v1      # staging (MUSPELHEIM, Tailscale)
#   ./scripts/smoke.sh https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1   # prod
#
# Проверки — «дешёвые» и безопасные: без секретов и без мутаций.
set -uo pipefail

BASE="${1:?Укажи base URL функций (например http://100.64.116.67:8020/functions/v1)}"
FAIL=0

# check <описание> <ожидаемый-http-код> <curl-аргументы...>
check() {
  local desc="$1" want="$2"; shift 2
  local code
  code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null)
  if [[ "$code" == "$want" ]]; then
    printf '  ✅ %-52s → %s\n' "$desc" "$code"
  else
    printf '  ❌ %-52s → %s (ждали %s)\n' "$desc" "$code" "$want"
    FAIL=1
  fi
}

# check_body <описание> <подстрока-в-теле> <curl-аргументы...>
# Для JSON-RPC (MCP): ошибки идут с HTTP 200 + {"error":{"code":…}} в теле — проверяем ТЕЛО, не код.
check_body() {
  local desc="$1" want="$2"; shift 2
  local body
  body=$(curl -sS -m 15 "$@" 2>/dev/null)
  if [[ "$body" == *"$want"* ]]; then
    printf '  ✅ %-52s → нашёл «%s»\n' "$desc" "$want"
  else
    printf '  ❌ %-52s → нет «%s» в: %.80s\n' "$desc" "$want" "$body"
    FAIL=1
  fi
}

echo "=== SMOKE: $BASE ==="

# 1. Публичная функция без БД/секретов — базовая живость пайплайна функций.
check "swarm-recorder-version (public)" 200 "$BASE/swarm-recorder-version"

# 2. Функция → БД → agent-auth: фейковый токен обязан дать 401 (доказывает БД+auth, без мутаций).
check "meeting-current фейк-токен → 401" 401 \
  -H "Authorization: Bearer smoke_fake_token" "$BASE/meeting-current"

# 3. MCP strict: tools/call без токена обязан дать JSON-RPC-ошибку -32001 (Unauthorized) — HTTP 200.
check_body "swarm-mcp без токена → JSON-RPC -32001" "-32001" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_knowledge","arguments":{"query":"smoke"}}}' \
  "$BASE/swarm-mcp"

if [[ "$FAIL" == 0 ]]; then echo "=== SMOKE OK ==="; else echo "=== SMOKE FAILED ==="; fi
exit "$FAIL"
