// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Приглашение бота на созвон (решение D017, как кнопка Read.ai «вставь ссылку — бот постучится»).
//
// Залогиненный человек вставляет в вебе ссылку на звонок — это и есть приглашение: сервер заводит
// одноразовую запись «кто позвал, на какую ссылку, до какого времени» (таблица meeting_invites).
// Оркестратор забирает её в работу, бот предъявляет её в meeting-claim. Ручную встречу служебный
// агент заводит ТОЛЬКО по такой записи: иначе украденный токен бота заводил бы человеку приватную
// запись встречи, куда его никто не звал, в обход календарной сверки D016.
//
// Здесь — чистые функции: разбор ссылки, сверка приглашения, статус. Хождение в базу — у
// вызывающих (swarm-api, meeting-invite, meeting-claim): так границы проверяются без базы.
import { type ConferencePlatform, conferencePlatform } from "../meeting-current/join-link.ts";

/**
 * Сколько живёт приглашение. Бот заявляется на встречу ДО того, как постучаться (номер встречи
 * нужен уведомлению «стою у двери»), так что от вставки ссылки до заявки проходит опрос
 * оркестратора и запуск контейнера — минута-две. Четверть часа — с запасом на это и достаточно
 * мало, чтобы забытое приглашение не открывало ручную встречу до вечера.
 */
export const INVITE_TTL_MS = 15 * 60_000;
export const MAX_INVITE_LINK_LENGTH = 2048;

export interface InviteLink {
  /** Ссылка в том виде, в каком её получит бот: без фрагмента и учётных данных. */
  url: string;
  platform: ConferencePlatform;
  /** Комната: хост + путь, нижний регистр, без завершающего слэша. По ней сверяется подмена. */
  room: string;
}

/** Разбирает вставленную человеком ссылку. `null` — не ссылка на звонок поддерживаемой площадки. */
export function parseInviteLink(raw: unknown): InviteLink | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || text.length > MAX_INVITE_LINK_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Учётные данные в ссылке — не звонок, а попытка что-то протащить; бот их не предъявляет.
  if (url.username !== "" || url.password !== "") return null;
  const platform = conferencePlatform(url.href);
  if (!platform) return null;

  const path = url.pathname.replace(/\/+$/, "");
  if (path === "") return null; // площадка без комнаты — звать бота некуда

  url.hash = "";
  return { url: url.href, platform, room: `${url.hostname}${path}`.toLowerCase() };
}

/** Одна ли это комната. Бот пинит язык (`?hl=en`), поэтому сверяются хост и путь, а не строка. */
export function sameRoom(a: unknown, b: unknown): boolean {
  const pa = parseInviteLink(a);
  const pb = parseInviteLink(b);
  return pa !== null && pb !== null && pa.room === pb.room;
}

/** Строка meeting_invites. */
export interface InviteRow {
  id: string;
  group_id: string;
  invited_by: number;
  join_url: string;
  platform: string;
  created_at: string;
  expires_at: string;
  taken_at: string | null;
  used_at: string | null;
  meeting_id: string | null;
}

export type InviteRefusal =
  | "not_found"
  | "other_person"
  | "other_workspace"
  | "expired"
  | "used"
  | "link_mismatch";

export type InviteVerdict = { ok: true } | { ok: false; reason: InviteRefusal };

/**
 * Годится ли приглашение для ручной встречи, которую агент заводит за человека `who`.
 *
 * Проверка ДО гашения: даёт внятную причину в лог. Само гашение — условный UPDATE у вызывающего
 * (used_at is null и срок не вышел), он и решает гонку двух одновременных заявок.
 */
export function checkInviteForClaim(
  invite: InviteRow | null,
  who: { telegramId: number; groupId: string | null },
  joinUrl: unknown,
  nowMs: number,
): InviteVerdict {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.group_id !== who.groupId) return { ok: false, reason: "other_workspace" };
  if (invite.invited_by !== who.telegramId) return { ok: false, reason: "other_person" };
  if (invite.used_at !== null) return { ok: false, reason: "used" };
  if (Date.parse(invite.expires_at) <= nowMs) return { ok: false, reason: "expired" };
  if (!sameRoom(invite.join_url, joinUrl)) return { ok: false, reason: "link_mismatch" };
  return { ok: true };
}

export type InviteStatus = "pending" | "taken" | "used" | "expired";

/** Статус для веба: ждёт оркестратора → забрано в работу → бот заявился на встречу; или истекло. */
export function inviteStatus(
  invite: Pick<InviteRow, "expires_at" | "taken_at" | "used_at">,
  nowMs: number,
): InviteStatus {
  if (invite.used_at !== null) return "used";
  if (Date.parse(invite.expires_at) <= nowMs) return "expired";
  return invite.taken_at !== null ? "taken" : "pending";
}
