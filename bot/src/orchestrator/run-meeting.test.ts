/**
 * Правила процесса встречи: порядок claim → заход, дверь с потолком нотис, ворота defer,
 * громкий отказ на каждом «мог бы промолчать», и ни одного `recording: false` на сбое.
 */
import { describe, expect, it, vi } from "vitest";

import type { AdmissionOutcome } from "../meet-adapter/types.ts";
import type { ClaimDecision, SpeakerSpan } from "../swarm-client/contract.ts";
import type { Notice, NoticeResult } from "./notices.ts";
import { type MeetingRunOptions, runMeeting } from "./run-meeting.ts";

interface World {
  readonly calls: string[];
  readonly notices: Notice[];
  now: number;
  readonly options: MeetingRunOptions;
  readonly stop: AbortController;
}

interface Script {
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
  readonly recorderError?: Error;
  readonly finishError?: Error;
  readonly shouldLeaveOnNotice?: boolean;
  readonly stopAfterPolls?: number;
}

const TIMING = {
  doorWaitMs: 90_000,
  doorRepeatMs: 180_000,
  doorMaxNotices: 2,
  aloneMs: 120_000,
  heartbeatMs: 3_600_000,
  pollMs: 5000,
};

function build(script: Script = {}): World {
  const calls: string[] = [];
  const notices: Notice[] = [];
  const stop = new AbortController();
  const door = script.door ?? ["admitted"];
  const alone = script.alone ?? [true];
  let doorPolls = 0;
  let alonePolls = 0;

  const world: World = {
    calls,
    notices,
    now: 0,
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
        join: (url) => {
          calls.push(`join:${url}`);
          return script.joinError ? Promise.reject(script.joinError) : Promise.resolve();
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
        heartbeat: () => {
          calls.push("heartbeat");
          return Promise.resolve();
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
      finalHeartbeat: () => {
        calls.push("heartbeat:final");
        return Promise.resolve();
      },
    },
  };
  return world;
}

const kinds = (world: World): string[] => world.notices.map((notice) => notice.kind);

describe("штатная встреча", () => {
  it("claim раньше захода: у встречных нотис обязан быть meeting_id", async () => {
    const world = build();

    await runMeeting(world.options);

    expect(world.calls.indexOf("claim")).toBeLessThan(
      world.calls.findIndex((call) => call.startsWith("join:")),
    );
    expect(world.calls).toContain("report:m-1");
  });

  it("впустили → пишем → одни две минуты → выходим и отдаём запись с таймлайном", async () => {
    const world = build({ alone: [false, false, true] });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("recorded");
    expect(world.calls).toEqual([
      "claim",
      "report:m-1",
      "join:https://meet.google.com/abc-defg-hij",
      "record:start",
      "timeline:start",
      "heartbeat",
      "record:stop",
      "leave",
      "finish:1",
      "heartbeat:final",
    ]);
    expect(world.notices).toEqual([]);
  });

  it("одни меньше порога — не уходим: встреча идёт дальше", async () => {
    // 5 опросов «один» по 5 с = 25 с < 120 с, потом снова люди, потом один до конца.
    const world = build({ alone: [true, true, true, true, true, false, true] });

    await runMeeting(world.options);

    // Ушли не раньше, чем через 120 с непрерывного одиночества после возвращения людей.
    expect(world.now).toBeGreaterThanOrEqual(30_000 + 120_000);
  });

  it("сигнала об участниках нет — не уходим по нему, а ждём остановки снаружи", async () => {
    const world = build({ alone: [null], stopAfterPolls: 100 });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("recorded");
    expect(world.now).toBeGreaterThanOrEqual(99 * 5000);
  });
});

describe("ворота defer", () => {
  it("defer → в звонок не идём, ничего не пишем, heartbeat не шлём", async () => {
    const world = build({ decision: "defer" });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("deferred");
    expect(world.calls).toEqual(["claim", "report:m-1"]);
  });
});

describe("дверь", () => {
  it("не впустили за 90 с → нотиса, ещё 180 с → вторая нотиса и выход", async () => {
    const world = build({ door: ["timeout"] });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("door_timeout");
    expect(kinds(world)).toEqual(["door_waiting", "door_waiting"]);
    expect(world.notices[0]).toEqual({ kind: "door_waiting", meetingId: "m-1" });
    expect(world.now).toBe(90_000 + 180_000);
    expect(world.calls).toContain("leave");
    expect(world.calls).not.toContain("record:start");
  });

  it("впустили после первой нотисы — пишем как обычно", async () => {
    // 18 отрезков по 5 с = 90 с у двери, потом впустили.
    const world = build({
      door: [...Array.from({ length: 18 }, () => "timeout" as const), "admitted"],
    });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("recorded");
    expect(kinds(world)).toEqual(["door_waiting"]);
  });

  it("сервер сказал should_leave — уходим сразу, не дожидаясь своего потолка", async () => {
    const world = build({ door: ["timeout"], shouldLeaveOnNotice: true });

    await runMeeting(world.options);

    expect(kinds(world)).toEqual(["door_waiting"]);
  });

  it("хост отклонил → door_denied, выход", async () => {
    const world = build({ door: ["denied"] });

    expect(await runMeeting(world.options)).toBe("door_denied");
    expect(kinds(world)).toEqual(["door_denied"]);
    expect(world.calls).toContain("leave");
  });

  it("капча → нотиса captcha, выход", async () => {
    const world = build({ door: ["captcha"] });

    expect(await runMeeting(world.options)).toBe("captcha");
    expect(kinds(world)).toEqual(["captcha"]);
  });

  it("остановили у двери → уходим без записи и без нотисы о двери", async () => {
    const world = build({ door: ["timeout"], stopAfterPolls: 3 });

    expect(await runMeeting(world.options)).toBe("stopped_at_door");
    expect(world.notices).toEqual([]);
    expect(world.calls).toContain("leave");
  });
});

describe("громкие отказы", () => {
  it("заход упал → join_failed с причиной", async () => {
    const world = build({ joinError: new Error("net::ERR_NAME_NOT_RESOLVED") });

    expect(await runMeeting(world.options)).toBe("join_failed");
    expect(world.notices).toEqual([
      { kind: "join_failed", meetingId: "m-1", detail: "net::ERR_NAME_NOT_RESOLVED" },
    ]);
  });

  it("запись не стартовала → no_audio, из звонка выходим", async () => {
    const world = build({ recorderError: new Error("pulse: no such source") });

    expect(await runMeeting(world.options)).toBe("no_audio");
    expect(kinds(world)).toEqual(["no_audio"]);
    expect(world.calls).toContain("leave");
  });

  it("ни одной части → no_audio, а не пустая выгрузка", async () => {
    const world = build({ partsRecorded: 0 });

    expect(await runMeeting(world.options)).toBe("nothing_recorded");
    expect(kinds(world)).toEqual(["no_audio"]);
    expect(world.calls.some((call) => call.startsWith("finish"))).toBe(false);
  });

  it("выгрузка упала → recording_lost с причиной", async () => {
    const world = build({ finishError: new Error("503") });

    expect(await runMeeting(world.options)).toBe("upload_failed");
    expect(world.notices).toEqual([{ kind: "recording_lost", meetingId: "m-1", detail: "503" }]);
  });

  it("сбой процесса — наружу исключением и БЕЗ финального heartbeat: молчание и есть сигнал", async () => {
    const world = build();
    const broken: MeetingRunOptions = {
      ...world.options,
      adapter: {
        ...world.options.adapter,
        aloneSignal: () => Promise.resolve(true),
        leave: () => Promise.resolve(),
      },
      recorder: {
        start: () => Promise.resolve(),
        stop: () => Promise.reject(new Error("ffmpeg: segmentation fault")),
      },
    };

    await expect(runMeeting(broken)).rejects.toThrow(/segmentation fault/u);
    expect(world.calls).not.toContain("heartbeat:final");
  });

  it("нотиса не ушла — встреча не падает", async () => {
    const world = build({ door: ["denied"] });
    const options: MeetingRunOptions = {
      ...world.options,
      notifier: { notify: () => Promise.reject(new Error("502")) },
    };

    expect(await runMeeting(options)).toBe("door_denied");
  });
});

describe("сбои по дороге не роняют встречу", () => {
  it("выход, опрос участников и heartbeat упали — встреча всё равно доведена до выгрузки", async () => {
    const world = build();
    const lines: string[] = [];
    let polls = 0;
    const options: MeetingRunOptions = {
      ...world.options,
      log: (line) => {
        lines.push(line);
      },
      adapter: {
        ...world.options.adapter,
        aloneSignal: () => {
          polls += 1;
          return polls === 1 ? Promise.reject(new Error("page crashed")) : Promise.resolve(true);
        },
        leave: () => Promise.reject(new Error("target closed")),
      },
      session: {
        ...world.options.session,
        heartbeat: () => Promise.reject(new Error("503")),
      },
      finalHeartbeat: () => Promise.reject(new Error("503")),
    };

    expect(await runMeeting(options)).toBe("recorded");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual(
      expect.arrayContaining([
        "опрос участников не удался: page crashed",
        "выход из звонка не удался: target closed",
        "heartbeat не ушёл: 503",
        "финальный heartbeat не ушёл: 503",
      ]),
    );
  });

  it("без подменённых часов и журнала работает на настоящих", async () => {
    const world = build();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      // консоль в тестах глушим
    });
    const o = world.options;

    const outcome = await runMeeting({
      joinUrl: o.joinUrl,
      displayName: o.displayName,
      adapter: o.adapter,
      session: o.session,
      recorder: o.recorder,
      timeline: o.timeline,
      notifier: o.notifier,
      finalHeartbeat: o.finalHeartbeat,
      stop: o.stop,
      timing: { ...TIMING, aloneMs: 1, pollMs: 1 },
    });

    expect(outcome).toBe("recorded");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
