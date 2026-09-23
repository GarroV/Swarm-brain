// Уведомления владельцу встречи о том, что запись НЕ идёт. Чистая часть блока notices:
// разбор запроса, решение «отправлять или хватит» и рендер текста. Отправкой и журналом
// занимается meeting-notice/.
//
// Почему блок вообще есть: первый принцип проекта — «громкий отказ важнее тихой работы».
// scriba, который не смог записать и промолчал, хуже, чем его отсутствие: человек узнаёт об
// этом через сутки по пустой очереди вычитки, когда записать уже нечего.
//
// ⚠️ Потолок повторов считает СЕРВЕР по журналу отправок (таблица meeting_notices), а не бот
// по присланному числу. Прежняя редакция брала номер попытки из тела запроса — это был не
// потолок, а просьба: зацикленный контейнер шлёт «попытка 1» сколько угодно раз, и человек
// получает поток сообщений в личку. Поэтому `attempt` в запросе теперь отвергается.
import { DETAIL_LABEL, NO_TITLE, NOTICE_TEXTS } from "./notice-texts.ts";

/** Языки продукта. EN приоритетный: новый текст заводится на нём и на русском сразу. */
export const NOTICE_LANGS = ["en", "ru"] as const;
export type NoticeLang = (typeof NOTICE_LANGS)[number];

