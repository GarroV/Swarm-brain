/**
 * Одна встреча от заявки до выгрузки — то, что исполняет процесс внутри контейнера.
 *
 * Порядок задан контрактом notices и не переставляется: сначала `meeting-claim` (он даёт
 * `meeting_id`, к которому привязаны все встречные уведомления), потом заход в звонок.
 * Иначе у «стою у двери» не было бы встречи, к которой его привязать.
 *
 * Каждое состояние, где бот мог бы промолчать, кончается нотисой (принцип №1): не впустили,
 * капча, звук не пишется, записанное не ушло. Исключение ровно одно и намеренное — падение
 * самого процесса: тогда нет ни нотисы, ни финального heartbeat `recording: false`, и именно
 * замолчавший heartbeat с `recording: true` сообщает серверу, что запись оборвалась, а
 * оркестратор снаружи видит ненулевой код выхода.
 *
 * Все зависимости — параметры: браузер, сервер, ffmpeg и часы подменяются в тестах, поэтому
 * правила проверяются за миллисекунды, а не прогоном живой встречи.
 */
import type { AdmissionOutcome } from "../meet-adapter/types.ts";
import { AloneTimer } from "../meet-adapter/alone.ts";
import type { ClaimDecision, SpeakerSpan } from "../swarm-client/contract.ts";
import { SwarmHttpError } from "../swarm-client/errors.ts";
import { inBackground } from "./background.ts";
import type { Notice, NoticeResult, Notifier } from "./notices.ts";
import { describeError } from "./describe-error.ts";
import { BOT_PROFILE } from "./profile.ts";

/**
 * Адаптер площадки в том объёме, который нужен процессу встречи.
 */
interface MeetingAdapter {
  join(url: string, displayName: string): Promise<void>;
  waitAdmitted(timeoutMs: number): Promise<AdmissionOutcome>;
  /**
   * Тристатный опрос: `null` — сигнала об участниках нет (не путать с «один»).
   */
  aloneSignal(): Promise<boolean | null>;
  leave(): Promise<void>;
}

interface MeetingSession {
  claim(): Promise<ClaimDecision>;
  readonly id: string | null;
  /**
   * «Бот жив» по заявленной встрече. `recordedSeconds` — сколько записано к удару: сервер пишет
   * их в `recorded_seconds` встречи и продлевает лиз, и арбитраж `meeting-claim` сравнивает
   * претендента с настоящей записью бота, а не с 0 из заявки до захода (T155).
   */
  heartbeat(recordedSeconds: number): Promise<void>;
  finish(timeline: readonly SpeakerSpan[]): Promise<void>;
}

export interface MeetingRecorder {
  start(): Promise<void>;
  /**
   * Остановить запись и отдать в очередь всё, что ещё не отдано. Возвращает, сколько
   * частей ушло в очередь за всю запись.
   */
  stop(): Promise<number>;
}

interface TimelineCollector {
  start(): void;
  stop(): Promise<SpeakerSpan[]>;
}

export interface MeetingTiming {
  /**
   * Сколько стоять у двери до первой нотисы.
   */
  readonly doorWaitMs: number;
  /**
   * Сколько ждать после нотисы до следующей.
   */
  readonly doorRepeatMs: number;
  /**
   * Сколько нотис о двери, после чего бот уходит. Сервер держит тот же потолок сам.
   */
  readonly doorMaxNotices: number;
  /**
   * Один в звонке дольше этого — встреча кончилась.
   */
  readonly aloneMs: number;
  readonly heartbeatMs: number;
  /**
   * Шаг опроса: дверь, одиночество, сигнал остановки.
   */
  readonly pollMs: number;
}

const DEFAULT_TIMING: MeetingTiming = {
  doorWaitMs: BOT_PROFILE.door.waitMs,
  doorRepeatMs: BOT_PROFILE.door.repeatMs,
  doorMaxNotices: BOT_PROFILE.door.maxNotices,
  aloneMs: BOT_PROFILE.aloneMs,
  heartbeatMs: BOT_PROFILE.heartbeatMs,
  pollMs: BOT_PROFILE.pollMs,
};

