import type { AdmissionOutcome } from "../src/meet-adapter/types.ts";
import type { ClaimDecision, SpeakerSpan } from "../src/swarm-client/contract.ts";
import { SwarmHttpError } from "../src/swarm-client/errors.ts";
import type { Notice, NoticeResult } from "../src/orchestrator/notices.ts";
import type { MeetingRunOptions } from "../src/orchestrator/run-meeting.ts";

interface World {
  readonly calls: string[];
  readonly notices: Notice[];
  /**
   * Какую встречу назвал каждый финальный heartbeat (`null` — без встречи).
   */
  readonly finals: (string | null)[];
  /**
   * Сколько записанных секунд сообщил каждый удар (`heartbeat`) — для арбитража meeting-claim.
   */
  readonly beats: number[];
  /**
   * Сколько секунд назвал каждый финальный heartbeat (`null` — записи не было).
   */
  readonly finalSeconds: (number | null)[];
  now: number;
  /**
   * Часы теста в момент каждого вызова `join`.
   */
  readonly joinedAt: number[];
  readonly options: MeetingRunOptions;
  readonly stop: AbortController;
}

export interface Script {
  readonly decision?: ClaimDecision;
  /**
   * Что отвечает дверь на каждый опрос; последний ответ повторяется.
   */
  readonly door?: readonly AdmissionOutcome[];
  /**
   * Что отвечает «один ли бот» на каждый опрос; последний ответ повторяется.
   */
  readonly alone?: readonly (boolean | null)[];
  readonly partsRecorded?: number;
  readonly joinError?: Error;
  /**
   * Что отвечает заход на каждую попытку по порядку (`null` — успех); последний ответ повторяется.
   * Перекрывает `joinError`.
   */
  readonly joinErrors?: readonly (Error | null)[];
  readonly recorderError?: Error;
  readonly finishError?: Error;
  readonly shouldLeaveOnNotice?: boolean;
  /**
   * Комната Толка закрыта для гостей: заход зовёт хук `onGuestRoomClosed` до своего завершения,
   * как это делает адаптер, пока ждёт открытия.
   */
  readonly guestRoomClosedOnJoin?: boolean;
  readonly stopAfterPolls?: number;
  readonly heartbeatError?: Error;
}

export const TIMING = {
  doorWaitMs: 90_000,
  doorRepeatMs: 180_000,
  doorMaxNotices: 2,
  aloneMs: 120_000,
  heartbeatMs: 3_600_000,
  pollMs: 5000,
};

export function build(script: Script = {}): World {
  const calls: string[] = [];
  const notices: Notice[] = [];
  const finals: (string | null)[] = [];
  const beats: number[] = [];
  const finalSeconds: (number | null)[] = [];
  const stop = new AbortController();
  const door = script.door ?? ["admitted"];
  const alone = script.alone ?? [true];
  let doorPolls = 0;
  let alonePolls = 0;
  let joinAttempts = 0;

  const world: World = {
    calls,
    notices,
    finals,
    beats,
    finalSeconds,
    now: 0,
    joinedAt: [],
    stop,
    options: {
      joinUrl: "https://meet.google.com/abc-defg-hij",
      displayName: "scriba",
      stop: stop.signal,
      timing: TIMING,
      now: () => world.now,
      sleep: (ms) => {
        world.now += ms;
        return Promise.resolve();
      },
      log: (): void => {
        // журнал процесса встречи в тестах не нужен
      },
      reportMeetingId: (id) => {
        calls.push(`report:${id}`);
      },
      adapter: {
        join: async (url, _displayName, hooks) => {
          calls.push(`join:${url}`);
          if (script.guestRoomClosedOnJoin === true) await hooks?.onGuestRoomClosed?.();
          world.joinedAt.push(world.now);
          const scripted = script.joinErrors;
          const failure =
            scripted === undefined
              ? (script.joinError ?? null)
              : (scripted[Math.min(joinAttempts, scripted.length - 1)] ?? null);
          joinAttempts += 1;
          return failure ? Promise.reject(failure) : Promise.resolve();
        },
        waitAdmitted: (timeoutMs) => {
          const answer = door[Math.min(doorPolls, door.length - 1)] ?? "timeout";
          doorPolls += 1;
          if (answer === "timeout") world.now += timeoutMs;
          if (script.stopAfterPolls !== undefined && doorPolls >= script.stopAfterPolls) {
            stop.abort();
          }
          return Promise.resolve(answer);
        },
        aloneSignal: () => {
          const answer = alone[Math.min(alonePolls, alone.length - 1)] ?? null;
          alonePolls += 1;
          if (script.stopAfterPolls !== undefined && alonePolls >= script.stopAfterPolls) {
            stop.abort();
          }
          return Promise.resolve(answer);
        },
        leave: () => {
          calls.push("leave");
          return Promise.resolve();
        },
      },
      session: {
        id: "m-1",
        claim: () => {
          calls.push("claim");
          return Promise.resolve(script.decision ?? "transcribe");
        },
        heartbeat: (recordedSeconds) => {
          calls.push("heartbeat");
          beats.push(recordedSeconds);
          return script.heartbeatError ? Promise.reject(script.heartbeatError) : Promise.resolve();
        },
        finish: (timeline: readonly SpeakerSpan[]) => {
          calls.push(`finish:${String(timeline.length)}`);
          return script.finishError ? Promise.reject(script.finishError) : Promise.resolve();
        },
      },
      recorder: {
        start: () => {
          calls.push("record:start");
          return script.recorderError ? Promise.reject(script.recorderError) : Promise.resolve();
        },
        stop: () => {
          calls.push("record:stop");
          return Promise.resolve(script.partsRecorded ?? 3);
        },
      },
      timeline: {
        start: () => {
          calls.push("timeline:start");
        },
        stop: () => Promise.resolve([{ start: 0, end: 5, name: "Анна" }]),
      },
      notifier: {
        notify: (notice: Notice): Promise<NoticeResult> => {
          notices.push(notice);
          return Promise.resolve({
            delivered: true,
            shouldLeave: script.shouldLeaveOnNotice ?? false,
          });
        },
      },
      finalHeartbeat: (meetingId, recordedSeconds) => {
        calls.push("heartbeat:final");
        finals.push(meetingId);
        finalSeconds.push(recordedSeconds);
        return Promise.resolve();
      },
    },
  };
  return world;
}

export const kinds = (world: World): string[] => world.notices.map((notice) => notice.kind);

export function refusal(body: unknown): SwarmHttpError {
  return new SwarmHttpError(403, typeof body === "string" ? body : JSON.stringify(body));
}
