import type { AgentIdentity } from "../_shared/agent-auth.ts";
import { claimLeaseUntil } from "../_shared/claim-lease.ts";

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
//
// Удар бота по своей встрече — ещё и заявка в арбитраж meeting-claim (T155): продлевает лиз права
// транскрибации и пишет, сколько секунд записано. Бот заявляется до захода в звонок с 0 секунд, и
// без этого любой рекордер с записью от 5 минут или любой claim после 30 минут отбирал у него
// встречу, хотя бот её пишет. Канал — heartbeat, а не повторный claim: удар уже идёт каждые
// 2 минуты с meeting_id, сверяет claim_owner условием той же UPDATE (после перехвата лиз новому
// владельцу не продлить), а claim одноразово гасит приглашение (D017), ходит в календарь (D016) и
// считает эмбеддинг — повторять его раз в 2 минуты нельзя.

export interface HeartbeatBody {
  recording?: unknown;
  version?: unknown;
  on_call?: unknown;
  meeting_key?: unknown;
  meeting_id?: unknown;
  recorded_seconds?: unknown;
}

export interface HeartbeatWrite {
  table: "allowed_users" | "service_agents" | "meetings";
  /** Все условия UPDATE — равенства, накладываются вместе. */
  match: Record<string, string | number>;
  patch: Record<string, unknown>;
  /** true — ноль обновлённых строк означает отказ: встреча не того, кто пришёл. */
  requireHit: boolean;
  /**
   * Монотонность: UPDATE проходит, только если в колонке пусто или значение старше `value`.
   * Два удара, обрабатываемые одновременно, коммитятся в любом порядке; без условия опоздавший
   * `recording:true` перетёр бы более свежий `recording:false` и взвёл сторожа на закончившейся
   * встрече. Промах по этому условию при совпавшем владении — не отказ, а опоздавший удар.
   */
  newerThan?: { column: string; value: string };
}

/** Машинная причина 403 «встреча не твоя»: бот по ней понимает, что право ушло (D019). */
export const NOT_CLAIM_OWNER = "not_claim_owner";

/** Отказ, который index.ts отдаёт клиенту как есть. */
export class HeartbeatRejected extends Error {
  constructor(public readonly status: 400 | 403, message: string) {
    super(message);
    this.name = "HeartbeatRejected";
  }
}

/**
 * Потолок записанных секунд в ударе — сутки. Завышенное значение навсегда закрыло бы встречу от
 * перехвата более полной записью, поэтому явно невозможное отбивается, а не пишется.
 */
export const MAX_RECORDED_SECONDS = 86_400;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Встречи в записях нет — null; есть, но не uuid — отказ (иначе 500 из Postgres). */
function readMeetingId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    throw new HeartbeatRejected(400, "meeting_id must be a uuid");
  }
  return raw;
}

/** Секунд в ударе нет — undefined (записанное не трогаем); есть, но негодные — отказ. */
function readRecordedSeconds(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_RECORDED_SECONDS) {
    throw new HeartbeatRejected(
      400,
      `recorded_seconds must be a number from 0 to ${MAX_RECORDED_SECONDS}`,
    );
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
  // Условие свежести и здесь: два удара разных сборок, перемешавшись, иначе оставили бы
  // last_version и last_seen_at от опоздавшего. Промах по нему — просто пропуск (requireHit=false).
  const agentRow: HeartbeatWrite = {
    table: "service_agents",
    match: { id: identity.agentId },
    patch: { last_seen_at: nowIso, last_version: version },
    requireHit: false,
    newerThan: { column: "last_seen_at", value: nowIso },
  };
  if (meetingId === null) return [agentRow];
  if (!identity.groupId) {
    throw new HeartbeatRejected(403, "agent has no workspace");
  }
  const recordedSeconds = readRecordedSeconds(body.recorded_seconds);
  // Встреча первой: отказ по ней не должен успеть освежить строку агента.
  return [{
    table: "meetings",
    match: {
      id: meetingId,
      group_id: identity.groupId,
      claim_owner: identity.telegramId,
    },
    patch: {
      agent_last_seen_at: nowIso,
      agent_last_recording: recording,
      lease_expires_at: claimLeaseUntil(nowIso),
      ...(recordedSeconds !== undefined && { recorded_seconds: recordedSeconds }),
    },
    requireHit: true,
    newerThan: { column: "agent_last_seen_at", value: nowIso },
  }, agentRow];
}

export function buildHeartbeatWrites(
  identity: AgentIdentity,
  body: HeartbeatBody,
  nowIso: string,
): HeartbeatWrite[] {
  const recording = body.recording === true;
  const version = typeof body.version === "number" ? body.version : null;
  if (identity.kind === "bot") {
    return agentWrites(identity, body, nowIso, recording, version);
  }

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

/** Чем кончилась запись удара: всё легло / встреча не того, кто пришёл / удар опоздал. */
export type WriteOutcome = "ok" | "missed" | "stale";

/**
 * Где лежат таблицы. Ошибка базы — исключение: index.ts отвечает на него 500.
 */
export interface WriteStore {
  /** UPDATE по всем равенствам `match` и условию `newerThan`; сколько строк обновлено. */
  update(write: HeartbeatWrite): Promise<number>;
  /** Сколько строк совпадает с `match` без условия свежести. */
  count(write: HeartbeatWrite): Promise<number>;
}

/**
 * Разложить удар по таблицам по порядку. Отказ по встрече останавливает удар до строки агента:
 * чужая встреча не должна освежать агента, а опоздавший удар — возвращать строке агента свою,
 * более старую сборку (строку освежил тот, более поздний).
 */
export async function applyWrites(writes: HeartbeatWrite[], store: WriteStore): Promise<WriteOutcome> {
  for (const write of writes) {
    const hit = await store.update(write);
    if (!write.requireHit || hit > 0) continue;
    if (!write.newerThan) return "missed";
    // Промах при условии свежести: встреча либо не того, кто пришёл, либо удар опоздал.
    return (await store.count(write)) > 0 ? "stale" : "missed";
  }
  return "ok";
}