export interface MeetingRunOptions {
  readonly joinUrl: string;
  readonly displayName: string;
  readonly adapter: MeetingAdapter;
  readonly session: MeetingSession;
  readonly recorder: MeetingRecorder;
  readonly timeline: TimelineCollector;
  readonly notifier: Notifier;
  /**
   * Heartbeat штатного конца: `recording: false`. Зовётся ТОЛЬКО на штатном пути. Называет
   * встречу (`meetingId`): пульс бота лежит в её строке (D018), и без встречи флаг записи там
   * остался бы `true` — сторож принял бы штатный конец за смерть контейнера. `null` — встреча
   * больше не наша (право ушло другой записи), и удар идёт только в строку агента.
   * `recordedSeconds` — вся длина записи для арбитража; `null` — записи не было, и заявленное
   * при claim не переписывается.
   */
  readonly finalHeartbeat: (
    meetingId: string | null,
    recordedSeconds: number | null,
  ) => Promise<void>;
  /**
   * Остановка снаружи: SIGTERM от оркестратора, оборванный поводок, потолок длительности.
   */
  readonly stop: AbortSignal;
  readonly timing?: Partial<MeetingTiming>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
  /**
   * Сообщить наружу `meeting_id`: оркестратор читает его из журнала, если контейнер умрёт.
   */
  readonly reportMeetingId?: (meetingId: string) => void;
}

export type MeetingOutcome =
  | "recorded"
  | "deferred"
  | "join_failed"
  | "door_denied"
  | "door_blocked"
  | "meeting_unavailable"
  | "account_signin_required"
  | "door_timeout"
  | "captcha"
  | "stopped_at_door"
  | "no_audio"
  | "nothing_recorded"
  | "upload_failed"
  | "superseded";

/**
 * Машинная причина отказа `meeting-heartbeat` «встреча не твоя» (`meeting-heartbeat/write.ts`).
 */
const NOT_CLAIM_OWNER = "not_claim_owner";

/**
 * Право транскрибации ушло другой записи (D019): сервер отбил удар по НАШЕЙ встрече с причиной
 * «не claim_owner». Её `meeting-claim` передал рекордеру человека — арбитраж счёл его запись
 * заметно полнее, или истёк лиз. Любой другой отказ (доверенность, сеть, 5xx, старый сервер без
 * причины) перехватом не считается: запись, выброшенная по ошибке, не возвращается.
 */
function isTakenOver(error: unknown): boolean {
  if (!(error instanceof SwarmHttpError) || error.status !== 403) return false;
  try {
    const body: unknown = JSON.parse(error.bodyText);
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { code?: unknown }).code === NOT_CLAIM_OWNER
    );
  } catch {
    return false;
  }
}

interface RunContext {
  readonly options: MeetingRunOptions;
  readonly timing: MeetingTiming;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly meetingId: string;
  /**
   * Взводится, когда сервер отбил heartbeat перехватом (`isTakenOver`).
   */
  readonly takenOver: { value: boolean };
  /**
   * Когда началась и когда остановилась запись (часы `now`); `null` — ещё нет.
   */
  readonly recording: { startedAt: number | null; stoppedAt: number | null };
}

/**
 * Сколько секунд записано к этому моменту; `null` — запись не начиналась. После остановки —
 * вся длина записи: запечатывание и выход из звонка в неё не входят.
 */
