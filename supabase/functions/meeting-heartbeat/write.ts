import type { AgentIdentity } from "../_shared/agent-auth.ts";
import { CHALLENGER_ROLE } from "../meeting-ingest/challenge.ts";
import { assertGrantMeeting, GrantScopeError } from "../_shared/agent-grant.ts";
import { CLAIM_LEASE_TTL_SEC, claimLeaseUntil, MAX_RECORDED_SECONDS } from "../_shared/meeting-lease.ts";

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
//
// Ограничения права (T157, разбор прав T155): лиз продлевает только удар recording:true — живой
// контейнер, который уже не пишет, не держит встречу; секунды пишутся только в большую сторону
// (`recorded_seconds` встречи = самая полная из записей её владельца, иначе удар бота после
// «запасной» записи рекордера того же человека занизил бы её) и растут не быстрее прошедшего
// времени с запасом `RECORDED_GROWTH_FACTOR` — скачок до суток от агента с ошибкой единиц или
// с украденным токеном навсегда закрыл бы встречу от более полной записи.

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
  /**
   * Только вверх: UPDATE проходит, если в колонке пусто или значение меньше `value`. Промах —
   * не отказ (записано уже больше).
   */
  below?: { column: string; value: number };
  /** У записи встречи: сколько секунд прислал удар. Кладётся в ту же запись (`planWrites`). */
  reportedSeconds?: number;
  /**
   * Что писать, если эта запись не легла ни в одну строку: запись встречи без секунд. Нужна записи
   * «встреча + секунды»: её промах по `below` (записано уже больше) не отказ и не опоздание —
   * сам удар всё равно должен лечь.
   */
  fallback?: HeartbeatWrite;
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

/** Потолок записанных секунд в ударе — общий с claim (_shared/meeting-lease.ts). */
export { MAX_RECORDED_SECONDS };

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
  // Встреча — только та, которую открыл пропуск бота (T165): отметка «пишу» держит встречу за
  // ботом (D020), поэтому сверка идёт до любой записи, а не одним условием владельца.
  try {
    assertGrantMeeting(identity, meetingId);
  } catch (e) {
    if (e instanceof GrantScopeError) throw new HeartbeatRejected(403, e.message);
    throw e;
  }
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
      // Лиз — только пока бот пишет: иначе агент, держащий контейнер в звонке без записи, держал
      // бы и встречу — ни рекордер, ни claim после истечения её бы не заняли.
      ...(recording && { lease_expires_at: claimLeaseUntil(nowIso) }),
    },
    requireHit: true,
    newerThan: { column: "agent_last_seen_at", value: nowIso },
    ...(recordedSeconds !== undefined && { reportedSeconds: recordedSeconds }),
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

/** Запас к прошедшему времени: на 10% быстрее часов сервера секунды расти не могут. */
export const RECORDED_GROWTH_FACTOR = 1.1;

/** Что было в строке встречи до удара — от этого отсчитывается, насколько могли вырасти секунды. */
export interface RecordedPrior {
  recorded_seconds: number | null;
  agent_last_seen_at: string | null;
  lease_expires_at: string | null;
}

/**
 * Сколько секунд удар вправе записать: прежние секунды плюс прошедшее время с запасом. Отсчёт — от
 * прошлого удара, а первого удара ещё не было — от выдачи лиза (claim бота: бот заявляется до
 * захода, так что его запись не старше лиза). Ни того, ни другого — роста нет.
 *
 * Отсчёт от прошлого удара, а не постоянный запас на каждый удар: запас «+N секунд за удар»
 * частые удары складывали бы без предела.
 */
export function recordedSecondsCeiling(prior: RecordedPrior, nowIso: string): number {
  const base = prior.recorded_seconds ?? 0;
  const anchorMs = prior.agent_last_seen_at !== null
    ? Date.parse(prior.agent_last_seen_at)
    : prior.lease_expires_at !== null
    ? Date.parse(prior.lease_expires_at) - CLAIM_LEASE_TTL_SEC * 1000
    : Number.NaN;
  if (!Number.isFinite(anchorMs)) return base;
  const elapsedSec = Math.max(0, (Date.parse(nowIso) - anchorMs) / 1000);
  return base + elapsedSec * RECORDED_GROWTH_FACTOR;
}

/**
 * Запись встречи вместе с секундами удара: присланное, урезанное потолком, и только вверх. null —
 * секунд писать нечего (прислано не больше, чем уже записано, или удар без секунд).
 *
 * Секунды и отметка удара (`agent_last_seen_at`, от которой считается потолок) меняются ОДНОЙ
 * UPDATE. Раздельными записями соседний удар, прочитавший строку между ними, видел бы новую отметку
 * при старых секундах — потолок от неё почти ноль, и свежий удар молча недописывал бы запись
 * бота. Вместе же любая прочитанная пара «секунды, отметка» — состояние после целого удара, и
 * параллельные удары не складывают рост: запись только вверх, а не прибавка.
 */
export function recordedSecondsWrite(
  meeting: HeartbeatWrite,
  prior: RecordedPrior,
  nowIso: string,
): HeartbeatWrite | null {
  if (meeting.reportedSeconds === undefined) return null;
  const value = Math.min(meeting.reportedSeconds, recordedSecondsCeiling(prior, nowIso));
  // Не больше записанного — писать нечего; ноль поверх пустого тоже не пишется: пусто у строки
  // старого клиента значит «оценить по стенограмме», и ноль отнял бы у неё эту оценку.
  if (value <= (prior.recorded_seconds ?? 0)) return null;
  const { reportedSeconds: _reported, ...plain } = meeting;
  return {
    ...plain,
    patch: { ...meeting.patch, recorded_seconds: value },
    below: { column: "recorded_seconds", value },
    fallback: plain,
  };
}

