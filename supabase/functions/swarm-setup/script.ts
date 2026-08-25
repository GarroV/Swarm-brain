// Bash-скрипт авто-подключения Claude Desktop (macOS). Отдаётся функцией swarm-setup.
// Вынесен отдельно, чтобы можно было отрендерить и проверить: bash -n на текст скрипта и
// script.test.ts — он прогоняет НАСТОЯЩУЮ функцию мёржа (импортирует MERGE_FUNCTION отсюда)
// и стережёт состав проверок.
//
// ВАЖНО: пишем только stdio-форму (command + args). Поле "url"/"type:http" Claude Desktop
// НЕ понимает и молча затирает весь mcpServers (anthropics/claude-code#37286).
//
// БЕЗ NODE (issue #47, 2026-08-25). Раньше в конфиг прописывался `node npx -y mcp-remote …`,
// а установщик ради этого тянул Node с nodejs.org и пакет с registry.npmjs.org — три сетевые
// точки отказа на корпоративной машине, и все три регулярно рубит VPN/прокси. При этом
// mcp-remote делал ровно одно: перекладывал построчный JSON из stdio в POST с заголовком
// Authorization. То же самое делают bash и curl, которые есть на любом маке из коробки.
// Мост ниже — эта замена; проверен на живом Claude Desktop (коннектор поднялся, tools/list
// отдал 20 инструментов, tools/call вернул реальные данные).
//
// Чего мост НЕ умеет — серверных событий (SSE): прогресса, tools/list_changed, sampling,
// стриминга. swarm-mcp объявляет только `capabilities: { tools: {} }` и по своей инициативе
// не шлёт ничего, поэтому сегодня это ничего не отнимает. Когда понадобится — issue #94
// (полноценный клиент Streamable HTTP одним бинарником).

const MCP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp";

// Текст моста. Кладётся в ~/.swarm-brain/bin/swarm-mcp-bridge.sh, в конфиг Claude попадает как
// `command: /bin/bash, args: [<путь>]`. Адрес и заголовок приходят из env — токен не светится
// в командной строке (ps его не покажет).
export const BRIDGE_SCRIPT = `#!/bin/bash
# Мост stdio ↔ HTTP для MCP-сервера Swarm Brain. Ставится установщиком (/setup), руками не правь.
# Claude Desktop говорит по stdio построчным JSON-RPC, swarm-mcp — по HTTP. Задача моста ровно
# в этом переводе. Замена mcp-remote: ни Node, ни npm не нужны.
set -u
URL="\${SWARM_MCP_URL:?}"
AUTH="\${SWARM_MCP_AUTH:?}"

while IFS= read -r line; do
  [ -n "$line" ] || continue
  # Уведомление (нет "id") ответа не требует — по JSON-RPC отвечать на него нельзя.
  case "$line" in
    *'"id"'*) want_reply=1 ;;
    *) want_reply=0 ;;
  esac
  resp="$(printf '%s' "$line" | curl -sS --max-time 120 -X POST "$URL" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: $AUTH" \\
      --data-binary @- 2>/dev/null)"
  if [ "$want_reply" = "1" ] && [ -n "$resp" ]; then
    printf '%s\\n' "$resp"
  fi
done
`;

// Мёрж конфига Claude Desktop штатным plutil (он есть на любой macOS — Node больше нет).
// Вынесен отдельной константой, чтобы script.test.ts гонял ИМЕННО ЭТОТ код, а не свою копию:
// копия разошлась бы с оригиналом, и тест бы врал.
// Коды возврата: 0 — ок, 2 — не смогли записать, 3 — конфиг пользователя битый (НЕ трогаем).
export const MERGE_FUNCTION = `merge_config() {
  cfg="$1"; srv="$2"
  # Нет файла или пустой — создаём с одним нашим ключом. Битый JSON НЕ перезаписываем:
  # у человека там могут быть другие серверы, потерять их хуже, чем не установиться.
  if [ ! -s "$cfg" ]; then
    echo '{"mcpServers":{}}' > "$cfg" || return 2
  elif ! plutil -convert json -o /dev/null "$cfg" >/dev/null 2>&1; then
    # ВНИМАНИЕ: проверка именно через -convert в /dev/null, а НЕ через plutil -lint.
    # lint ожидает property list и ругается «Unexpected character {» на ЛЮБОЙ валидный JSON —
    # с ним установщик объявлял повреждённым нормальный конфиг и отказывался ставиться.
    # Исходный файл -convert не трогает: вывод уходит в -o (проверено сравнением md5).
    return 3
  fi
  # Конфиг есть, но без mcpServers (чужие настройки Claude) — заводим ключ, остальное не трогаем.
  if ! plutil -extract mcpServers json -o - "$cfg" >/dev/null 2>&1; then
    plutil -insert mcpServers -json '{}' "$cfg" >/dev/null 2>&1 || return 2
  fi
  # Точечная замена своего блока: чужие серверы остаются как были, повторная установка не плодит дублей.
  plutil -replace 'mcpServers.swarm-brain' -json "$srv" "$cfg" >/dev/null 2>&1 || return 2
  # Читаем записанное обратно — иначе «успех» можно напечатать над несуществующей записью.
  plutil -extract 'mcpServers.swarm-brain.command' raw -o - "$cfg" >/dev/null 2>&1 || return 2
  return 0
}`;