function recordedSeconds(context: RunContext): number | null {
  const { startedAt, stoppedAt } = context.recording;
  if (startedAt === null) return null;
  return Math.round(((stoppedAt ?? context.now()) - startedAt) / 1000);
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Отправить нотису. Сбой отправки — не повод молчать и не повод ронять встречу: он пишется в
 * журнал целиком, а вызывающий получает `null`.
 */
async function sendNotice(context: RunContext, notice: Notice): Promise<NoticeResult | null> {
  try {
    return await context.options.notifier.notify(notice);
  } catch (error) {
    context.log(`нотиса ${notice.kind} не отправлена: ${describeError(error)}`);
    return null;
  }
}

async function leaveQuietly(context: RunContext): Promise<void> {
  try {
    await context.options.adapter.leave();
  } catch (error) {
    context.log(`выход из звонка не удался: ${describeError(error)}`);
  }
}

/**
 * Ждать у двери до `totalMs`, но короткими отрезками: сигнал остановки не должен ждать
 * три минуты, пока адаптер досмотрит свой таймаут.
 */
async function waitDoor(
  context: RunContext,
  totalMs: number,
): Promise<AdmissionOutcome | "stopped"> {
  const deadline = context.now() + totalMs;
  while (!context.options.stop.aborted) {
    const left = deadline - context.now();
    if (left <= 0) return "timeout";
    const outcome = await context.options.adapter.waitAdmitted(
      Math.min(left, context.timing.pollMs),
    );
    if (outcome !== "timeout") return outcome;
  }
  return "stopped";
}

type DoorResult = "admitted" | Exclude<MeetingOutcome, "recorded">;

async function passDoor(context: RunContext): Promise<DoorResult> {
  const meetingId = context.meetingId;
  let outcome = await waitDoor(context, context.timing.doorWaitMs);
  let notices = 0;

  while (outcome === "timeout") {
    notices += 1;
    const result = await sendNotice(context, { kind: "door_waiting", meetingId });
    if (result?.shouldLeave === true || notices >= context.timing.doorMaxNotices) {
      context.log(`у двери после ${String(notices)} нотис — не впустили, выходим`);
      return "door_timeout";
    }
    outcome = await waitDoor(context, context.timing.doorRepeatMs);
  }

  switch (outcome) {
    case "admitted": {
      return "admitted";
    }
    case "denied": {
      await sendNotice(context, { kind: "door_denied", meetingId });
      return "door_denied";
    }
    case "blocked": {
      await sendNotice(context, { kind: "door_blocked", meetingId });
      return "door_blocked";
    }
    case "unavailable": {
      await sendNotice(context, { kind: "meeting_unavailable", meetingId });
      return "meeting_unavailable";
    }
    case "signin_required": {
      await sendNotice(context, { kind: "account_signin_required", meetingId });
      return "account_signin_required";
    }
    case "captcha": {
      await sendNotice(context, { kind: "captcha", meetingId });
      return "captcha";
    }
    case "stopped": {
      context.log("остановлены у двери — в звонок не зашли, записи нет");
      return "stopped_at_door";
    }
  }
}

/**
 * Сидеть в звонке, пока не останемся одни дольше порога или пока не остановят снаружи.
 */
async function stayInCall(context: RunContext): Promise<void> {
  const timer = new AloneTimer(context.timing.aloneMs);
  while (!context.options.stop.aborted) {
    if (context.takenOver.value) return;
    let alone: boolean | null;
    try {
      alone = await context.options.adapter.aloneSignal();
    } catch (error) {
      context.log(`опрос участников не удался: ${describeError(error)}`);
      alone = null;
    }
    if (timer.observe(alone, context.now())) {
      context.log(`один в звонке дольше ${String(context.timing.aloneMs)} мс — встреча кончилась`);
      return;
    }
    await context.sleep(context.timing.pollMs);
  }
  context.log("остановка снаружи — заканчиваем встречу штатно");
}

function startHeartbeat(context: RunContext): () => void {
  const beat = (): void => {
    inBackground(
      async () => context.options.session.heartbeat(recordedSeconds(context) ?? 0),
      (error) => {
        if (isTakenOver(error)) context.takenOver.value = true;
        context.log(`heartbeat не ушёл: ${describeError(error)}`);
      },
    );
  };
  beat();
  const timer = setInterval(beat, context.timing.heartbeatMs);
  return (): void => {
    clearInterval(timer);
  };
}

async function hand(
  context: RunContext,
  timeline: readonly SpeakerSpan[],
): Promise<MeetingOutcome> {
  try {
    await context.options.session.finish(timeline);
    return "recorded";
  } catch (error) {
    // Записанное лежит в очереди на диске и переживёт контейнер — но человек должен знать,
    // что до Swarm оно пока не дошло.
    await sendNotice(context, {
      kind: "recording_lost",
      meetingId: context.meetingId,
      detail: describeError(error),
    });
    return "upload_failed";
  }
}

async function record(context: RunContext): Promise<MeetingOutcome> {
  const { recorder, timeline } = context.options;
  try {
    await recorder.start();
  } catch (error) {
    await sendNotice(context, {
      kind: "no_audio",
      meetingId: context.meetingId,
      detail: describeError(error),
    });
    await leaveQuietly(context);
    return "no_audio";
  }

  context.recording.startedAt = context.now();
  timeline.start();
  const stopHeartbeat = startHeartbeat(context);
  try {
    await stayInCall(context);
  } finally {
    stopHeartbeat();
  }

  context.recording.stoppedAt = context.now();
  const spans = await timeline.stop();
  const parts = await recorder.stop();
  await leaveQuietly(context);

  if (context.takenOver.value) {
    // Выгрузка всё равно получила бы 403 (meeting-ingest пускает только claim_owner), а нотиса
    // «записанное не ушло» была бы ложной тревогой: встречу пишет другая, более полная запись.
    // Тот же исход, что defer на claim, только посреди встречи — поэтому и без нотисы.
    context.log(
      `право транскрибации ушло другой записи — выходим без выгрузки (${context.meetingId})`,
    );
    return "superseded";
  }

  if (parts === 0) {
    await sendNotice(context, {
      kind: "no_audio",
      meetingId: context.meetingId,
      detail: "ffmpeg не записал ни одной части",
    });
    return "nothing_recorded";
  }
  context.log(`записано частей: ${String(parts)}, интервалов говорящих: ${String(spans.length)}`);
  return hand(context, spans);
}

async function afterClaim(context: RunContext): Promise<MeetingOutcome> {
  const { options } = context;
  try {
    await options.adapter.join(options.joinUrl, options.displayName);
  } catch (error) {
    await sendNotice(context, {
      kind: "join_failed",
      meetingId: context.meetingId,
      detail: describeError(error),
    });
    await leaveQuietly(context);
    return "join_failed";
  }

  const door = await passDoor(context);
  if (door !== "admitted") {
    await leaveQuietly(context);
    return door;
  }
  return record(context);
}

/**
 * Провести встречу целиком. Исключение наружу — только непредвиденный сбой: его код выхода
 * оркестратор читает как смерть контейнера.
 */
export async function runMeeting(options: MeetingRunOptions): Promise<MeetingOutcome> {
  const timing = { ...DEFAULT_TIMING, ...options.timing };
  const log =
    options.log ??
    ((line: string): void => {
      console.log(`[meeting] ${line}`);
    });

  const decision = await options.session.claim();
  const meetingId = options.session.id;
  if (meetingId === null) throw new Error("claim прошёл, а meeting_id нет");
  options.reportMeetingId?.(meetingId);

  if (decision === "defer") {
    log(`claim: defer — встречу уже пишут полнее, в звонок не идём (${meetingId})`);
    return "deferred";
  }

  const context: RunContext = {
    options,
    timing,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? defaultSleep,
    log,
    meetingId,
    takenOver: { value: false },
    recording: { startedAt: null, stoppedAt: null },
  };
  const outcome = await afterClaim(context);
  try {
    await (context.takenOver.value
      ? options.finalHeartbeat(null, null)
      : options.finalHeartbeat(meetingId, recordedSeconds(context)));
  } catch (error) {
    log(`финальный heartbeat не ушёл: ${describeError(error)}`);
  }
  log(`встреча закончена: ${outcome}`);
  return outcome;
}
