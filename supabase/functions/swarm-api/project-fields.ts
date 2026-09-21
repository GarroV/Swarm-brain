// Разбор полей направления и инициативы, пришедших от клиента: ответственный и сроки.
//
// Чистая функция и отдельный файл — потому что index.ts уже 2400+ строк при пределе 800
// (issue #265), а проверка одна и та же для создания и правки: сделай её дважды, и одна из
// копий однажды отстанет.
import type { ProjectInput } from "../_shared/tasks/types.ts";

export interface ParsedProjectFields {
  fields: Partial<ProjectInput>;
  /** Текст отказа для 400; null — всё в порядке. */
  error: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const start = "start_date" in fields
    ? fields.start_date
    : current.start_date ?? null;
  const end = "end_date" in fields ? fields.end_date : current.end_date ?? null;
  if (start && end && start > end) {
    return {
      fields: {},
      error: "start_date не может быть позже end_date",
    };
  }

  return { fields, error: null };
}
