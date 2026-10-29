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
import { FUNCTIONS_BASE_URL } from "./public-url.ts";

const MCP_URL = `${FUNCTIONS_BASE_URL}/swarm-mcp`;

// Версия моста. Мосты у людей обновляются сами при старте (update_self ниже): спрашивают у
// swarm-setup/version номер и отпечаток, и если номер больше своего — тянут свежий текст.
// ПРАВИЛО: тронул BRIDGE_SCRIPT — подними версию, иначе у людей мост не обновится (script.test.ts
// держит пару «версия ↔ отпечаток» и краснеет, если текст сменился, а версия нет).
export const BRIDGE_VERSION = 2;

/** SHA-256 текста в hex — тот же отпечаток, что считает `shasum -a 256` у человека. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Текст моста. Кладётся в ~/.swarm-brain/bin/swarm-mcp-bridge.sh, в конфиг Claude попадает как
// `command: /bin/bash, args: [<путь>]`. Адрес и заголовок приходят из env — токен не светится
// в командной строке (ps его не покажет).
export const BRIDGE_SCRIPT = `#!/bin/bash
# Мост stdio ↔ HTTP для MCP-сервера Swarm Brain. Ставится установщиком (/setup), руками не правь.
# Claude Desktop говорит по stdio построчным JSON-RPC, swarm-mcp — по HTTP. Задача моста ровно
# в этом переводе. Замена mcp-remote: ни Node, ни npm не нужны.
# Мост не молчит при сбое (issue #935): на любой запрос с "id" клиент ждёт ответ с тем же id,
# иначе висит до своего таймаута (30 минут). Поэтому сбой curl, не-2xx и ответ не в формате
# JSON-RPC превращаются в JSON-RPC error с тем же id. Уведомления (без "id") остаются молчаливыми.
set -u
BRIDGE_VERSION=${BRIDGE_VERSION}
URL="\${SWARM_MCP_URL:?}"
AUTH="\${SWARM_MCP_AUTH:?}"
MAX_TIME="\${SWARM_MCP_MAX_TIME:-120}"
export LC_ALL=C
BODY="$(mktemp)"
ERRF="$(mktemp)"
trap 'rm -f "$BODY" "$ERRF"' EXIT

# Экранирование для JSON-строки: управляющие символы выбрасываем, \\ и " экранируем.
json_escape() {
  printf '%s' "$1" | tr -d '\\000-\\037' | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'
}

# id запроса: первое вхождение "id" — число или строка в кавычках (пробелы вокруг : допустимы).
extract_id() {
  case "$1" in *'"id"'*) ;; *) return 0 ;; esac
  rest="\${1#*\\"id\\"}"
  # Два выражения вместо альтернации: BSD sed (macOS) не знает \\|.
  printf '%s' "$rest" | sed -n \\
    -e 's/^[[:space:]]*:[[:space:]]*\\("[^"]*"\\).*/\\1/p' \\
    -e 's/^[[:space:]]*:[[:space:]]*\\(-\\{0,1\\}[0-9][0-9.eE+-]*\\).*/\\1/p' | head -n 1
}

# Поле "message" из тела ответа сервера (если тело — JSON), до 200 символов.
server_message() {
  tr -d '\\000-\\037' < "$BODY" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\\([^"]*\\).*/\\1/p' | head -n 1 | cut -c1-200
}

# SHA-256 файла: shasum есть на любом маке, sha256sum — запасной путь для Linux.
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}

# Самообновление при старте (#1082). Спрашиваем у сервера версию и отпечаток; если версия больше
# своей — качаем новый текст во временный файл РЯДОМ, сверяем отпечаток, проверяем bash -n и
# подменяем через mv (новый inode). Писать поверх запущенного файла нельзя: bash читает скрипт по
# ходу выполнения, и все уже запущенные мосты зависают на новом тексте со старого смещения (#951).
# Любой сбой — тихо остаёмся на текущей версии: связь с сервером важнее обновления.
# Отпечаток защищает от битой загрузки, а не от подмены самого сервера (он отдаёт и текст, и отпечаток).
update_self() {
  base="\${URL%/swarm-mcp}"
  [ "$base" != "$URL" ] || return 0
  me="$0"
  [ -f "$me" ] && [ -w "$me" ] || return 0
  info="$(curl -sS --max-time 10 "$base/swarm-setup/version" 2>/dev/null)" || return 0
  remote_ver="$(printf '%s' "$info" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)"
  remote_sha="$(printf '%s' "$info" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\\([0-9a-f]\\{64\\}\\)".*/\\1/p' | head -n 1)"
  [ -n "$remote_ver" ] && [ -n "$remote_sha" ] || return 0
  [ "$remote_ver" -gt "$BRIDGE_VERSION" ] || return 0
  tmp="$(mktemp "$(dirname "$me")/.bridge-update.XXXXXX")" || return 0
  if curl -fsS --max-time 20 "$base/swarm-setup/bridge" -o "$tmp" 2>/dev/null \\
     && [ "$(sha256_of "$tmp")" = "$remote_sha" ] && bash -n "$tmp" 2>/dev/null; then
    chmod 755 "$tmp" && mv -f "$tmp" "$me" && return 0
  fi
  rm -f "$tmp"
  return 0
}
# В фоне: старт моста не ждёт сети, а новая версия вступит в силу при следующем запуске.
update_self </dev/null >/dev/null 2>&1 &

emit_error() {
  id="$1"; rc="$2"; code="$3"
  if [ "$rc" != "0" ]; then
    detail="no response (curl exit $rc)"
    detail_ru="нет ответа (curl, код $rc)"
  else
    case "$code" in
      2??)
        detail="HTTP $code, not a JSON-RPC response"
        detail_ru="HTTP $code, ответ не в формате JSON-RPC"
        ;;
      *)
        detail="HTTP $code"
        detail_ru="HTTP $code"
        ;;
    esac
  fi
  srv="$(server_message)"
  [ -n "$srv" ] && srv=" [$srv]"
  msg="Swarm MCP: $detail$srv. / Swarm MCP: $detail_ru."
  # 401 — токен не принят (отозван, устарел, скопирован не целиком): человек должен увидеть причину
  # прямо в Claude, а не «Server disconnected».
  if [ "$rc" = "0" ] && [ "$code" = "401" ]; then
    msg="$msg The token was rejected — issue a new one in Settings (web) and re-run the install command / Токен не принят — выпусти новый в Настройках (веб) и запусти команду установки заново."
  fi
  # 402/404 или хост недоступен (curl 6 — DNS, 7 — соединение) = старый адрес после переезда.
  case "$rc:$code" in
    6:*|7:*|0:402|0:404)
      msg="$msg Swarm moved to a new server — restart Claude (and re-run the installer if it persists) / Swarm переехал на новый сервер — перезапусти Claude (если не помогло — запусти установщик заново)."
      ;;
  esac
  printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"%s"}}\\n' "$id" "$(json_escape "$msg")"
}

