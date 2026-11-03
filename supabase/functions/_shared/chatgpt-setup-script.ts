import { BRIDGE_SCRIPT, sha256Hex } from "./mcp-setup-script.ts";
import { FUNCTIONS_BASE_URL } from "./public-url.ts";

export const CHATGPT_SETUP_SCRIPT = String.raw`#!/bin/bash
set -eo pipefail
umask 077
say() { printf '%s\n' "$*"; }
die() { say "$*" >&2; exit 1; }
TOKEN="$(printenv SWARM_TOKEN || true)"
case "$TOKEN" in smcp_*) ;; *) die 'Missing token. Get the install command in Swarm → Settings → ChatGPT. / Нет токена: возьмите команду в настройках Swarm → ChatGPT.' ;; esac
case "$TOKEN" in *[!a-zA-Z0-9_-]*) die 'Invalid token format / Неверный формат токена' ;; esac
MCP_URL="${FUNCTIONS_BASE_URL}/swarm-mcp"
CLI=''
for app in /Applications/ChatGPT.app "$HOME/Applications/ChatGPT.app"; do
  candidate="$app/Contents/Resources/codex-cli/bin/codex"
  if [ -x "$candidate" ]; then CLI="$candidate"; break; fi
done
if [ -z "$CLI" ]; then CLI="$(command -v codex || true)"; fi
[ -n "$CLI" ] || die 'Install/update the ChatGPT desktop app first. / Сначала установите или обновите настольный ChatGPT.'
"$CLI" mcp list --json >/dev/null 2>&1 || die 'Could not read MCP settings; no files were changed. / Не удалось прочитать настройки MCP; файлы не изменены.'
# Check the token without putting it in curl's command-line arguments or printing user data.
PROBE="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl --config - -fsS --max-time 20 -X POST "$MCP_URL" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}')" || die 'Swarm is unreachable / Нет связи со Swarm'
case "$PROBE" in *'"result"'*) ;; *) die 'Swarm rejected the token. Get a new command. / Swarm не принял токен. Получите новую команду.' ;; esac
ROOT="$HOME/.swarm-brain/chatgpt"
mkdir -p "$ROOT"
chmod 700 "$ROOT"
# Independent of Claude: own bridge copy, launcher and credential file.
TMP="$(mktemp "$ROOT/.bridge.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'SWARM_BRIDGE'
${BRIDGE_SCRIPT}SWARM_BRIDGE
bash -n "$TMP"
chmod 700 "$TMP"
mv -f "$TMP" "$ROOT/swarm-mcp-bridge.sh"
printf '%s' "$TOKEN" > "$ROOT/token"
chmod 600 "$ROOT/token"
cat > "$ROOT/launch.sh" <<'SWARM_LAUNCH'
#!/bin/bash
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export SWARM_MCP_URL="${FUNCTIONS_BASE_URL}/swarm-mcp"
export SWARM_MCP_AUTH="Bearer $(cat "$ROOT/token")"
exec /bin/bash "$ROOT/swarm-mcp-bridge.sh"
SWARM_LAUNCH
chmod 700 "$ROOT/launch.sh"
CONFIG_DIR="$CODEX_HOME"
if [ -z "$CONFIG_DIR" ]; then CONFIG_DIR="$HOME/.codex"; fi
if [ -f "$CONFIG_DIR/config.toml" ]; then
  BACKUP="$(mktemp "$CONFIG_DIR/config.toml.swarm-backup.XXXXXX")"
  cat "$CONFIG_DIR/config.toml" > "$BACKUP"
fi
# Native TOML editor: preserves other servers and settings; no token in argv or TOML.
"$CLI" mcp add swarm-brain-chatgpt -- /bin/bash "$ROOT/launch.sh" >/dev/null
"$CLI" mcp get swarm-brain-chatgpt >/dev/null
say 'SwarmBrain bridge installed for ChatGPT. / Мост SwarmBrain установлен для ChatGPT.'
say 'Quit and reopen ChatGPT. Check /mcp, then ask SwarmBrain whoami. / Полностью закройте и откройте ChatGPT. Проверьте /mcp и запросите свою личность в SwarmBrain.'
`;

export async function buildChatGptSetupOneLiner(token: string): Promise<string> {
  const hash = await sha256Hex(CHATGPT_SETUP_SCRIPT);
  return `f=$(mktemp) && (curl -fsSL ${FUNCTIONS_BASE_URL}/swarm-setup/chatgpt -o "$f" && ` +
    `echo "${hash}  $f" | shasum -a 256 -c - && SWARM_TOKEN='${token}' bash "$f"; swarm_rc=$?; rm -f "$f"; exit "$swarm_rc")`;
}
