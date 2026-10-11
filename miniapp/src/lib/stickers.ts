// Стикеры-задания на главной: порядок, срок, прогресс. Чистая логика без React — по ней человек
// читает, что на нём висит и что уже сделано, поэтому правило одно и под тестами (stickers.test.ts).
// Канон — docs/decisions/2026-10-08-people-stickers-ratings-mail.md §2.

import type { BoardSticker, StickerAddressee, StickerTone } from "@/types";

export const STICKER_TONES: readonly StickerTone[] = ["yellow", "pink", "blue", "green", "paper"];
export const STICKER_TITLE_MAX = 120;
export const STICKER_BODY_MAX = 2000;

const DAY_MS = 86_400_000;

/** Строка адресата — вызывающий (по аккаунту). undefined — стикер не про него. */
export function myAddressee(s: BoardSticker, telegramId: number | null | undefined): StickerAddressee | undefined {
  if (telegramId == null) return undefined;
  return s.addressees.find((a) => a.telegram_id === telegramId);
}

/** Сколько адресатов выполнили из скольких. */
export function stickerProgress(s: BoardSticker): { done: number; total: number } {
  return { done: s.addressees.filter((a) => a.done).length, total: s.addressees.length };
}

/**
 * «Горит»: не выполнено и срок в ближайшие сутки или уже прошёл. Выполненное не горит —
 * красная плашка на сделанном заставила бы искать, что ещё не так.
 */
export function isHotDue(dueAt: string | null, done: boolean, now: Date = new Date()): boolean {
  if (!dueAt || done) return false;
  const t = Date.parse(dueAt);
  return !Number.isNaN(t) && t - now.getTime() < DAY_MS;
}

const dueMs = (s: BoardSticker) => {
  const t = s.due_at ? Date.parse(s.due_at) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/**
 * Порядок на доске: сначала то, что на мне и не сделано (по сроку), потом чужое и объявления без
 * моей отметки, в конце моё сделанное — оно зачёркнуто и больше не просит внимания.
 * Внутри группы — по сроку (без срока в конце), при равенстве — новые раньше.
 */
export function orderStickers(list: readonly BoardSticker[], telegramId: number | null | undefined): BoardSticker[] {
  const rank = (s: BoardSticker) => {
    const me = myAddressee(s, telegramId);
    if (!me) return 1;
    return me.done ? 2 : 0;
  };
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    dueMs(a) - dueMs(b) ||
    b.created_at.localeCompare(a.created_at)
  );
}

/** Адрес для href: только http(s) и путь внутри приложения. Всё остальное (`javascript:`, `//host`) — null. */
export function safeStickerHref(link: string | null | undefined): string | null {
  if (!link) return null;
  const v = link.trim();
  if (/\s/.test(v) || v.startsWith("//")) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return v.startsWith("/") ? v : null;
}

/** Ссылка ведёт наружу (открываем в новой вкладке) или внутри приложения. */
export const isExternalHref = (href: string) => /^https?:/i.test(href);

/** Значение `<input type="datetime-local">` → ISO для сервера; пусто или мусор → null. */
export function dueInputToIso(value: string): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