while IFS= read -r line; do
  [ -n "$line" ] || continue
  # Уведомление (нет "id") ответа не требует — по JSON-RPC отвечать на него нельзя.
  id="$(extract_id "$line")"
  : > "$BODY"
  code="$(printf '%s' "$line" | curl -sS --max-time "$MAX_TIME" -X POST "$URL" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: $AUTH" \\
      -o "$BODY" -w '%{http_code}' \\
      --data-binary @- 2>"$ERRF")"
  rc=$?
  [ -n "$id" ] || continue
  case "$code" in 2??) is2xx=1 ;; *) is2xx=0 ;; esac
  if [ "$rc" = "0" ] && [ "$is2xx" = "1" ] && grep -q '"jsonrpc"' "$BODY"; then
    printf '%s\\n' "$(cat "$BODY")"
  else
    emit_error "$id" "$rc" "$code"
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
# Swarm Brain → Claude Desktop и Claude Code (macOS). Не запускай вручную — возьми команду в вебе: Настройки → Claude Desktop

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
# Пишем во временный файл рядом и подменяем через mv (#951): запись через \`cat >\` в тот же файл
# ломала уже запущенные мосты — bash читает скрипт по ходу, и они зависали на новом тексте.
BRIDGE_TMP="$(mktemp "$BIN_DIR/.bridge-install.XXXXXX")" || die "Не удалось создать временный файл в $BIN_DIR"
trap 'rm -f "$BRIDGE_TMP"' EXIT
cat > "$BRIDGE_TMP" <<'SWARM_BRIDGE_EOF'
${BRIDGE_SCRIPT}SWARM_BRIDGE_EOF
chmod 755 "$BRIDGE_TMP" || die "Не удалось сделать мост исполняемым ($BRIDGE_TMP)"
bash -n "$BRIDGE_TMP" || die "Мост записался повреждённым — запусти команду снова."
mv -f "$BRIDGE_TMP" "$BRIDGE" || die "Не удалось положить мост на место ($BRIDGE)"
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

# ── 3б. Claude Code (если установлен): прямой HTTP, мост ему не нужен ──
# Прежняя запись снимается перед добавлением — иначе add отказывает на уже занятом имени, и
# повторный запуск не обновлял бы токен. Сбой здесь не фатален: Desktop уже настроен выше.
# Токен попадает в аргументы claude на время одного вызова — штатного способа передать заголовок
# иначе у CLI нет.
CLAUDE_BIN="$(PATH="$PATH:$HOME/.local/bin:$HOME/.claude/local" command -v claude 2>/dev/null || true)"
if [ -n "$CLAUDE_BIN" ]; then
  "$CLAUDE_BIN" mcp remove swarm-brain --scope user >/dev/null 2>&1 || true
  if "$CLAUDE_BIN" mcp add --transport http swarm-brain "$MCP_URL" \\
      --header "Authorization: Bearer $SWARM_TOKEN" --scope user >/dev/null 2>&1; then
    say "✓ Claude Code: сервер swarm-brain прописан"
  else
    say "⚠️  Claude Code найден, но прописать сервер не удалось — Claude Desktop настроен, об остальном скажи в боте."
  fi
fi

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
