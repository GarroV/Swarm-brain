import type { AgentIdentity } from "../_shared/agent-auth.ts";

// Куда именно ложится heartbeat. Вынесено чистой функцией не ради красоты: разница между
// «рекордер человека жив» и «служебный агент жив», а для агента ещё и «по какой встрече и его ли
// это встреча» — единственное, что удерживает сторожей swarm-bot от ложного вывода, и проверять
// это на живом Deno.serve нечем.
//
// Три адресата:
//   • allowed_users.recorder_last_* — рекордер человека (bumblebee), как было всегда;
//   • meetings.agent_last_*         — бот по встрече (D018): у каждой встречи своя тишина, и живой
//                                     контейнер на одной встрече не прячет замолчавший на другой;
//   • service_agents.last_*         — бот вообще: жив ли и какая сборка работает.
// Владение встречей сверяется условиями самой UPDATE (воркспейс агента + claim_owner = человек из
// X-On-Behalf-Of); ни одной совпавшей строки — отказ. Агент не может освежить чужую встречу и тем
// погасить её сторожа.

export interface HeartbeatBody {
  recording?: unknown;
  version?: unknown;
  on_call?: unknown;
  meeting_key?: unknown;
  meeting_id?: unknown;
}

export interface HeartbeatWrite {
  table: "allowed_users" | "service_agents" | "meetings";
  /** Все условия UPDATE — равенства, накладываются вместе. */
  match: Record<string, string | number>;
  patch: Record<string, unknown>;
  /** true — ноль обновлённых строк означает отказ: встреча не того, кто пришёл. */
  requireHit: boolean;
}

/** Отказ, который index.ts отдаёт клиенту как есть. */
export class HeartbeatRejected extends Error {
  constructor(public readonly status: 400 | 403, message: string) {
    super(message);
    this.name = "HeartbeatRejected";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Встречи в записях нет — null; есть, но не uuid — отказ (иначе 500 из Postgres). */
function readMeetingId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    throw new HeartbeatRejected(400, "meeting_id must be a uuid");
  }
  return raw;
}

function agentWrites(
  identity: AgentIdentity,
  body: HeartbeatBody,
  nowIso: string,
  recording: boolean,
  version: number | null,
): HeartbeatWrite[] {
  if (!identity.agentId) {
    // Тихо записать такое некуда, а записать в allowed_users — ровно та ошибка, от которой
    // здесь стоит развилка. Значит, громко.
    throw new Error("heartbeat: identity.kind=bot без agentId — некуда писать");
  }
  const meetingId = readMeetingId(body.meeting_id);
  if (recording && meetingId === null) {
    // Запись без встречи сторож не увидит: обрыв такой записи прошёл бы молча.
    throw new HeartbeatRejected(400, "meeting_id is required while recording");
  }
  // on_call у агента нет: он сам и есть участник звонка. Ключ встречи ему больше не нужен —
  // встречу называет meeting_id, а не ключ, общий у ручных встреч.
  const agentRow: HeartbeatWrite = {
    table: "service_agents",
    match: { id: identity.agentId },
    patch: { last_seen_at: nowIso, last_version: version },
    requireHit: false,
  };
  if (meetingId === null) return [agentRow];
  if (!identity.groupId) {
    throw new HeartbeatRejected(403, "agent has no workspace");
  }
  // Встреча первой: отказ по ней не должен успеть освежить строку агента.
  return [{
    table: "meetings",
    match: { id: meetingId, group_id: identity.groupId, claim_owner: identity.telegramId },
    patch: { agent_last_seen_at: nowIso, agent_last_recording: recording },
    requireHit: true,
  }, agentRow];
}

export function buildHeartbeatWrites(
  identity: AgentIdentity,
  body: HeartbeatBody,
  nowIso: string,
): HeartbeatWrite[] {
  const recording = body.recording === true;
  const version = typeof body.version === "number" ? body.version : null;
  if (identity.kind === "bot") return agentWrites(identity, body, nowIso, recording, version);

  const onCall = body.on_call === true;
  const rawKey = typeof body.meeting_key === "string" ? body.meeting_key.trim() : "";
  // Ключ держим только пока человек в звонке (или мы пишем). Иначе он завис бы после
  // созвона и панель показывала бы ON AIR на давно закончившейся встрече.
  const meetingKey = (onCall || recording) && rawKey ? rawKey : null;
  return [{
    table: "allowed_users",
    match: { telegram_id: identity.telegramId },
    patch: {
      recorder_last_seen: nowIso,
      recorder_last_recording: recording,
      recorder_last_version: version,
      recorder_last_on_call: onCall,
      recorder_last_meeting_key: meetingKey,
    },
    requireHit: false,
  }];
}
