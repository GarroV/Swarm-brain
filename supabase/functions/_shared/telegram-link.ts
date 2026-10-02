// Привязка Telegram из веба (issue #92, решение владельца 02.10.2026).
//
// Человек, вошедший в веб по почте, получает в Swarm свой номер (у таких он отрицательный —
// `auth-resolve`). Telegram к этому номеру привязывается одноразовой ссылкой: веб выдаёт код,
// человек открывает бота по `t.me/<бот>?start=link_<код>`, бот запоминает его Telegram в
// `allowed_users.telegram_chat_id`. Номер в Swarm не меняется и данные никуда не переезжают:
// бот на входе узнаёт человека по `telegram_chat_id` и дальше работает под его номером.
//
// В базе лежит только хеш кода: утёкшая строка таблицы не даёт привязать чужой Telegram.

export const LINK_TTL_MIN = 15;
export const LINK_PREFIX = "link_";
const CODE_BYTES = 24; // 32 символа base64url — в лимит start-параметра Telegram (64)

export function newLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashLinkCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Код из `/start link_<код>` (в т. ч. `/start@bot link_<код>`); null — это не привязка. */
export function parseLinkStart(text: string | undefined): string | null {
  const m = /^\/start(?:@\w+)?\s+link_([A-Za-z0-9_-]{16,64})\s*$/.exec(text ?? "");
  return m ? m[1] : null;
}

export function linkDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${LINK_PREFIX}${code}`;
}

export function linkExpiresAt(now: Date): string {
  return new Date(now.getTime() + LINK_TTL_MIN * 60_000).toISOString();
}

/** Текст ответа бота — согласован владельцем 02.10.2026, менять только с его «да». */
export const LINKED_REPLY = "✅ Telegram linked to your Swarm account.\n\nTelegram привязан к твоему аккаунту в Swarm.";
