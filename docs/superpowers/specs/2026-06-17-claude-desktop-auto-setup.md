# Авто-сетап Claude Desktop через бота (macOS)

**Дата:** 2026-06-17
**Статус:** дизайн утверждён (юзер: «делай нормально, добавь в справку, сделай красиво»)

## Цель

Член команды подключает Claude Desktop к Swarm Brain **без редактирования JSON и без копипасты токена**. Целевой пользователь — нетехнический («чтобы девочки не парились»). Одна команда → всё ставится само → Claude перезапускается → коннектор `swarm-brain` готов.

## Решения (зафиксированы)

| Вопрос | Решение | Почему |
|---|---|---|
| Платформа | только **macOS** | команда на маках |
| Доставка скрипта | **curl-однострочник в Терминал** (не `.command`) | у скачанного `.command` нет флага +x → двойной клик ненадёжен + Gatekeeper. curl сидестепит и то и другое |
| Хостинг скрипта | новая edge-функция **`swarm-setup`** (GET → bash) | один деплой-стек (Supabase), без миниаппы; токена в скрипте нет |
| Токен | reuse `/mytoken` (вынести в `mintMcpToken`) | DRY, 90 дней, отзыв `/revoketoken` |
| Node | ставится скриптом **в `~/.swarm-brain/node` из официального tarball, без sudo** | нетех-юзер ничего не ставит руками; без пароля и без модификации системы (corp-friendly) |
| Путь в конфиге | **абсолютный путь к node/npx**, не `npx` | Claude Desktop (GUI) не наследует PATH шелла → `"command":"npx"` падает |
| header | `"--header","Authorization:${AUTH_HEADER}"` + `env.AUTH_HEADER="Bearer <token>"` | подтверждённый workaround mcp-remote (бага с пробелом) |

### ⚠️ Критическое правило безопасности (проверено в интернете 2026-06-17)
Claude Desktop **НЕ** поддерживает удалённый MCP в `config.json` нативно: парсер принимает только stdio (`command`). Поле `url`/`type:"http"` в свежих сборках **молча уничтожает весь блок `mcpServers`** (баг [anthropics/claude-code#37286](https://github.com/anthropics/claude-code/issues/37286), closed «not planned»). **Merge ОБЯЗАН писать только `command`/mcp-remote shape — никогда `url`.** Поэтому stdio-мостик (Node/mcp-remote) обязателен; «курл без ноды» для Claude Desktop невозможен.

## Архитектура

```
Юзер → /setup в боте
  → бот минтит smcp_-токен (mintMcpToken) + вшивает в строку
  → бот шлёт инструкцию: открой Терминал, вставь:
        curl -fsSL https://<proj>.supabase.co/functions/v1/swarm-setup | SWARM_TOKEN='smcp_…' bash
Юзер вставляет в Терминал, Enter
  → swarm-setup.sh: node (есть? иначе ставит в ~/.swarm-brain/node) → бэкап → мёрж в config → рестарт Claude
  → "✅ Готово"
Claude Desktop перезапуск → swarm-brain подключён, опознан по токену
```

Токен **только** в строке, которую вставляет юзер (env). Хостимый скрипт — generic, без секретов.

## Компоненты

### 1. `supabase/functions/swarm-bot/lib/mcp-setup.ts` (новый)
- `mintMcpToken(telegramId: number): Promise<{ token: string; expiresAt: Date } | null>` — выносит логику минта из `/mytoken` (`smcp_`+UUID, sha256 → `allowed_users.claude_mcp_token_hash`, TTL 90 дней). `null` при ошибке.
- `buildSetupOneLiner(token: string): string` — строит curl-строку с вшитым токеном.

### 2. `supabase/functions/swarm-setup/index.ts` (новый)
GET → `text/plain` bash-скрипт (macOS). Деплой `--no-verify-jwt`, публичный (без секретов). Логика скрипта:
1. `set` без `-e` (контролируем ошибки сами; печатаем понятные сообщения).
2. Проверка `$SWARM_TOKEN` непустой, иначе выход с сообщением.
3. Node: `command -v node`? → берём системный. Иначе: `uname -m` → arch (`arm64`/`x86_64` → `darwin-arm64`/`darwin-x64`), latest LTS из `https://nodejs.org/dist/index.json` (parse awk), скачать tarball → распаковать в `~/.swarm-brain/node`. **Без sudo.**
4. `NODE_BIN` = абсолютный путь; `NPX_PATH="$(dirname NODE_BIN)/npx"`.
5. `CONFIG_DIR="$HOME/Library/Application Support/Claude"`, `mkdir -p`.
6. Если конфиг есть → бэкап `claude_desktop_config.json.bak-<ts>`.
7. Мёрж через `node -e`: читает существующий JSON (битый → exit 3, бэкап цел, не затираем), ставит только `mcpServers["swarm-brain"]` = `{command:NODE_BIN, args:[NPX_PATH,"-y","mcp-remote",URL,"--header","Authorization:${AUTH_HEADER}"], env:{AUTH_HEADER:"Bearer "+token}}`, остальное сохраняет, пишет pretty.
8. Рестарт: если `/Applications/Claude.app` есть → `osascript -e 'quit app "Claude"'` → `open -a Claude`.
9. Печать успеха. Токен в stdout **не печатать**.

### 3. `swarm-bot/index.ts` (правки)
- `/mytoken` → через `mintMcpToken`.
- `/setup` (новая) → mint → `buildSetupOneLiner` → дружелюбное сообщение (открой Терминал ⌘Space → «Терминал» → вставь ⌘V → Enter; срок 90 дней; `/revoketoken`).
- `/start`, `/connect_claude`, `handlers/help.ts`, `setMyCommands` (×2) → вести на `/setup` как основной путь.

## Обработка ошибок
- mint упал → «попробуй ещё / к админу».
- нет интернета/tarball → понятное сообщение + ссылка nodejs.org.
- битый существующий JSON → стоп после бэкапа.
- Claude не установлен → варн, конфиг пишем (безвредно), рестарт пропускаем.

## Безопасность
- Токен попадает в чат Telegram (как `/mytoken`) и в историю Терминала (строка curl). Митигация: ведущий пробел в строке (zsh `HIST_IGNORE_SPACE`), 90 дней, отзыв `/revoketoken`. Отметить в сообщении.
- Хостимый скрипт — без секретов; HTTPS; читаемый (можно глянуть до запуска).
- Node ставится в домашнюю папку, без sudo → нет модификации системы.
- Скрипт не печатает токен.

## Out of scope (YAGNI)
Windows/Linux. `.command`/двойной клик. OAuth. Системная установка Node через sudo. Хостинг на миниаппе.

## Тест-план
- нет конфига → валидный конфиг, коннектор поднимается;
- конфиг с чужими серверами → сохранены (мёрж);
- битый JSON → стоп + бэкап цел;
- Node нет → ставится в ~/.swarm-brain/node, коннектор работает;
- повтор → токен переминчен, старый мёртв;
- абсолютный путь к node → Claude Desktop не падает на «npx not found».
