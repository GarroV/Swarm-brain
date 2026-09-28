// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Пропуск бота на одну встречу (T165, решения D017/D021, таблица meeting_agent_grants).
//
// Токен служебного агента общий на воркспейс, поэтому за человека сам по себе не действует. За
// человека бот ходит по пропуску, а пропуск сервер выдаёт только там, где у него есть основание:
// оркестратор забрал приглашение человека (D017) или задание автозапуска по его календарю (D021).
// Пропуск несёт всё, что сервер знает сам: за кого, какое основание, какой ключ встречи, какое
// название. Первая заявка привязывает его к строке встречи — дальше он открывает только её.
//
// Вход по пропуску — _shared/agent-auth.ts (resolveActingIdentity): личность и пропуск приходят в
// дверь вместе, и каждая дверь сверяет встречу запроса с пропуском через assertGrantMeeting.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Сколько живёт пропуск. Встреча бота длится не дольше SCRIBA_MAX_MEETING_MINUTES (240 мин), после
 * неё — досылка частей. Шесть часов покрывают и то и другое; дольше пропуску жить незачем.
 */
export const GRANT_TTL_MS = 6 * 60 * 60_000;

/** Префикс пропуска: по нему человек в логах отличает пропуск от токена агента. */
const GRANT_PREFIX = "sgr_";

/** Что пропуск разрешает — то, что сервер знает сам, без слов бота. */
export interface AgentGrant {
  id: string;
  agentId: string;
  basis: "invite" | "calendar";
  /** Приглашение (D017) — у пропуска по приглашению. */
  inviteId: string | null;
  /** Ключ события календаря — у пропуска по заданию автозапуска. */
  calendarKey: string | null;
  joinUrl: string;
  /** Название события календаря; у приглашения названия нет. */
  title: string | null;
  /** Строка встречи после первой заявки. */
  meetingId: string | null;
}

/** Основание для выдачи: что забрал оркестратор. */
export type GrantBasis =
  & { agentId: string; groupId: string; telegramId: number; joinUrl: string }
  & (
    | { inviteId: string }
    | { calendarJobId: string; calendarKey: string; title: string | null }
  );

