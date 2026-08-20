// Bash-скрипт авто-подключения Claude Desktop (macOS). Отдаётся функцией swarm-setup.
// Вынесен отдельно, чтобы можно было отрендерить и проверить: bash -n на текст скрипта и
// script.test.ts — он прогоняет НАСТОЯЩИЙ блок мёржа (вырезая его из отрендеренного текста)
// и стережёт состав проверок. До 2026-08-20 эта строка обещала «тесты мёржа», которых не было.
//
// ВАЖНО: пишем только stdio-форму (command + mcp-remote). Поле "url"/"type:http"
// Claude Desktop НЕ понимает и молча затирает весь mcpServers (anthropics/claude-code#37286).

const MCP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp";

// Литерал ${AUTH_HEADER} должен попасть в конфиг как есть — mcp-remote раскроет его
// в рантайме из env. В этом template-литерале экранируем как \${AUTH_HEADER}.
export const SETUP_SCRIPT = `#!/bin/bash
# Swarm Brain → Claude Desktop (macOS). Не запускай вручную — возьми команду в боте: /setup

MCP_URL="${MCP_URL}"
INSTALL_DIR="$HOME/.swarm-brain/node"
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

# ── 1. Node (берём системный; если нет — ставим в ~/.swarm-brain без sudo) ──
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  say "✓ Node найден в системе"
elif [ -x "$INSTALL_DIR/bin/node" ]; then
  NODE_BIN="$INSTALL_DIR/bin/node"
  say "✓ Node (Swarm Brain) уже установлен"
else
  say "⏳ Ставлю Node (один раз, без пароля, в твою папку)…"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  NARCH="darwin-arm64";;
    x86_64) NARCH="darwin-x64";;
    *) die "Неизвестная архитектура: $ARCH";;
  esac
  # 2>/dev/null у curl: awk выходит по exit → SIGPIPE → curl печатает «(56) Failure writing
  # output to destination». Версия при этом определяется верно, но пользователь видит «ошибку»
  # посреди установки и решает, что всё сломалось.
  VER="$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null | tr '{}' '\\n' | awk -F'"' '/"lts":"[A-Za-z]/{for(i=1;i<=NF;i++) if($i=="version"){print $(i+2); exit}}')"
  if [ -z "$VER" ]; then die "Не удалось определить версию Node (нет интернета или блокирует прокси)."; fi
  TARBALL="node-$VER-$NARCH.tar.gz"
  TMP="$(mktemp -d)"
  if ! curl -fsSL -o "$TMP/$TARBALL" "https://nodejs.org/dist/$VER/$TARBALL"; then
    rm -rf "$TMP"; die "Не скачался Node (нет интернета или блокирует прокси)."
  fi
  mkdir -p "$INSTALL_DIR"
  if ! tar -xzf "$TMP/$TARBALL" -C "$INSTALL_DIR" --strip-components=1; then
    rm -rf "$TMP"; die "Не распаковался Node."
  fi
  rm -rf "$TMP"
  NODE_BIN="$INSTALL_DIR/bin/node"
  if [ ! -x "$NODE_BIN" ]; then die "Node поставился, но не запускается."; fi
  say "✓ Node установлен в $INSTALL_DIR"
fi

NPX_PATH="$(dirname "$NODE_BIN")/npx"
if [ ! -e "$NPX_PATH" ]; then die "Рядом с node нет npx ($NPX_PATH)."; fi

# ── 1.5. Мост к серверу: тянем mcp-remote ЗДЕСЬ, а не внутри Claude ──
# Claude Desktop понимает в конфиге только stdio-форму, поэтому связь с нашим HTTP-эндпоинтом
# держит прокси mcp-remote, которого качает npx. До этой правки первое скачивание происходило
# УЖЕ ВНУТРИ Claude: если npm недоступен (корпоративная сеть/VPN/прокси), пользователь видел
# только «Server disconnected» без причины — а установщик за минуту до этого рапортовал
# «✅ Готово». Теперь непроходимая сеть выясняется здесь, с внятным текстом; заодно кэш прогрет
# и первый запуск в Claude не ждёт сети.
say "→ Готовлю мост к серверу (mcp-remote)…"
# Проверяем с честным кодом возврата. Через npx с --version не проверить:
# mcp-remote требует URL и на любой другой вызов падает «Invalid URL», хотя пакет скачивается.
# Через фактический запуск прокси — тоже: это stdio-сервер, в фоне его stdin закрывается и он
# выходит, давая ложную неудачу. Поэтому npm install во временную папку: он либо достаёт
# пакет из registry (и наполняет общий кэш ~/.npm/_cacache, откуда npx возьмёт его в Claude
# без сети), либо честно падает — а это и есть тот случай, который раньше всплывал в Claude
# как «Server disconnected» без объяснений.
NPM_PATH="$(dirname "$NODE_BIN")/npm"
WARM_TMP="$(mktemp -d)"
if ! "$NODE_BIN" "$NPM_PATH" install --no-save --no-audit --no-fund --prefix "$WARM_TMP" mcp-remote >"$WARM_TMP/npm.log" 2>&1; then
  say ""
  say "Лог попытки (последние строки):"
  tail -5 "$WARM_TMP/npm.log" 2>/dev/null | sed 's/^/   /'
  rm -rf "$WARM_TMP"
  die "Не удалось получить mcp-remote из npm — почти всегда это корпоративная сеть/VPN/прокси. Проверь доступ к registry.npmjs.org и запусти снова."
fi
rm -rf "$WARM_TMP"
say "✓ Мост готов"

# ── 2. Папка конфига + бэкап ──
if ! mkdir -p "$CONFIG_DIR"; then die "Не удалось создать папку конфигов Claude."; fi
if [ -f "$CONFIG" ]; then
  BAK="$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG" "$BAK" && say "✓ Бэкап старого конфига: $BAK"
fi

# ── 3. Мёрж swarm-brain (через node; чужие серверы не трогаем; только command-форма) ──
CONFIG_PATH="$CONFIG" NODE_BIN="$NODE_BIN" NPX_PATH="$NPX_PATH" MCP_URL="$MCP_URL" SWARM_TOKEN="$SWARM_TOKEN" "$NODE_BIN" -e '
const fs = require("fs");
const p = process.env.CONFIG_PATH;
let cfg = {};
if (fs.existsSync(p)) {
  const raw = fs.readFileSync(p, "utf8").trim();
  if (raw) { try { cfg = JSON.parse(raw); } catch (e) { console.error("BAD_JSON"); process.exit(3); } }
}
if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) cfg = {};
if (typeof cfg.mcpServers !== "object" || cfg.mcpServers === null) cfg.mcpServers = {};
cfg.mcpServers["swarm-brain"] = {
  command: process.env.NODE_BIN,
  args: [process.env.NPX_PATH, "-y", "mcp-remote", process.env.MCP_URL, "--transport", "http-only", "--header", "Authorization:\${AUTH_HEADER}"],
  env: { AUTH_HEADER: "Bearer " + process.env.SWARM_TOKEN }
};
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\\n");
'
MERGE_RC=$?
if [ "$MERGE_RC" -eq 3 ]; then
  die "Существующий config.json повреждён (невалидный JSON). Бэкап цел. Открой '$CONFIG', почини/удали и запусти снова."
elif [ "$MERGE_RC" -ne 0 ]; then
  die "Не удалось записать конфиг (код $MERGE_RC)."
fi
say "✓ Конфиг обновлён: swarm-brain добавлен (остальное не тронуто)"

# ── 4. Перезапуск Claude Desktop ──
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
