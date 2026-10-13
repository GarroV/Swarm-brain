// Порядок подгрузки списка встреч (решение владельца 2026-10-13: «подгружать — встречи на
// вычитке и встречи, которые были сегодня и вчера; остальное по требованию»). Чистая логика без
// React и сети — чтобы её можно было проверить без экрана.
//
// Схема для периода «всё время»: фаза `recent` (день встречи ≥ вчера) → фаза `older` (день
// встречи ≤ позавчера, постранично по 50). Множества не пересекаются по определению, поэтому
// переход между фазами не теряет и не дублирует строки. Если человек сам выбрал период, фаз нет:
// одна фаза `main` с его границами, тоже постранично.
import type { MeetingsPageQuery } from "@/lib/api";

export const MEETINGS_PAGE_SIZE = 50;
/** Потолок фазы recent: за два дня встреч на порядок меньше, но запрос всё равно ограничен. */
export const MEETINGS_RECENT_LIMIT = 200;

export type PagingPhase = "recent" | "older" | "main";
export type PagingCursor = { phase: PagingPhase; offset: number };
export type Bounds = { from: string; to: string };

/** Серверные фильтры экрана: то, что сужает выборку ещё в базе. */
export type ServerFilters = { q: string; storage: "any" | "shared" | "personal" };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** «Вчера» и «позавчера» как день встречи (UTC — так считает и `meetingDay` экрана). */
export function recentDays(now: Date = new Date()): { yesterday: string; dayBefore: string } {
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  const b = new Date(now);
  b.setUTCDate(b.getUTCDate() - 2);
  return { yesterday: dayOf(y), dayBefore: dayOf(b) };
}

/** С чего начинать: свой период человека — сразу постранично, иначе «вчера и сегодня». */
export function firstCursor(userBounds: Bounds | null): PagingCursor {
  return { phase: userBounds ? "main" : "recent", offset: 0 };
}

/** Запрос страницы confirmed-встреч для курсора. */
export function pageQuery(
  cursor: PagingCursor,
  filters: ServerFilters,
  userBounds: Bounds | null,
  now: Date = new Date(),
): MeetingsPageQuery {
  const base: MeetingsPageQuery = { confirmed: true, offset: cursor.offset };
  if (filters.q) base.q = filters.q;
  if (filters.storage !== "any") base.storage = filters.storage;
  const { yesterday, dayBefore } = recentDays(now);
  if (cursor.phase === "recent") return { ...base, limit: MEETINGS_RECENT_LIMIT, from: yesterday };
  if (cursor.phase === "older") return { ...base, limit: MEETINGS_PAGE_SIZE, to: dayBefore };
  return {
    ...base,
    limit: MEETINGS_PAGE_SIZE,
    ...(userBounds ? { from: userBounds.from, to: userBounds.to } : {}),
  };
}

/**
 * Куда идти после полученной страницы. `null` — всё загружено.
 * `total` — сколько строк в ТЕКУЩЕЙ фазе подходит под запрос (X-Total-Count); без него (старый
 * сервер) считаем, что неполная страница — последняя.
 */
export function nextCursor(
  cursor: PagingCursor,
  got: { rows: number; total: number | null },
): PagingCursor | null {
  const offset = cursor.offset + got.rows;
  const phaseDone = got.rows === 0 ||
    (got.total != null ? offset >= got.total : got.rows < pageSizeOf(cursor.phase));
  if (!phaseDone) return { phase: cursor.phase, offset };
  if (cursor.phase === "recent") return { phase: "older", offset: 0 };
  return null;
}

const pageSizeOf = (phase: PagingPhase) => phase === "recent" ? MEETINGS_RECENT_LIMIT : MEETINGS_PAGE_SIZE;

/** Добавляет страницу к списку без дублей (сдвиг offset при вставке новой встречи). */
export function mergeById<T extends { id: string }>(prev: T[], page: T[]): T[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...page.filter((r) => !seen.has(r.id))];
}
