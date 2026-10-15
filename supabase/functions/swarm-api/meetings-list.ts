// Лёгкий постраничный список GET /meetings?light=1 (решение владельца 2026-10-13,
// docs/decisions/2026-10-13-perf-after-move.md п.3). Чистая логика без базы: разбор параметров,
// условия для PostgREST и форма строки — отдельно от 2000-строчного роутера, чтобы всё это было
// под тестом.
//
// Зачем: список «Встречи» грузил все встречи целиком (680 КБ на 419 штук), а рисует из них
// название, дату, источник, страны, замок и «кто принёс». Лёгкая строка не несёт тезисов и
// участников; полную встречу экран до-загружает по id (GET /meetings/:id) при открытии.

/** Колонки лёгкой строки: БЕЗ `summary`, а `content` — превью (из него строится заголовок). */
export const ENTRY_LIGHT_COLUMNS =
  "id,content:content_preview,added_by,source,metadata,countries,entry_type,entry_date,group_id,is_private,owner_id,shared_with,created_at,updated_at";

/** Размер страницы по умолчанию и потолок для `light=1`. */
export const LIGHT_PAGE_SIZE = 50;
export const LIGHT_PAGE_MAX = 200;
/** Потолок смещения — защита от нелепого запроса, а не рабочий предел (встреч сотни). */
const MAX_OFFSET = 100_000;
/** Сколько символов первой строки content оставить: заголовок деривируется до 80 символов. */
export const LIGHT_TITLE_CHARS = 120;
/** Потолок длины поискового запроса. */
const MAX_QUERY_CHARS = 100;

/** Поля metadata, которые рисует список и на которые смотрят фильтры экрана. Остальное
 *  (участники — самое тяжёлое, identity_key, бэкапы стран и т.п.) — только в детали. */
const LIGHT_METADATA_KEYS = ["title", "confirmed", "recorded_by", "superseded"] as const;

export type MeetingsListParams = {
  light: boolean;
  limit: number;
  offset: number;
  /** Поиск по названию; пусто — без поиска. */
  q: string;
  /** День встречи (YYYY-MM-DD), границы включительно. */
  from: string | null;
  to: string | null;
  storage: "any" | "shared" | "personal";
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(raw: string | null): string | null {
  if (!raw || !DAY_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

function parseIntParam(raw: string | null, def: number, max: number, min = 0): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < min) return def;
  return Math.min(n, max);
}

/** Символы, которые ломают разбор условия PostgREST или работают подстановкой в ilike. */
function cleanQuery(raw: string | null): string {
  return (raw ?? "").replace(/[*%_\\",()]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

/**
 * Разбор параметров списка. Без `light=1` форма и лимиты прежние (500 / потолок 2000) — их
 * держит вызывающий; фильтры q/from/to/storage и offset действуют в обоих режимах.
 */
export function parseMeetingsListParams(sp: URLSearchParams, legacy: { def: number; max: number }): MeetingsListParams {
  const light = sp.get("light") === "1";
  const storageRaw = sp.get("storage");
  return {
    light,
    limit: light
      ? parseIntParam(sp.get("limit"), LIGHT_PAGE_SIZE, LIGHT_PAGE_MAX, 1)
      : parseIntParam(sp.get("limit"), legacy.def, legacy.max, 1),
    offset: parseIntParam(sp.get("offset"), 0, MAX_OFFSET),
    q: cleanQuery(sp.get("q")),
    from: parseDay(sp.get("from")),
    to: parseDay(sp.get("to")),
    storage: storageRaw === "shared" || storageRaw === "personal" ? storageRaw : "any",
  };
}

/** Есть ли хоть один фильтр, сужающий список (для счёта «из M» без фильтров). */
export function hasListFilters(p: MeetingsListParams): boolean {
  return p.q !== "" || p.from !== null || p.to !== null || p.storage !== "any";
}

/** Минимальный контракт построителя запроса — столько нам нужно от PostgREST. */
type Filterable<T> = {
  or(filters: string): T;
  eq(column: string, value: unknown): T;
};

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Значение в двойных кавычках условия PostgREST: `\\` и `"` экранируются, запятые и скобки остаются текстом. */
export function quotePostgrestValue(raw: string): string {
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Накладывает фильтры экрана на запрос списка. Каждый `.or()` в postgrest-js — отдельное
 * условие через И, поэтому они не затирают privacy-фильтр, уже стоящий на запросе.
 *
 * День встречи — как в клиенте (`meetingDay`): entry_date, а если его нет — день created_at.
 * Поиск — по названию: metadata.title, а у записи без названия — по превью текста (первая
 * строка content и есть заголовок, см. deriveEntryTitle).
 */
export function applyListFilters<T extends Filterable<T>>(q: T, p: MeetingsListParams): T {
  let out = q;
  if (p.q) {
    const pat = quotePostgrestValue(`*${p.q}*`);
    out = out.or(
      `metadata->>title.ilike.${pat},and(metadata->>title.is.null,or(summary_preview.ilike.${pat},content_preview.ilike.${pat}))`,
    );
  }
  if (p.from || p.to) {
    const dated: string[] = [];
    const undated: string[] = ["entry_date.is.null"];
    if (p.from) {
      dated.push(`entry_date.gte.${p.from}`);
      undated.push(`created_at.gte.${p.from}T00:00:00Z`);
    }
    if (p.to) {
      dated.push(`entry_date.lte.${p.to}`);
      undated.push(`created_at.lt.${nextDay(p.to)}`);
    }
    out = out.or(`and(${dated.join(",")}),and(${undated.join(",")})`);
  }
  if (p.storage === "personal") out = out.eq("is_private", true);
  if (p.storage === "shared") out = out.or("is_private.eq.false,is_private.is.null");
  return out;
}

type Row = {
  content?: string | null;
  metadata?: unknown;
  summary?: unknown;
  [k: string]: unknown;
};

/** Первая непустая строка текста, обрезанная до LIGHT_TITLE_CHARS. */
function titleLine(content: string | null | undefined): string {
  const first = (content ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return first.slice(0, LIGHT_TITLE_CHARS);
}

/**
 * Лёгкая строка списка: заголовок вместо текста, белый список полей metadata, без summary.
 * `truncated: true` ставится ВСЕГДА — это существующий контракт «полный текст до-загрузи по id»
 * (экран по нему прячет транскрипт и не извлекает задачи из обрезка).
 */
export function toLightRow<T extends Row>(
  row: T,
): Omit<T, "summary" | "list_truncated" | "content" | "metadata"> & {
  content: string;
  summary: null;
  metadata: Record<string, unknown>;
  truncated: true;
} {
  const { summary: _s, list_truncated: _l, ...rest } = row as Row;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const light: Record<string, unknown> = {};
  for (const k of LIGHT_METADATA_KEYS) if (meta[k] !== undefined) light[k] = meta[k];
  return {
    ...(rest as Omit<T, "summary" | "list_truncated" | "content" | "metadata">),
    content: titleLine(row.content),
    summary: null,
    metadata: light,
    truncated: true,
  };
}
