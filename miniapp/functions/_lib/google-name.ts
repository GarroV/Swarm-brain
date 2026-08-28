// Имя из Google-userinfo для подписи запроса к auth-resolve.
//
// ⚠️ ЗЕРКАЛО канона `supabase/functions/_shared/google-profile.ts`. Копия существует потому, что
// CF Pages Functions и Supabase Edge Functions — разные сборки: импорт через границу не переживёт
// бандлинг Pages. Разъезд копии с каноном ЛОМАЕТ ВХОД (подписи перестанут совпадать), поэтому
// эквивалентность закреплена тестом `miniapp/src/lib/googleName.test.ts` — он гоняет обе
// реализации на одних входах. Правишь тут — правь канон, и наоборот.

const MAX_NAME_LEN = 120;

export type GoogleName = { given?: string | null; family?: string | null };

export function normalizeName(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.slice(0, MAX_NAME_LEN);
}

export function nameSigPayload(email: string, n: GoogleName): string {
  return `${email}|${normalizeName(n.given) ?? ""}|${normalizeName(n.family) ?? ""}`;
}

// ── scope, которые просит экран входа ────────────────────────────────────────
// ⚠️ Тоже зеркало: канон — `supabase/functions/_shared/google-scopes.ts`. Календарь просим
// вместе с профилем (решение владельца 2026-08-28), человек может снять галочку — тогда
// в ответе Google этого scope не будет, и календарь просто не привяжется.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const LOGIN_SCOPES = `openid email profile ${CALENDAR_SCOPE}`;

export function hasCalendarScope(granted: string | null | undefined): boolean {
  if (!granted) return false;
  return granted.split(/\s+/).filter(Boolean).includes(CALENDAR_SCOPE);
}