export const SETUP_SCRIPT = `#!/bin/bash
# Swarm Brain → Claude Desktop (macOS). Не запускай вручную — возьми команду в боте: /setup

MCP_URL="${MCP_URL}"
BIN_DIR="$HOME/.swarm-brain/bin"
BRIDGE="$BIN_DIR/swarm-mcp-bridge.sh"
LEGACY_NODE_DIR="$HOME/.swarm-brain/node"
CONFIG_DIR="$HOME/Library/Application Support/Claude"
CONFIG="$CONFIG_DIR/claude_desktop_config.json"

say() { printf '%s\\n' "$*"; }
die() { printf '\\n❌ %s\\n' "$*" >&2; exit 1; }

say "🐝 Swarm Brain → Claude Desktop"
say ""

if [ -z "$SWARM_TOKEN" ]; then
  die "Нет токена. Возьми свежую команду в боте — она содержит токен (/setup)."
fi
# Чистим токен от пробелов и переносов: при копировании команды из мессенджера в конец легко
# прилетает \\n или пробел, и тогда он уезжает в HTTP-заголовок — сервер отвечает «Parse error»,
# а в Claude это выглядит как «Server disconnected». По формату (smcp_…) пробелов внутри нет,
# поэтому чистка безопасна. Починить тут дешевле, чем объяснять человеку, где он щёлкнул мышкой.
SWARM_TOKEN="$(printf '%s' "$SWARM_TOKEN" | tr -d '[:space:]')"
case "$SWARM_TOKEN" in
  smcp_*) ;;
  *) die "Токен выглядит неправильно. Возьми свежую команду в боте (/setup).";;
esac

# ── 0. Токен реально принимается сервером? ──
# Формы (smcp_*) недостаточно: при копировании команды прихватывается перенос строки или пробел,
# и тогда установка «успешно» дописывает в конфиг битый токен, а пользователь видит в Claude
# только «Server disconnected» без причины. Проверяем ДО записи конфига.
# tools/call (не initialize и не tools/list — те отвечают и без авторизации).
say "→ Проверяю токен на сервере…"
PROBE="$(curl -fsS -X POST "$MCP_URL" \\
  -H "Authorization: Bearer $SWARM_TOKEN" -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_tasks","arguments":{}}}' 2>/dev/null || true)"
case "$PROBE" in
  *'"result"'*) say "✓ Токен принят сервером" ;;
  *"Invalid token"*) die "Сервер не принял токен (устарел или скопирован не полностью). Возьми свежую команду в боте: /setup" ;;
  *"Unauthorized"*) die "Сервер не увидел токен. Скопируй команду из бота ЦЕЛИКОМ, одной строкой (/setup)." ;;
  "") die "Нет связи с сервером Swarm Brain ($MCP_URL). Проверь интернет/VPN и запусти снова." ;;
  *) die "Неожиданный ответ сервера. Пришли это админу: $PROBE" ;;
esac

# ── 1. Мост stdio ↔ HTTP (bash + curl, без Node) ──
say "→ Ставлю мост к серверу…"
mkdir -p "$BIN_DIR" || die "Не удалось создать $BIN_DIR"
cat > "$BRIDGE" <<'SWARM_BRIDGE_EOF'
${BRIDGE_SCRIPT}SWARM_BRIDGE_EOF
chmod +x "$BRIDGE" || die "Не удалось сделать мост исполняемым ($BRIDGE)"
bash -n "$BRIDGE" || die "Мост записался повреждённым — запусти команду снова."
say "✓ Мост готов: $BRIDGE"

# ── 2. Папка конфига + бэкап ──
mkdir -p "$CONFIG_DIR" || die "Не удалось создать $CONFIG_DIR"
if [ -f "$CONFIG" ]; then
  BAK="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG" "$BAK" && say "✓ Бэкап старого конфига: $BAK"
fi

# ── 3. Мёрж swarm-brain (plutil; чужие серверы не трогаем; только stdio-форма) ──
${MERGE_FUNCTION}

SRV_JSON="$(printf '{"command":"/bin/bash","args":["%s"],"env":{"SWARM_MCP_URL":"%s","SWARM_MCP_AUTH":"Bearer %s"}}' "$BRIDGE" "$MCP_URL" "$SWARM_TOKEN")"
merge_config "$CONFIG" "$SRV_JSON"
MERGE_RC=$?
if [ "$MERGE_RC" -eq 3 ]; then
  die "Существующий config.json повреждён (невалидный JSON). Бэкап цел. Открой '$CONFIG', почини/удали и запусти снова."
elif [ "$MERGE_RC" -ne 0 ]; then
  die "Не удалось записать конфиг (код $MERGE_RC)."
fi
say "✓ Конфиг обновлён: swarm-brain добавлен (остальное не тронуто)"

# ── 4. Уборка прежней схемы (Node ставился только ради mcp-remote — больше не нужен) ──
if [ -d "$LEGACY_NODE_DIR" ]; then
  rm -rf "$LEGACY_NODE_DIR" 2>/dev/null && say "✓ Убрал Node от прежней версии установки (~50 МБ больше не нужны)"
fi

# ── 5. Перезапуск Claude Desktop ──
if [ -d "/Applications/Claude.app" ]; then
  if pgrep -x "Claude" >/dev/null 2>&1; then
    osascript -e 'quit app "Claude"' >/dev/null 2>&1 || true
    sleep 2
  fi
  open -a "Claude" >/dev/null 2>&1 || true
  say "✓ Claude Desktop перезапущен"
else
  say "ℹ️  Claude Desktop не найден в /Applications. Установи его и открой — коннектор уже прописан."
fi

say ""
say "✅ Готово! Swarm Brain подключён к Claude Desktop."
say "   Открой Claude → создай проект → увидишь инструменты Swarm Brain."
say "   Текст инструкций для проекта — команда /claude в боте."
`;
