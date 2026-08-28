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
