// Единый разбор ссылки на участника в админских маршрутах: сегмент URL → чем адресована строка
// `allowed_users`. Одна строка может быть адресована тремя способами, и правило должно жить в
// ОДНОМ месте (раньше копия regex'ов жила прямо в DELETE-хендлере swarm-api/admin.ts):
//   • число            → telegram_id (реальный юзер; отрицательный — синтетический id email-only,
//                        его присваивает auth-resolve при первом Google-входе);
//   • похоже на email  → allowed_users.email (ОЖИДАЮЩЕЕ приглашение по почте, telegram_id=NULL);
//   • иначе            → username (ОЖИДАЮЩЕЕ приглашение по @username, telegram_id=NULL).
import { normalizeUsername } from "./membership.ts";

export type UserRef =
  | { kind: "telegram"; telegramId: number }
  | { kind: "email"; email: string }
  | { kind: "username"; username: string }
  | { kind: "invalid" };

// Тот же критерий «похоже на email», что во вводе админки (miniapp AdminScreen.handleAdd):
// локальная часть + домен + TLD, без пробелов. Обрывок (`user@`, `user@host`) email'ом не считаем.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Принимает УЖЕ декодированный сегмент (decodeURIComponent — на вызывающей стороне).
export function parseUserRef(raw: string): UserRef {
  const s = raw.trim();
  if (!s) return { kind: "invalid" };
  if (/^-?\d+$/.test(s)) {
    const telegramId = Number(s);
    // 0 не адресует ничью строку (и раньше ловился проверкой `if (!targetId)`).
    return telegramId === 0 ? { kind: "invalid" } : { kind: "telegram", telegramId };
  }
  if (EMAIL_RE.test(s)) return { kind: "email", email: s.toLowerCase() };
  const username = normalizeUsername(s);
  return username ? { kind: "username", username } : { kind: "invalid" };
}
