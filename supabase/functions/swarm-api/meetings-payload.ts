// Список колонок — единый канон ENTRY_COLUMNS в entries-guard.ts (обязательный слой доступа
// к entries). Здесь только то, что специфично для СПИСОЧНОГО ответа /meetings: урезание.

// Форма ответа GET /meetings. Вынесено отдельно, чтобы решение «какие колонки уезжают
// в браузер» было в одном месте и под тестом, а не растворялось в 2000-строчном роутере.
//
// Зачем вообще: до 26.08.2026 хендлер делал select("*") и отдавал ~10 МБ на 230 встреч,
// из которых 61% — embedding (4.2 МБ) и fts (1.8 МБ), т.е. колонки, которых НЕТ в типе
// Entry (miniapp/src/types.ts) — фронт физически не мог их прочитать. Ещё 2.7 МБ — полные
// транскрипты, которые в списке не рендерятся. Запрос к базе при этом занимает 1.3 мс:
// проблема была не в выборке, а в том, что мы гнали в браузер всё подряд (issue #102).

/** Сколько символов content/summary оставить в СПИСОЧНОМ ответе.
 *  Хватает на заголовок (deriveEntryTitle берёт первую строку content) и на превью;
 *  полный текст экран детали до-загружает по id (GET /meetings/:id). */
export const LIST_PREVIEW_CHARS = 400;

type Row = { content?: string | null; summary?: string | null; [k: string]: unknown };

function cut(s: string | null | undefined): { v: string | null; cut: boolean } {
  if (s == null) return { v: null, cut: false };
  if (s.length <= LIST_PREVIEW_CHARS) return { v: s, cut: false };
  return { v: s.slice(0, LIST_PREVIEW_CHARS), cut: true };
}

/**
 * Урезает тяжёлые текстовые поля для списочного ответа и ставит `truncated: true`,
 * если что-то реально отрезано. Флаг — не косметика: по нему клиент понимает, что перед
 * показом детали нужно до-загрузить запись целиком, и не рисует обрезанный транскрипт
 * как полный. Очередь вычитки (confirmed=false, единицы строк) через это не проходит —
 * там текст нужен сразу и целиком.
 */
export function toListRow<T extends Row>(row: T): T & { content: string; summary: string | null; truncated?: true } {
  const c = cut(row.content);
  const s = cut(row.summary);
  const out = { ...row, content: c.v ?? "", summary: s.v };
  return (c.cut || s.cut) ? { ...out, truncated: true as const } : out;
}
