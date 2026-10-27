// Страна созвона: ключ серии, подсказка страны по названию и порядок задач на экране страны
// (GET /board/call, решение владельца 27.10.2026, #1072). Чистые функции — без базы и сети.
import { ALIASES, detectAliasCountries } from "./countries.ts";

/** Хвост `:YYYY-MM-DD` у identity_key экземпляра встречи (см. calendar-key.ts). */
const DATE_TAIL = /:\d{4}-\d{2}-\d{2}$/;

/** Ключ серии: identity_key без даты экземпляра; ключ без даты возвращается как есть. */
export function seriesKeyOf(identityKey: string): string {
  return identityKey.replace(DATE_TAIL, "");
}

/** Местные названия, которых нет в общем словаре ALIASES (он — RU и EN). */
const LOCAL_ALIASES: Record<string, string> = {
  "srbija": "RS",
  "hrvatska": "HR",
  "slovenija": "SI",
  "crna gora": "ME",
  "българия": "BG",
  "españa": "ES",
  "românia": "RO",
  "polska": "PL",
  "magyarország": "HU",
};

const TITLE_ALIASES: Record<string, string> = { ...ALIASES, ...LOCAL_ALIASES };

/**
 * Страна, названная в заголовке созвона, — только из `markets` пространства. Нашлась ровно одна —
 * она, ноль или несколько — null: угадывать между двумя странами нельзя.
 */
export function suggestCountryFromTitle(title: string, markets: readonly string[]): string | null {
  const allowed = new Set(markets);
  const found = detectAliasCountries(title, TITLE_ALIASES).filter((c) => allowed.has(c));
  return found.length === 1 ? found[0] : null;
}

export interface CallTaskLike {
  due_date: string | null;
  remind_date?: string | null;
  created_at?: string | null;
}

/**
 * Группа порядка: 0 просрочено, 1 сегодня, 2 завтра, 3 пинг сегодня/завтра (или раньше, если
 * срок дальше), 4 остальные. Внутри группы — по сроку (без срока в конце), затем по созданию.
 */
export function callTaskRank(t: CallTaskLike, today: string, tomorrow: string): number {
  if (t.due_date && t.due_date < today) return 0;
  if (t.due_date === today) return 1;
  if (t.due_date === tomorrow) return 2;
  if (t.remind_date && t.remind_date <= tomorrow) return 3;
  return 4;
}

/** Задачи в порядке экрана страны; исходный массив не меняется. */
export function sortCallTasks<T extends CallTaskLike>(tasks: readonly T[], today: string, tomorrow: string): T[] {
  return [...tasks].sort((a, b) =>
    callTaskRank(a, today, tomorrow) - callTaskRank(b, today, tomorrow) ||
    (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99") ||
    (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
}

/** Следующий календарный день для YYYY-MM-DD. */
export function nextDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}