/**
 * Удар с секундами читает строку встречи ДО записи (потолок считается от прошлого удара, а запись
 * удара его перетрёт) и заменяет запись встречи записью «встреча + секунды».
 */
export async function planWrites(
  writes: HeartbeatWrite[],
  store: WriteStore,
  nowIso: string,
): Promise<HeartbeatWrite[]> {
  const at = writes.findIndex((w) => w.reportedSeconds !== undefined);
  if (at === -1) return writes;
  const prior = await store.read(writes[at]);
  const combined = prior === null ? null : recordedSecondsWrite(writes[at], prior, nowIso);
  if (combined === null) return writes;
  return [...writes.slice(0, at), combined, ...writes.slice(at + 1)];
}

/**
 * Условия `newerThan` и `below` записи одной строкой `or` для PostgREST («пусто или меньше»): два
 * `.or()` в одном запросе он не сложит, поэтому оба условия (запись встречи с секундами)
 * раскрываются в четыре `and`. Условий нет — null.
 */
export function freshnessFilter(write: HeartbeatWrite): string | null {
  const parts: string[][] = [];
  for (const c of [write.newerThan, write.below]) {
    if (c) parts.push([`${c.column}.is.null`, `${c.column}.lt.${c.value}`]);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].join(",");
  return parts[0].flatMap((x) => parts[1].map((y) => `and(${x},${y})`)).join(",");
}

/** Удар целиком: прочитать, что нужно для потолка секунд, и разложить по таблицам. */
export async function runHeartbeat(writes: HeartbeatWrite[], store: WriteStore, nowIso: string): Promise<WriteOutcome> {
  return applyWrites(await planWrites(writes, store, nowIso), store);
}

/** Чем кончилась запись удара: всё легло / встреча не того, кто пришёл / удар опоздал. */
export type WriteOutcome = "ok" | "missed" | "stale";

/**
 * Где лежат таблицы. Ошибка базы — исключение: index.ts отвечает на него 500.
 */
export interface WriteStore {
  /** UPDATE по всем равенствам `match` и условиям `newerThan` и `below` вместе; сколько строк обновлено. */
  update(write: HeartbeatWrite): Promise<number>;
  /** Секунды, прошлый удар и лиз строки встречи по `match`; нет строки — null. */
  read(write: HeartbeatWrite): Promise<RecordedPrior | null>;
  /** Сколько строк совпадает с `match` без условия свежести. */
  count(write: HeartbeatWrite): Promise<number>;
}

/**
 * Разложить удар по таблицам по порядку. Отказ по встрече останавливает удар до строки агента:
 * чужая встреча не должна освежать агента, а опоздавший удар — возвращать строке агента свою,
 * более старую сборку (строку освежил тот, более поздний).
 */
export async function applyWrites(writes: HeartbeatWrite[], store: WriteStore): Promise<WriteOutcome> {
  for (const planned of writes) {
    let write = planned;
    let hit = await store.update(write);
    if (hit === 0 && write.fallback) {
      write = write.fallback;
      hit = await store.update(write);
    }
    if (!write.requireHit || hit > 0) continue;
    if (!write.newerThan) return "missed";
    // Промах при условии свежести: встреча либо не того, кто пришёл, либо удар опоздал.
    return (await store.count(write)) > 0 ? "stale" : "missed";
  }
  return "ok";
}

/**
 * Бот-претендент (meeting-claim, `botJoinsOverShort`: бот пошёл поверх короткой готовой записи).
 * Встреча не его — claim_owner держателя, и удар по ней промахивается. Отвечать ему 403 нельзя: бот
 * прочтёт это как «право ушло другой записи» и уйдёт со звонка без выгрузки. Претендент встречу не
 * держит — лиз, пульс и секунды в строку встречи не пишутся (право решит измеренная выгрузка), —
 * но жив он сам: строка агента освежается. Претендент — только с ролью `challenger` в `recorders`
 * этой встречи у того же человека; пропуск бота к встрече уже сверен (`assertGrantMeeting`).
 */
export function challengerWrites(
  writes: HeartbeatWrite[],
  recorders: unknown,
  telegramId: number,
): HeartbeatWrite[] | null {
  const list = Array.isArray(recorders) ? recorders : [];
  const isChallenger = list.some((r) => r?.telegram_id === telegramId && r?.role === CHALLENGER_ROLE);
  if (!isChallenger) return null;
  return writes.filter((w) => w.table !== "meetings");
}

/**
 * Продлить заявку бота-претендента, пока он пишет. Выгрузку претендента meeting-ingest принимает,
 * только пока заявка свежая (`freshChallenge`: не старше лиза, 30 минут), а бот пишет встречу час
 * и дольше — без продления его выгрузка получила бы отказ и запись пропала. Продлевает только удар
 * `recording:true` того же человека; null — продлевать нечего.
 */
export function renewChallenge(recorders: unknown[], telegramId: number, nowIso: string): unknown[] | null {
  const at = recorders.findIndex((r) =>
    (r as { telegram_id?: unknown })?.telegram_id === telegramId &&
    (r as { role?: unknown })?.role === CHALLENGER_ROLE
  );
  if (at < 0) return null;
  return recorders.map((r, i) => i === at ? { ...(r as Record<string, unknown>), claimed_at: nowIso } : r);
}
