// Приглашение бота на созвон из веба (решение D017): «вставь ссылку — бот постучится».
// Чистая часть: разбор ответа swarm-api, статусы и тексты ошибок. Без сети и без React —
// экран (`components/roy/InviteBotCard.tsx`) только рисует то, что здесь решено.
//
// Контракт — docs/ARCHITECTURE.md «Приглашение бота (D017)»:
//   POST /meeting-invites {join_url} → 201/200 { invite } · 400 invalid_link · 403 demo_not_allowed
//                                     · 429 too_many_invites
//   GET  /meeting-invites/:id        → 200 { invite } · 404 not_found

export type InviteStatus = "pending" | "taken" | "used" | "expired";
export type InvitePlatform = "meet" | "kontur" | "zoom";

export interface MeetingInvite {
  id: string;
  join_url: string;
  platform: InvitePlatform;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
  meeting_id: string | null;
}

export type InviteErrorCode = "invalid_link" | "demo_not_allowed" | "too_many_invites" | "not_found";

const STATUSES: readonly InviteStatus[] = ["pending", "taken", "used", "expired"];
const PLATFORMS: readonly InvitePlatform[] = ["meet", "kontur", "zoom"];
const ERROR_CODES: readonly InviteErrorCode[] = ["invalid_link", "demo_not_allowed", "too_many_invites", "not_found"];

/** Сколько приглашений экран помнит между заходами (сервер держит не больше 3 живых). */
export const REMEMBERED_INVITES = 3;
/** Как часто переспрашивать статус, пока бот не пришёл. */
export const INVITE_POLL_MS = 5000;

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Ответ сервера `{ invite }` → приглашение или null, если форма не та. Ответ — внешние
 * данные: неизвестный статус нельзя молча показать как «ждёт бота».
 */
export function parseInviteResponse(body: unknown): MeetingInvite | null {
  if (!body || typeof body !== "object") return null;
  const inv = (body as { invite?: unknown }).invite;
  if (!inv || typeof inv !== "object") return null;
  const r = inv as Record<string, unknown>;
  if (!isString(r.id) || !isString(r.join_url) || !isString(r.created_at) || !isString(r.expires_at)) return null;
  if (!STATUSES.includes(r.status as InviteStatus)) return null;
  if (!PLATFORMS.includes(r.platform as InvitePlatform)) return null;
  if (r.meeting_id !== null && r.meeting_id !== undefined && !isString(r.meeting_id)) return null;
  return {
    id: r.id,
    join_url: r.join_url,
    platform: r.platform as InvitePlatform,
    status: r.status as InviteStatus,
    created_at: r.created_at,
    expires_at: r.expires_at,
    meeting_id: (r.meeting_id as string | null | undefined) ?? null,
  };
}

/** Код ошибки из тела `{error, error_ru, code}`; незнакомый код — null (покажем общий текст). */
export function parseInviteErrorCode(body: unknown): InviteErrorCode | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return ERROR_CODES.includes(code as InviteErrorCode) ? (code as InviteErrorCode) : null;
}

/** Статус больше не изменится: переспрашивать сервер незачем. */
export function isFinalStatus(status: InviteStatus): boolean {
  return status === "used" || status === "expired";
}

/** Свежее приглашение наверх, тот же id не дублируется, помним не больше `REMEMBERED_INVITES`. */
export function upsertInvite(list: readonly MeetingInvite[], invite: MeetingInvite): MeetingInvite[] {
  return [invite, ...list.filter((x) => x.id !== invite.id)].slice(0, REMEMBERED_INVITES);
}

type Dt = (ru: string, en: string) => string;

export function inviteStatusLabel(status: InviteStatus, dt: Dt): string {
  switch (status) {
    case "pending":
      return dt("Ждёт бота", "Waiting for the bot");
    case "taken":
      return dt("Бот стучится в звонок", "The bot is knocking");
    case "used":
      return dt("Бот записывает", "The bot is recording");
    case "expired":
      return dt("Истекло — бот не пришёл", "Expired — the bot did not come");
  }
}

export function inviteErrorText(code: InviteErrorCode | null, dt: Dt): string {
  switch (code) {
    case "invalid_link":
      return dt("Вставьте ссылку на звонок Google Meet, Контур.Толк или Zoom", "Paste a link to a Google Meet, Kontur.Talk or Zoom call");
    case "demo_not_allowed":
      return dt("В демо бота позвать нельзя", "The bot cannot be invited from the demo");
    case "too_many_invites":
      return dt(
        "У вас уже 3 приглашения ждут бота — дождитесь его или повторите через несколько минут",
        "You already have 3 invites waiting — wait for the bot or try again in a few minutes",
      );
    case "not_found":
      return dt("Приглашение не найдено", "Invite not found");
    default:
      return dt("Не удалось позвать бота — попробуйте ещё раз", "Could not invite the bot — try again");
  }
}

export function invitePlatformLabel(platform: InvitePlatform): string {
  if (platform === "meet") return "Google Meet";
  if (platform === "kontur") return "Kontur.Talk";
  return "Zoom";
}
