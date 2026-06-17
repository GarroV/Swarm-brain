// Bash-скрипт авто-подключения Claude Desktop (macOS). Отдаётся функцией swarm-setup.
// Вынесен отдельно, чтобы можно было отрендерить и проверить (bash -n, тесты мёржа).
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
case "$SWARM_TOKEN" in
  smcp_*) ;;
  *) die "Токен выглядит неправильно. Возьми свежую команду в боте (/setup).";;
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
  VER="$(curl -fsSL https://nodejs.org/dist/index.json | tr '{}' '\\n' | awk -F'"' '/"lts":"[A-Za-z]/{for(i=1;i<=NF;i++) if($i=="version"){print $(i+2); exit}}')"
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
