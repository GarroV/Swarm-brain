// Уведомления владельцу встречи о том, что запись НЕ идёт. Чистая часть блока notices:
// разбор запроса, расписание двери и рендер текста. Отправкой занимается meeting-notice/.
//
// Почему блок вообще есть: первый принцип проекта — «громкий отказ важнее тихой работы».
// scriba, который не смог записать и промолчал, хуже, чем его отсутствие: человек узнаёт об
// этом через сутки по пустой очереди вычитки, когда записать уже нечего.
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

export const MAX_TITLE_CHARS = 120;
export const MAX_DETAIL_CHARS = 300;

/** Отказ на границе: 400 — запрос не разобран, 409 — потолок двери исчерпан. */
export class NoticeError extends Error {
  constructor(public readonly status: 400 | 409, message: string) {
    super(message);
    this.name = "NoticeError";
  }
}

export interface ParsedNotice {
  kind: NoticeKind;
  title: string | null;
  attempt: number;
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

function readAttempt(raw: Record<string, unknown>, kind: NoticeKind): number {
  const value = raw.attempt;
  if (value === undefined || value === null) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new NoticeError(400, `attempt must be a positive integer, got ${JSON.stringify(value)}`);
  }
  if (kind !== "door_waiting") {
    if (value > 1) {
      throw new NoticeError(400, `attempt > 1 exists only for door_waiting, not for ${kind}`);
    }
    return 1;
  }
  if (value > DOOR_MAX_ATTEMPTS) {
    // Потолок держит сервер, а не добрая воля бота: зацикленный бот иначе превращает
    // уведомление в рассылку, и человек перестаёт читать сообщения от scriba вообще.
    throw new NoticeError(
      409,
      `door notice limit reached: one reminder only (attempt ${value} > ${DOOR_MAX_ATTEMPTS}) — the bot must leave`,
    );
  }
  return value;
}

/** Разбор тела запроса. Мусор отвергается внятно: молчаливое «ну ладно» здесь запрещено. */
export function parseNotice(raw: unknown): ParsedNotice {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NoticeError(400, "body must be a JSON object with a kind");
  }
  const body = raw as Record<string, unknown>;
  if (!isNoticeKind(body.kind)) {
    throw new NoticeError(
      400,
      `unknown notice kind ${JSON.stringify(body.kind ?? null)} — allowed: ${NOTICE_KINDS.join(", ")}`,
    );
  }
  const kind = body.kind;
  const detail = trimmed(body.detail, MAX_DETAIL_CHARS);
  if (kind === "join_failed" && detail === null) {
    throw new NoticeError(400, "join_failed requires detail: «could not join» without a reason helps nobody");
  }
  return {
    kind,
    title: trimmed(body.title, MAX_TITLE_CHARS),
    attempt: readAttempt(body, kind),
    lang: readLang(body.lang),
    detail,
  };
}

export interface DoorDecision {
  /** Уйти из-под двери прямо сейчас: повтор был последним. */
  shouldLeave: boolean;
  /** Через сколько секунд спрашивать снова; null — больше не спрашивать. */
  nextReminderInSeconds: number | null;
}

/** Расписание двери. Ответ сервера ведёт бота: у бота своего таймера решений нет. */
export function doorPolicy(notice: ParsedNotice): DoorDecision {
  if (notice.kind !== "door_waiting") return { shouldLeave: true, nextReminderInSeconds: null };
  const last = notice.attempt >= DOOR_MAX_ATTEMPTS;
  return {
    shouldLeave: last,
    nextReminderInSeconds: last ? null : DOOR_REPEAT_SECONDS,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textKey(notice: ParsedNotice): keyof typeof NOTICE_TEXTS {
  if (notice.kind === "door_waiting" && notice.attempt >= DOOR_MAX_ATTEMPTS) return "door_waiting_last";
  return notice.kind;
}

/**
 * Текст для Telegram (parse_mode HTML). Название и причина приходят снаружи — экранируем.
 *
 * Техническая причина идёт ОТДЕЛЬНОЙ строкой, а не подстановкой в предложение: подстановка
 * без значения оставляет в сообщении пустые скобки, и человек читает их как обрыв текста.
 */
export function renderNotice(notice: ParsedNotice): string {
  const template = NOTICE_TEXTS[textKey(notice)][notice.lang];
  const title = escapeHtml(notice.title ?? NO_TITLE[notice.lang]);
  const body = template.replaceAll("{title}", title).replace(/[ \t]+\n/g, "\n").trim();
  if (notice.detail === null) return body;
  return `${body}\n\n${DETAIL_LABEL[notice.lang]} <code>${escapeHtml(notice.detail)}</code>`;
}