/** Пропуск не открывает эту встречу или эту заявку. */
export class GrantScopeError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "GrantScopeError";
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function newGrantToken(): string {
  return `${GRANT_PREFIX}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Строка таблицы по основанию. Чистая — чтобы форма выдачи проверялась без базы. */
export function grantRow(basis: GrantBasis, tokenHash: string, nowMs: number): Record<string, unknown> {
  const common = {
    token_hash: tokenHash,
    agent_id: basis.agentId,
    group_id: basis.groupId,
    telegram_id: basis.telegramId,
    join_url: basis.joinUrl,
    expires_at: new Date(nowMs + GRANT_TTL_MS).toISOString(),
  };
  if ("inviteId" in basis) return { ...common, invite_id: basis.inviteId };
  return {
    ...common,
    calendar_job_id: basis.calendarJobId,
    calendar_key: basis.calendarKey,
    title: basis.title,
  };
}

/**
 * Выдать пропуска по забранным основаниям. Возвращает пропуска в том же порядке. Сбой вставки —
 * исключение: основание без пропуска бесполезно боту, и вызывающий обязан вернуть его в очередь.
 */
export async function mintGrants(
  supabase: SupabaseClient,
  bases: readonly GrantBasis[],
  nowMs: number,
): Promise<string[]> {
  if (bases.length === 0) return [];
  const tokens = bases.map(() => newGrantToken());
  const rows = await Promise.all(bases.map(async (b, i) => grantRow(b, await sha256Hex(tokens[i]), nowMs)));
  const { error } = await supabase.from("meeting_agent_grants").insert(rows);
  if (error) throw new Error(`meeting_agent_grants insert: ${error.message}`);
  return tokens;
}

/** Пропуск из личности; у людей его нет — им сверять нечего. */
function grantOf(identity: { kind: string; grant?: AgentGrant }): AgentGrant | null {
  if (identity.kind !== "bot") return null;
  // Бот без пропуска сюда не доходит (agent-auth.ts), но дверь не полагается на порядок вызовов.
  if (!identity.grant) throw new GrantScopeError("service agent: this request needs a meeting grant");
  return identity.grant;
}

const OTHER_MEETING = "service agent: the grant does not cover this meeting";

/**
 * Дверь по встрече (heartbeat, выгрузка, статус, уведомление): бот — только по встрече своего
 * пропуска. Пропуск без заявки не открывает ни одной строки: встречу ему назначает meeting-claim.
 */
export function assertGrantMeeting(identity: { kind: string; grant?: AgentGrant }, meetingId: string): void {
  const grant = grantOf(identity);
  if (grant === null) return;
  if (grant.meetingId === null || grant.meetingId !== meetingId.toLowerCase()) {
    console.warn(`agent-grant: пропуск ${grant.id} (встреча ${grant.meetingId ?? "—"}) просил встречу ${meetingId}`);
    throw new GrantScopeError(OTHER_MEETING);
  }
}

/** Встречи, которые пропуск открывает (статус по списку id). Людям — все свои. */
export function grantMeetingFilter(identity: { kind: string; grant?: AgentGrant }): string[] | null {
  const grant = grantOf(identity);
  if (grant === null) return null;
  return grant.meetingId === null ? [] : [grant.meetingId];
}

/**
 * Заявка бота (meeting-claim): тип встречи по форме ключа уже определён сервером. Пропуск по
 * приглашению открывает только ручную встречу этого приглашения, пропуск по заданию — только
 * календарную встречу своего события. Комнатной встречи у бота нет: основания на неё сервер не
 * выдаёт (D017).
 */
export function assertGrantClaim(
  identity: { kind: string; grant?: AgentGrant },
  shape: "calendar" | "room" | "manual",
  body: { identity_key: string; invite_id?: unknown },
): void {
  const grant = grantOf(identity);
  if (grant === null) return;
  const allowed = shape === "calendar"
    ? grant.basis === "calendar" && grant.calendarKey === body.identity_key
    : shape === "manual"
    ? grant.basis === "invite" && typeof body.invite_id === "string" && body.invite_id === grant.inviteId
    : false;
  if (!allowed) {
    console.warn(`agent-grant: пропуск ${grant.id} (${grant.basis}) не открывает заявку ${shape} ${body.identity_key}`);
    throw new GrantScopeError("service agent: the grant does not cover this meeting");
  }
}

/**
 * Привязать пропуск к встрече первой заявки. Уже привязан к этой — ничего не делать; к другой —
 * отказ. Привязка — условный UPDATE: две одновременные заявки по одному пропуску не разведут его
 * на две встречи.
 */
export async function bindGrantMeeting(
  supabase: SupabaseClient,
  identity: { kind: string; grant?: AgentGrant },
  meetingId: string,
): Promise<void> {
  const grant = grantOf(identity);
  if (grant === null) return;
  if (grant.meetingId === meetingId) return;
  if (grant.meetingId !== null) throw new GrantScopeError(OTHER_MEETING);
  const { data, error } = await supabase.from("meeting_agent_grants")
    .update({ meeting_id: meetingId })
    .eq("id", grant.id)
    .is("meeting_id", null)
    .select("id");
  if (error) throw new Error(`meeting_agent_grants bind: ${error.message}`);
  if ((data ?? []).length === 1) return;
  const { data: row } = await supabase.from("meeting_agent_grants").select("meeting_id").eq("id", grant.id)
    .maybeSingle();
  if ((row as { meeting_id?: string | null } | null)?.meeting_id !== meetingId) {
    throw new GrantScopeError(OTHER_MEETING);
  }
}