/** Все состояния, где бот мог бы промолчать. Список — из spec.md и принципов проекта. */
export const NOTICE_KINDS = [
  "door_waiting",
  "door_denied",
  "captcha",
  "no_conference_link",
  "no_owner",
  "no_audio",
  "recording_lost",
  "container_died",
  "join_failed",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Сколько бот стоит у двери до первого сигнала. */
export const DOOR_WAIT_SECONDS = 90;
/** Пауза до единственного повтора. */
export const DOOR_REPEAT_SECONDS = 180;
/** Первое уведомление + ровно один повтор. Третьего не существует. */
export const DOOR_MAX_ATTEMPTS = 2;
/** Остальные виды отказа: по одному на встречу. Повторить «звука нет» нечем — это уже сказано. */
export const MAX_PER_KIND = 1;
/** Потолок потока на одну встречу, поверх поштучных: больше — это сбой бота, а не новости. */
export const MAX_PER_MEETING = 6;

export const MAX_TITLE_CHARS = 120;
export const MAX_DETAIL_CHARS = 300;
export const MAX_MEETING_KEY_CHARS = 200;

/** Отказ на границе: 400 — запрос не разобран, 409 — по этой встрече уже сказано достаточно. */
export class NoticeError extends Error {
  constructor(public readonly status: 400 | 409, message: string) {
    super(message);
    this.name = "NoticeError";
  }
}

export interface ParsedNotice {
  kind: NoticeKind;
  /** Ключ встречи (meetings.identity_key). Обязателен: без него нечего считать и не с чем сверять. */
  meetingKey: string;
  title: string | null;
  lang: NoticeLang;
  detail: string | null;
}

function isNoticeKind(value: unknown): value is NoticeKind {
  return typeof value === "string" && (NOTICE_KINDS as readonly string[]).includes(value);
}

function trimmed(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function readLang(value: unknown): NoticeLang {
  // Неизвестный язык — не отказ: сообщение важнее языка. Падаем в английский (он приоритетный).
  const head = typeof value === "string" ? value.trim().slice(0, 2).toLowerCase() : "";
  return head === "ru" ? "ru" : "en";
}

/** Разбор тела запроса. Мусор отвергается внятно: молчаливое «ну ладно» здесь запрещено. */
export function parseNotice(raw: unknown): ParsedNotice {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NoticeError(400, "body must be a JSON object with kind and meeting_key");
  }
  const body = raw as Record<string, unknown>;
  if (!isNoticeKind(body.kind)) {
    throw new NoticeError(
      400,
      `unknown notice kind ${JSON.stringify(body.kind ?? null)} — allowed: ${NOTICE_KINDS.join(", ")}`,
    );
  }
  // Номер попытки решает сервер по журналу отправок. Присланный молча игнорировать нельзя:
  // отправитель считал бы, что им управляет, — поэтому отказ, а не тихое «не учтено».
  if (body.attempt !== undefined) {
    throw new NoticeError(400, "attempt is decided by the server from the notice journal — do not send it");
  }
  const kind = body.kind;
  const meetingKey = trimmed(body.meeting_key, MAX_MEETING_KEY_CHARS);
  if (meetingKey === null) {
    throw new NoticeError(400, "meeting_key is required: a notice that cannot name its meeting cannot be counted");
  }
  const detail = trimmed(body.detail, MAX_DETAIL_CHARS);
  if (kind === "join_failed" && detail === null) {
    throw new NoticeError(400, "join_failed requires detail: «could not join» without a reason helps nobody");
  }
  return { kind, meetingKey, title: trimmed(body.title, MAX_TITLE_CHARS), lang: readLang(body.lang), detail };
}

/** Что уже ушло по этой встрече этому человеку — счёт из журнала, не из запроса. */
export interface NoticeLedger {
  /** Сколько уведомлений ЭТОГО вида уже отправлено. */
  kindCount: number;
  /** Сколько уведомлений всех видов отправлено по встрече. */
  totalCount: number;
}

export type DeliveryDecision =
  | {
    allow: true;
    /** Какая это по счёту отправка данного вида. Для двери: 1 — первое, 2 — единственный повтор. */
    attempt: number;
    shouldLeave: boolean;
    nextReminderInSeconds: number | null;
  }
  | { allow: false; reason: string; shouldLeave: true };

/**
 * Отправлять ли — и что после этого делать боту.
 *
 * Решение считается ТОЛЬКО по журналу: сколько уже ушло. Отказ всегда велит боту уйти — если
 * сервер перестал принимать уведомления по встрече, стоять под дверью дальше бессмысленно.
 */
export function decideDelivery(kind: NoticeKind, ledger: NoticeLedger): DeliveryDecision {
  if (ledger.totalCount >= MAX_PER_MEETING) {
    return {
      allow: false,
      reason:
        `notice limit reached for this meeting: ${ledger.totalCount} of ${MAX_PER_MEETING} already sent — the bot must leave`,
      shouldLeave: true,
    };
  }
  if (kind === "door_waiting") {
    const attempt = ledger.kindCount + 1;
    if (attempt > DOOR_MAX_ATTEMPTS) {
      return {
        allow: false,
        reason:
          `door notice limit reached: one reminder only (${ledger.kindCount} already sent) — the bot must leave`,
        shouldLeave: true,
      };
    }
    const last = attempt >= DOOR_MAX_ATTEMPTS;
    return { allow: true, attempt, shouldLeave: last, nextReminderInSeconds: last ? null : DOOR_REPEAT_SECONDS };
  }
  if (ledger.kindCount >= MAX_PER_KIND) {
    return {
      allow: false,
      reason: `already notified about «${kind}» for this meeting — repeating it adds nothing`,
      shouldLeave: true,
    };
  }
  // Остальные отказы терминальные: ждать нечего, бот уходит сразу.
  return { allow: true, attempt: 1, shouldLeave: true, nextReminderInSeconds: null };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textKey(kind: NoticeKind, attempt: number): keyof typeof NOTICE_TEXTS {
  if (kind === "door_waiting" && attempt >= DOOR_MAX_ATTEMPTS) return "door_waiting_last";
  return kind;
}

/**
 * Текст для Telegram (parse_mode HTML). Название и причина приходят снаружи — экранируем.
 *
 * Техническая причина идёт ОТДЕЛЬНОЙ строкой, а не подстановкой в предложение: подстановка
 * без значения оставляет в сообщении пустые скобки, и человек читает их как обрыв текста.
 *
 * @param title название встречи; сервер подставляет сюда своё, если строка встречи уже есть.
 * @param attempt номер отправки, решённый сервером: от него зависит текст у двери.
 */
export function renderNotice(notice: ParsedNotice, title: string | null, attempt: number): string {
  const template = NOTICE_TEXTS[textKey(notice.kind, attempt)][notice.lang];
  const shown = escapeHtml(title ?? NO_TITLE[notice.lang]);
  const body = template.replaceAll("{title}", shown).replace(/[ \t]+\n/g, "\n").trim();
  if (notice.detail === null) return body;
  return `${body}\n\n${DETAIL_LABEL[notice.lang]} <code>${escapeHtml(notice.detail)}</code>`;
}
