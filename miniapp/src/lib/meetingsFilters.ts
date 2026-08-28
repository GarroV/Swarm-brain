// Форма фильтра «Все встречи», его дефолты и запоминание между заходами.
//
// Живёт в lib, а не рядом с экраном, по двум причинам: сюда не тянется ни один импорт
// компонентов (значит модуль берёт `deno test -A --no-check src/lib/`), и форму фильтра
// читают несколько мест — панель, экран, восстановление. Применение фильтра к списку —
// в components/roy/screens/meetingsFilter.ts, оно завязано на Entry и ярлыки источников.

export type PeriodId = "all" | "week" | "month" | "quarter" | "custom";
export type StorageFilter = "any" | "shared" | "personal";
export type StatusFilter = "any" | "confirmed" | "pending";

export type MeetingsFilterState = {
  query: string;
  /** Границы произвольного периода (YYYY-MM-DD), действуют при period="custom". */
  period: PeriodId;
  from: string;
  to: string;
  /** Пусто = не фильтруем. Коды стран (ISO alpha-2). */
  countries: string[];
  /** Пусто = не фильтруем. Человекочитаемые ярлыки источника (как в sourceLabel). */
  sources: string[];
  /** Пусто = не фильтруем. Имена тех, кто принёс встречу. */
  people: string[];
  storage: StorageFilter;
  status: StatusFilter;
};

export const EMPTY_FILTERS: MeetingsFilterState = {
  query: "", period: "all", from: "", to: "",
  countries: [], sources: [], people: [], storage: "any", status: "any",
};

export function isFilterActive(f: MeetingsFilterState): boolean {
  return f.query.trim() !== "" || f.period !== "all" || f.countries.length > 0
    || f.sources.length > 0 || f.people.length > 0 || f.storage !== "any" || f.status !== "any";
}

// ── Запоминание выбора между заходами ─────────────────────────────────────────
// Владелец 2026-08-28: «если человек выставил фильтр — система запомнила, и дальше он так и
// работает». До этого состояние жило только в useState экрана: ушёл со встреч — выбор пропал,
// а панель богатая (период, страны, источник, кто принёс, хранилище, статус).
//
// Хранится ИМЕННО пресет периода ("week"), а не посчитанные из него даты: границы считает
// periodBounds() от текущего дня в момент фильтрации, поэтому «Неделя», сохранённая месяц
// назад, восстановится свежей неделей, а не превратится молча в прошлую (та же ловушка, что
// у периода в задачах — roy_tasks_view.range). Произвольный период (custom) хранит свои
// from/to: это осознанно выбранные человеком даты, их пересчитывать нельзя.
const FILTERS_KEY = "roy_meetings_filters_v1";

const PERIODS: PeriodId[] = ["all", "week", "month", "quarter", "custom"];
const STORAGES: StorageFilter[] = ["any", "shared", "personal"];
const STATUSES: StatusFilter[] = ["any", "confirmed", "pending"];

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;

// Разбор сохранённого состояния. Чистая функция (без localStorage) — проверяется без браузера.
// Любое несоответствие формы = поле берётся из EMPTY_FILTERS: мусор в хранилище (чужой ключ,
// прошлая версия формата, ручная правка в DevTools) не должен ронять экран встреч.
export function parseSavedFilters(raw: string | null): MeetingsFilterState {
  if (!raw) return EMPTY_FILTERS;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return EMPTY_FILTERS; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY_FILTERS;
  const o = data as Record<string, unknown>;
  return {
    query: str(o.query),
    period: pick(o.period, PERIODS, "all"),
    from: str(o.from),
    to: str(o.to),
    countries: strList(o.countries),
    sources: strList(o.sources),
    people: strList(o.people),
    storage: pick(o.storage, STORAGES, "any"),
    status: pick(o.status, STATUSES, "any"),
  };
}

export function loadSavedFilters(): MeetingsFilterState {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  try { return parseSavedFilters(window.localStorage.getItem(FILTERS_KEY)); } catch { return EMPTY_FILTERS; }
}

export function saveFilters(f: MeetingsFilterState): void {
  if (typeof window === "undefined") return;
  try {
    // Пустой фильтр не храним: иначе ключ живёт вечно и по нему не понять, настраивал ли
    // человек что-то вообще. «Сбросить» на экране = убрать запись.
    if (isFilterActive(f)) window.localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
    else window.localStorage.removeItem(FILTERS_KEY);
  } catch { /* приватный режим — молча живём без запоминания */ }
}
