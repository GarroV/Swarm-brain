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
/**
 * Потолок на человека за сутки, по всем встречам. Поштучные потолки держат одну встречу, а
 * зацикленный оркестратор заводит встречу за встречей — у каждой свой пустой счёт. Запас на
 * плотный день: восемь встреч с дверью и повтором — шестнадцать, до потолка далеко.
 */
export const MAX_PER_RECIPIENT_PER_DAY = 30;
/**
 * Отдельный, тесный потолок на до-встречные отказы. Их ключ — строка из календаря, сервер её
 * ни с чем не сверит: выдуманный ключ на каждом вызове обходил бы поштучный счёт.
 */
export const MAX_UNBOUND_PER_RECIPIENT_PER_DAY = 6;
/** Окно суточного счёта. */
export const DAY_SECONDS = 24 * 60 * 60;

/**
 * Отказы, которые случаются ДО того, как у встречи появляется строка в базе (строку создаёт
 * meeting-claim): ссылки на звонок нет, владелец не определился — бот до claim не дошёл.
 * Они привязываются к ключу календаря из meeting-current. Все прочие — к meeting_id, и сервер
 * сверяет встречу: воркспейс агента, владелец — тот, кому уходит сообщение.
 */
export const PRE_MEETING_KINDS = ["no_conference_link", "no_owner"] as const;

export const MAX_TITLE_CHARS = 120;
export const MAX_DETAIL_CHARS = 300;
export const MAX_MEETING_KEY_CHARS = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Отказ на границе: 400 — запрос не разобран, 409 — по этой встрече уже сказано достаточно. */
export class NoticeError extends Error {
  constructor(public readonly status: 400 | 409, message: string) {
    super(message);
    this.name = "NoticeError";
  }
}

/** К чему привязано уведомление: к проверенной строке встречи или к ключу календаря. */
export type NoticeScope =
  | { type: "meeting"; meetingId: string }
  | { type: "calendar"; meetingKey: string };

export interface ParsedNotice {
  kind: NoticeKind;
  scope: NoticeScope;
  /** Только у до-встречных видов. У встречных название берёт сервер из строки встречи. */
  title: string | null;
  lang: NoticeLang;
  detail: string | null;
}

function isNoticeKind(value: unknown): value is NoticeKind {
  return typeof value === "string" && (NOTICE_KINDS as readonly string[]).includes(value);
}

export function isPreMeetingKind(kind: NoticeKind): boolean {
  return (PRE_MEETING_KINDS as readonly string[]).includes(kind);
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

function readScope(kind: NoticeKind, body: Record<string, unknown>): NoticeScope {
  if (isPreMeetingKind(kind)) {
    if (body.meeting_id !== undefined) {
      throw new NoticeError(400, `${kind} happens before the meeting row exists — send meeting_key, not meeting_id`);
    }
    const meetingKey = trimmed(body.meeting_key, MAX_MEETING_KEY_CHARS);
    if (meetingKey === null) {
      throw new NoticeError(400, `${kind} requires meeting_key (identity_key from meeting-current)`);
    }
    return { type: "calendar", meetingKey };
  }
  if (typeof body.meeting_id !== "string" || !UUID_RE.test(body.meeting_id)) {
    throw new NoticeError(400, `${kind} requires meeting_id (uuid from meeting-claim): the server checks the meeting`);
  }
  // Название встречного отказа приходит из базы. Присланное не игнорируется молча, а
  // отвергается: иначе контейнер считал бы, что управляет текстом, который видит человек.
  if (body.title !== undefined) {
    throw new NoticeError(400, "title is taken from the meeting by the server — do not send it with meeting_id");
  }
  return { type: "meeting", meetingId: body.meeting_id.toLowerCase() };
}

/** Разбор тела запроса. Мусор отвергается внятно: молчаливое «ну ладно» здесь запрещено. */
export function parseNotice(raw: unknown): ParsedNotice {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NoticeError(400, "body must be a JSON object with kind and meeting_id (or meeting_key)");
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
  const scope = readScope(kind, body);
  const detail = trimmed(body.detail, MAX_DETAIL_CHARS);
  if (kind === "join_failed" && detail === null) {
    throw new NoticeError(400, "join_failed requires detail: «could not join» without a reason helps nobody");
  }
  const title = scope.type === "calendar" ? trimmed(body.title, MAX_TITLE_CHARS) : null;
  return { kind, scope, title, lang: readLang(body.lang), detail };
}

/** Что уже ушло этому человеку — счёт из журнала отправок, не из запроса. Отказы доставки не в счёт. */
export interface NoticeLedger {
  /** Сколько уведомлений ЭТОГО вида ушло по этой встрече (за всё время). */
  kindCount: number;
  /** Сколько уведомлений всех видов ушло по этой встрече (за всё время). */
  totalCount: number;
  /** Сколько ушло этому человеку за сутки по всем встречам. */
  dayCount: number;
  /** Из них — до-встречных, привязанных только к ключу календаря. */
  unboundDayCount: number;
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

function refuse(reason: string): DeliveryDecision {
  return { allow: false, reason, shouldLeave: true };
}

/**
 * Отправлять ли — и что после этого делать боту.
 *
 * Решение считается ТОЛЬКО по журналу: сколько уже ушло. Отказ всегда велит боту уйти — если
 * сервер перестал принимать уведомления, стоять под дверью дальше бессмысленно.
 */
export function decideDelivery(notice: ParsedNotice, ledger: NoticeLedger): DeliveryDecision {
  const { kind } = notice;
  if (ledger.dayCount >= MAX_PER_RECIPIENT_PER_DAY) {
    return refuse(
      `daily notice limit reached for this person: ${ledger.dayCount} of ${MAX_PER_RECIPIENT_PER_DAY} in 24h`,
    );
  }
  if (notice.scope.type === "calendar" && ledger.unboundDayCount >= MAX_UNBOUND_PER_RECIPIENT_PER_DAY) {
    return refuse(
      `daily limit for pre-meeting notices reached: ${ledger.unboundDayCount} of ${MAX_UNBOUND_PER_RECIPIENT_PER_DAY} in 24h`,
    );
  }
  if (ledger.totalCount >= MAX_PER_MEETING) {
    return refuse(
      `notice limit reached for this meeting: ${ledger.totalCount} of ${MAX_PER_MEETING} already sent — the bot must leave`,
    );
  }
  if (kind === "door_waiting") {
    const attempt = ledger.kindCount + 1;
    if (attempt > DOOR_MAX_ATTEMPTS) {
      return refuse(
        `door notice limit reached: one reminder only (${ledger.kindCount} already sent) — the bot must leave`,
      );
    }
    const last = attempt >= DOOR_MAX_ATTEMPTS;
    return { allow: true, attempt, shouldLeave: last, nextReminderInSeconds: last ? null : DOOR_REPEAT_SECONDS };
  }
  if (ledger.kindCount >= MAX_PER_KIND) {
    return refuse(`already notified about «${kind}» for this meeting — repeating it adds nothing`);
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
