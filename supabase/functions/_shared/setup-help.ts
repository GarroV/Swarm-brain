import type { NoticeLang } from "./notices.ts";

// Same RU/EN catalog convention as bot-notice-texts.ts. Setup is managed in the web UI.
const SETUP_HELP = {
  desktop: {
    ru: "Открой Swarm → Настройки → Claude Desktop и скопируй команду установки для Терминала на Mac.",
    en: "Open Swarm → Settings → Claude Desktop and copy the installation command for Terminal on your Mac.",
  },
  recorder: {
    ru: "Открой Swarm → Настройки → bumblebee и скопируй команду установки для Терминала на Mac.",
    en: "Open Swarm → Settings → bumblebee and copy the installation command for Terminal on your Mac.",
  },
  keys: {
    ru:
      "Ключи Claude Desktop и bumblebee выдаются только в вебе после входа с Touch ID: Swarm → Настройки → Claude Desktop или bumblebee. Уже выданные ключи продолжают работать.",
    en:
      "Keys for Claude Desktop and bumblebee are issued only on the web after signing in with Touch ID: Swarm → Settings → Claude Desktop or bumblebee. Existing keys keep working.",
  },
  desktopRevoked: {
    ru: "Токен отозван. Доступ из Claude закрыт. Новый ключ и команда установки — Swarm → Настройки → Claude Desktop.",
    en:
      "Token revoked. Claude access is disabled. Get a new key and installation command in Swarm → Settings → Claude Desktop.",
  },
  recorderRevoked: {
    ru: "Токен bumblebee отозван. Новый ключ и команда установки — Swarm → Настройки → bumblebee.",
    en: "bumblebee token revoked. Get a new key and installation command in Swarm → Settings → bumblebee.",
  },
  recorderExpiry: {
    ru:
      "Токен bumblebee истекает через {days} дн. Чтобы запись не прервалась, открой Swarm → Настройки → bumblebee, выпусти новый ключ и переустанови приложение предложенной командой.",
    en:
      "Your bumblebee token expires in {days} days. To keep recording, open Swarm → Settings → bumblebee, issue a new key and reinstall using the provided command.",
  },
  connectClaude: {
    ru:
      "Claude Desktop на Mac: Swarm → Настройки → Claude Desktop → скопируй команду установки и выполни её в Терминале. После подключения создай Projects → New Project и вставь инструкции из /claude в поле Instructions.\n\nКоннектор claude.ai: Settings → Connectors → Add custom connector → URL {mcpUrl} → Authentication → Bearer token. Нужен личный MCP-токен, а не команда установки. Управление ключами — Swarm → Настройки → Claude Desktop.\n\nЕсли ключ отозван или истёк, выпусти новый в этом же разделе настроек и обнови подключение.",
    en:
      "Claude Desktop on Mac: Swarm → Settings → Claude Desktop → copy the installation command and run it in Terminal. Once connected, create Projects → New Project and paste the instructions from /claude into Instructions.\n\nclaude.ai connector: Settings → Connectors → Add custom connector → URL {mcpUrl} → Authentication → Bearer token. This requires a personal MCP token, not an installation command. Manage keys in Swarm → Settings → Claude Desktop.\n\nIf the key is revoked or expired, issue a new one in the same settings section and update the connection.",
  },
  noIdentity: {
    ru:
      "Личность не определена: коннектор подключён без токена. Открой Swarm → Настройки → Claude Desktop и обнови подключение.",
    en:
      "Identity is unavailable: the connector has no token. Open Swarm → Settings → Claude Desktop and update the connection.",
  },
  expiredAgent: {
    ru: "Токен истёк. Выпусти новый в Swarm → Настройки → bumblebee или Claude Desktop, в зависимости от приложения.",
    en:
      "Token expired — issue a new one in Swarm → Settings → bumblebee or Claude Desktop, depending on the application.",
  },
} satisfies Record<string, Record<NoticeLang, string>>;

export function setupHelp(key: keyof typeof SETUP_HELP, html = true): string {
  const copy = SETUP_HELP[key];
  return `${copy.ru}\n\n${html ? `<i>${copy.en}</i>` : copy.en}`;
}
