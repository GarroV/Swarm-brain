// Чистая логика сокращателя ссылок: проверка адреса и генерация кода. Без базы и сети —
// поэтому покрыта тестом целиком (short-links-core.test.ts): ошибка здесь превращает наш
// домен в переадресацию куда угодно, а это уже не «неудобно», а фишинг от нашего имени.

export const SHORT_CODE_LENGTH = 6;
export const SHORT_CODE_RE = /^[A-Za-z0-9]{4,16}$/;
export const MAX_TARGET_URL_LENGTH = 2048;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// Наибольшее кратное 62 в байте: байты выше дают перекос в пользу первых символов.
const UNBIASED_BYTE_LIMIT = 256 - (256 % ALPHABET.length);

export type TargetUrlError = "empty" | "too_long" | "invalid" | "scheme" | "credentials" | "loop";
export type TargetUrlResult = { ok: true; url: string } | { ok: false; error: TargetUrlError };

/**
 * Приводит вставленный адрес к виду, который можно отдать в переадресацию.
 * Пропускает только http(s) без логина-пароля в адресе. Без схемы — дописывает https://
 * (люди вставляют «example.com/file.pdf»). Короткую ссылку на саму себя (`<наш хост>/s/…`)
 * не принимает: она переадресует по кругу.
 */
export function normalizeTargetUrl(raw: string, shortHosts: readonly string[]): TargetUrlResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "empty" };
  if (trimmed.length > MAX_TARGET_URL_LENGTH) return { ok: false, error: "too_long" };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "scheme" };
  if (parsed.username || parsed.password) return { ok: false, error: "credentials" };
  // Хост без точки («localhost», «intranet») наружу не откроется — это опечатка или внутренний адрес.
  if (!parsed.hostname.includes(".")) return { ok: false, error: "invalid" };

  const host = parsed.hostname.toLowerCase();
  if (shortHosts.includes(host) && /^\/s(\/|$)/.test(parsed.pathname)) return { ok: false, error: "loop" };

  const url = parsed.toString();
  if (url.length > MAX_TARGET_URL_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, url };
}

/** Случайный код из латиницы и цифр, равномерно по алфавиту. */
export function generateShortCode(
  length = SHORT_CODE_LENGTH,
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b >= UNBIASED_BYTE_LIMIT) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_NOTE_LENGTH = 500;

export type LinkMetaError = "title_required" | "title_too_long" | "note_too_long" | "invalid";
export type LinkMetaResult =
  | { ok: true; title: string; note: string | null }
  | { ok: false; error: LinkMetaError };

/** Название (обязательно) и комментарий (пустой → null). Длины совпадают с check в миграции. */
export function normalizeLinkMeta(rawTitle: unknown, rawNote: unknown): LinkMetaResult {
  if (typeof rawTitle !== "string" || (rawNote != null && typeof rawNote !== "string")) {
    return { ok: false, error: "invalid" };
  }
  const title = rawTitle.trim();
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!title) return { ok: false, error: "title_required" };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: "title_too_long" };
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: "note_too_long" };
  return { ok: true, title, note: note || null };
}
