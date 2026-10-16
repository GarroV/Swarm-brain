import { TASK_TZ, todayInTz } from "../_shared/tasks/recurrence.ts";

// Чистая логика стикеров-заданий на главной: разбор тела запроса, правило видимости, прогресс.
// Канон — docs/decisions/2026-10-08-people-stickers-ratings-mail.md, раздел 2. Роуты — stickers.ts.
// Ошибка здесь молчит: неверный счёт «5 / 8» или скрытый раньше времени стикер выглядят как
// правда, а ссылка с `javascript:` превращается в кликабельный href.

export const STICKER_KINDS = ["task", "notice"] as const;
export const STICKER_TONES = ["yellow", "pink", "blue", "green", "paper"] as const;
export type StickerKind = typeof STICKER_KINDS[number];
export type StickerTone = typeof STICKER_TONES[number];

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
export const LINK_MAX = 500;
export const ADDRESSEES_MAX = 200;
/** Стикер со сроком старше этого пропадает с доски, даже если его не закрыли. */
export const HIDE_AFTER_DUE_MS = 7 * 86_400_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StickerInput = {
  kind: StickerKind;
  title: string;
  body: string;
  due_at: string | null;
  tone: StickerTone;
  link: string | null;
  /** null вместе с all=true — «все в воркспейсе» */
  person_ids: string[] | null;
  all: boolean;
};

/** Ссылка стикера: только http(s) или путь внутри приложения. Те же условия держит CHECK в базе. */
export function isSafeLink(link: string): boolean {
  if (link.length === 0 || link.length > LINK_MAX || /\s/.test(link)) return false;
  if (link.startsWith("//")) return false;
  // Обратный слеш браузер нормализует в прямой: `/\\host` — это `//host`, чужой сайт.
  if (link.includes("\\")) return false;
  return /^(https?:\/\/\S+|\/\S*)$/.test(link);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Тело POST /stickers → проверенное значение или текст отказа (для человека). */
export function parseStickerInput(raw: unknown): { ok: true; value: StickerInput } | { ok: false; error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!oneOf(STICKER_KINDS, b.kind)) return { ok: false, error: "Тип стикера: task или notice" };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > TITLE_MAX) return { ok: false, error: `Заголовок обязателен, до ${TITLE_MAX} символов` };
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (body.length > BODY_MAX) return { ok: false, error: `Текст — до ${BODY_MAX} символов` };

  let due_at: string | null = null;
  if (b.due_at != null && b.due_at !== "") {
    const t = typeof b.due_at === "string" ? Date.parse(b.due_at) : NaN;
    if (Number.isNaN(t)) return { ok: false, error: "Срок указан неверно" };
    due_at = new Date(t).toISOString();
  }

  const tone = b.tone == null || b.tone === "" ? "yellow" : b.tone;
  if (!oneOf(STICKER_TONES, tone)) return { ok: false, error: "Цвет стикера указан неверно" };

  let link: string | null = null;
  if (typeof b.link === "string" && b.link.trim()) {
    link = b.link.trim();
    if (!isSafeLink(link)) return { ok: false, error: "Ссылка: только http(s):// или путь внутри приложения" };
  } else if (b.link != null && b.link !== "" && typeof b.link !== "string") {
    return { ok: false, error: "Ссылка указана неверно" };
  }

  const all = b.all === true;
  let person_ids: string[] | null = null;
  if (!all) {
    const ids = b.person_ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !UUID_RE.test(x))) {
      return { ok: false, error: "Выберите адресатов" };
    }
    person_ids = [...new Set(ids as string[])];
    if (person_ids.length === 0) return { ok: false, error: "Выберите адресатов" };
    if (person_ids.length > ADDRESSEES_MAX) return { ok: false, error: `Адресатов — не больше ${ADDRESSEES_MAX}` };
  }
  return { ok: true, value: { kind: b.kind, title, body, due_at, tone, link, person_ids, all } };
}

/** Срок задачи — календарная дата по времени команды; без срока — undefined (createTask поставит свой). */
export function dueDateOf(dueAt: string | null): string | undefined {
  return dueAt ? todayInTz(new Date(dueAt), TASK_TZ) : undefined;
}

/** Описание задачи адресата: текст стикера, ссылка (если есть) и откуда задача взялась. */
export function taskDescription(body: string, link: string | null): string {
  return [body, "Стикер на главной", link].filter((p): p is string => !!p).join("\n\n");
}

export type AddresseeState = { acked_at: string | null; task_status: string | null };

/** Выполнил ли адресат: у задания — связанная задача в статусе done; у объявления — «Понятно». */
export function isAddresseeDone(kind: StickerKind, a: AddresseeState): boolean {
  return kind === "task" ? a.task_status === "done" : a.acked_at != null;
}

/** Сколько адресатов выполнили из скольких. */
export function progressOf(dones: readonly boolean[]): { done: number; total: number } {
  return { done: dones.filter(Boolean).length, total: dones.length };
}

/**
 * Виден ли стикер на доске. Прячем, когда срок прошёл и все выполнили, и когда срок старше
 * недели (не закрыли — но вечно висеть на главной он не должен). Без срока — до архива.
 * Стикер без адресатов «все выполнили» не считается: пустое множество не доказательство.
 */
export function isStickerVisible(dueAt: string | null, dones: readonly boolean[], now: Date = new Date()): boolean {
  if (!dueAt) return true;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return true;
  if (now.getTime() - due > HIDE_AFTER_DUE_MS) return false;
  const allDone = dones.length > 0 && dones.every(Boolean);
  return !(due < now.getTime() && allDone);
}
