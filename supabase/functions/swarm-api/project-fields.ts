// Разбор полей направления и инициативы, пришедших от клиента: ответственный, сроки и справка
// «О проекте» (цель, описание, ссылки).
//
// Чистая функция и отдельный файл — потому что index.ts уже 2400+ строк при пределе 800
// (issue #265), а проверка одна и та же для создания и правки: сделай её дважды, и одна из
// копий однажды отстанет.
import type { ProjectInput, ProjectLink } from "../_shared/tasks/types.ts";

export interface ParsedProjectFields {
  fields: Partial<ProjectInput>;
  /** Текст отказа для 400; null — всё в порядке. */
  error: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Пределы справки «О проекте»: защитный потолок, а не расчётный — текст хранится в строке проекта. */
const TEXT_MAX = 5000;
const LINKS_MAX = 30;
const LINK_TITLE_MAX = 200;
const LINK_URL_MAX = 2000;

/** Строка или пусто. Пустая после обрезки — снимает значение (null). */
function readText(v: unknown, field: string): { text: string | null } | string {
  if (v === null) return { text: null };
  if (typeof v !== "string") return `${field}: ожидается строка или null`;
  const t = v.trim();
  if (t.length > TEXT_MAX) return `${field}: не длиннее ${TEXT_MAX} символов`;
  return { text: t || null };
}

/**
 * Ссылки на артефакты. Адрес — только http(s): ссылка рисуется как href, и `javascript:`
 * исполнился бы у того, кто по ней кликнул. Пустое название заменяем адресом, чтобы в списке
 * не висела безымянная строка.
 */
function readLinks(v: unknown): { links: ProjectLink[] } | string {
  if (v === null) return { links: [] };
  if (!Array.isArray(v)) return "links: ожидается массив {title, url}";
  if (v.length > LINKS_MAX) return `links: не больше ${LINKS_MAX} ссылок`;
  const links: ProjectLink[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") {
      return "links: каждый элемент — {title, url}";
    }
    const { title, url } = item as Record<string, unknown>;
    if (typeof url !== "string") return "links: у ссылки нет адреса";
    const u = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return `links: «${u.slice(0, 80)}» — не адрес`;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "links: адрес должен начинаться с http:// или https://";
    }
    if (u.length > LINK_URL_MAX) {
      return `links: адрес не длиннее ${LINK_URL_MAX} символов`;
    }
    const t = typeof title === "string" ? title.trim() : "";
    if (t.length > LINK_TITLE_MAX) {
      return `links: название не длиннее ${LINK_TITLE_MAX} символов`;
    }
    links.push({ title: t || u, url: u });
  }
  return { links };
}

function readDate(v: unknown, field: string): { date: string | null } | string {
  if (v === null || v === "") return { date: null };
  if (typeof v !== "string" || !DATE_RE.test(v)) {
    return `${field}: ожидается дата в виде ГГГГ-ММ-ДД`;
  }
  return { date: v };
}

/**
 * Берёт из тела запроса только те поля, которые действительно пришли: «не передано» и
 * «передано пустым» — разные вещи. Первое не трогает значение в базе, второе снимает его.
 *
 * `current` — то, что уже стоит у инициативы: без него правка одного конца срока сверялась бы
 * с пустотой, и «перенести конец на раньше старта» прошло бы молча.
 */
export function parseProjectFields(
  body: Record<string, unknown>,
  current: { start_date?: string | null; end_date?: string | null } = {},
): ParsedProjectFields {
  const fields: Partial<ProjectInput> = {};

  if ("owner_telegram_id" in body) {
    const v = body.owner_telegram_id;
    if (v === null || v === "") {
      fields.owner_telegram_id = null;
    } else if (typeof v === "number" && Number.isInteger(v)) {
      fields.owner_telegram_id = v;
    } else if (typeof v === "string" && /^\d+$/.test(v)) {
      // Веб иногда шлёт id строкой (значение из <select>) — принимаем, но кладём числом:
      // колонка bigint, и строка легла бы туда только после молчаливого приведения.
      fields.owner_telegram_id = Number(v);
    } else {
      return {
        fields: {},
        error: "owner_telegram_id: ожидается telegram id числом или null",
      };
    }
  }

  // Позиция в списке братьев (перестановка на доске, issue #433). Строка и NaN сюда приходить
  // не должны: позиция считается на клиенте арифметикой, и мусор означает сломанный вызов, а не
  // намерение пользователя, — записать его значит тихо перемешать чужой порядок.
  if ("position" in body) {
    const v = body.position;
    if (v === null) {
      fields.position = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      fields.position = v;
    } else {
      return {
        fields: {},
        error: "position: ожидается конечное число или null",
      };
    }
  }

  for (const key of ["start_date", "end_date"] as const) {
    if (!(key in body)) continue;
    const parsed = readDate(body[key], key);
    if (typeof parsed === "string") return { fields: {}, error: parsed };
    fields[key] = parsed.date;
  }

  for (const key of ["goal", "description"] as const) {
    if (!(key in body)) continue;
    const parsed = readText(body[key], key);
    if (typeof parsed === "string") return { fields: {}, error: parsed };
    fields[key] = parsed.text;
  }

  if ("links" in body) {
    const parsed = readLinks(body.links);
    if (typeof parsed === "string") return { fields: {}, error: parsed };
    fields.links = parsed.links;
  }

  const start = "start_date" in fields ? fields.start_date : current.start_date ?? null;
  const end = "end_date" in fields ? fields.end_date : current.end_date ?? null;
  if (start && end && start > end) {
    return {
      fields: {},
      error: "start_date не может быть позже end_date",
    };
  }

  return { fields, error: null };
}
