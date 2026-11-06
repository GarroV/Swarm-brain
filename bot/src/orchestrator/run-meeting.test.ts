import { describe, expect, it, vi } from "vitest";
import { SwarmHttpError } from "../swarm-client/errors.ts";
import { type MeetingRunOptions, runMeeting } from "./run-meeting.ts";
import { build, refusal, TIMING, type Script } from "../../test-support/run-meeting.ts";

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

describe("финальный heartbeat называет встречу", () => {
  it("штатный конец: recording:false уходит в строку встречи — иначе сторож видит обрыв там, где его нет", async () => {
    const world = build({ alone: [false, true] });

    expect(await runMeeting(world.options)).toBe("recorded");

    expect(world.finals).toEqual(["m-1"]);
  });

  it("не впустили — финальный heartbeat тоже по встрече: она заявлена за этим ботом", async () => {
    const world = build({ door: ["denied"] });

    expect(await runMeeting(world.options)).toBe("door_denied");

    expect(world.finals).toEqual(["m-1"]);
  });
});

describe("удары несут записанные секунды — арбитраж meeting-claim видит запись бота (T155)", () => {
  it("первый удар в начале записи — 0 с, дальше каждый несёт, сколько записано к нему", async () => {
    // Интервал ударов — на подменённых таймерах, в такт подменённым часам встречи.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const world = build({ alone: [false], stopAfterPolls: 60 });
      const options: MeetingRunOptions = {
        ...world.options,
        timing: { ...TIMING, heartbeatMs: 120_000 },
        sleep: (ms) => {
          world.now += ms;
          vi.advanceTimersByTime(ms);
          return Promise.resolve();
        },
      };

      expect(await runMeeting(options)).toBe("recorded");

      // 60 опросов по 5 с — 295 с между первым опросом и последним сном: удары на 0, 120, 240 с.
      expect(world.beats).toEqual([0, 120, 240]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("финальный удар называет всю длину записи: до остановки записи, а не до выхода", async () => {
    const world = build({ alone: [false, false, true] });
    const options: MeetingRunOptions = {
      ...world.options,
      recorder: {
        ...world.options.recorder,
        stop: () => {
          world.calls.push("record:stop");
          world.now += 7000; // запечатывание частей после остановки в запись не входит
          return Promise.resolve(3);
        },
      },
    };

    expect(await runMeeting(options)).toBe("recorded");

    // Два опроса «люди» и 25 опросов «один» до порога 120 с, по 5 с на опрос: 26 снов = 130 с.
    expect(world.finalSeconds).toEqual([130]);
    expect(world.beats).toEqual([0]);
  });

  it("записи не было (не впустили) — финальный удар без секунд: заявленные 0 не переписываются", async () => {
    const world = build({ door: ["denied"] });

    expect(await runMeeting(world.options)).toBe("door_denied");

    expect(world.finalSeconds).toEqual([null]);
    expect(world.beats).toEqual([]);
  });

  it("запись не завелась — финальный удар без секунд", async () => {
    const world = build({ recorderError: new Error("ffmpeg: no such device") });

    expect(await runMeeting(world.options)).toBe("no_audio");

    expect(world.finalSeconds).toEqual([null]);
  });
});

describe("право транскрибации ушло другой записи (D019)", () => {
  const TAKEN_OVER = { error: "meeting is not yours", code: "not_claim_owner" };

  it("heartbeat отбит «встреча не твоя» → запись остановлена, из звонка вышли, выгрузки и нотисы нет", async () => {
    // Люди в звонке всё время; остановка снаружи — только страховка на 1000-м опросе.
    const world = build({
      alone: [false],
      stopAfterPolls: 1000,
      heartbeatError: refusal(TAKEN_OVER),
    });

    const outcome = await runMeeting(world.options);

    expect(outcome).toBe("superseded");
    expect(world.stop.signal.aborted).toBe(false);
    expect(world.calls).toEqual([
      "claim",
      "report:m-1",
      "join:https://meet.google.com/abc-defg-hij",
      "record:start",
      "timeline:start",
      "heartbeat",
      "record:stop",
      "leave",
      "heartbeat:final",
    ]);
    expect(world.notices).toEqual([]);
  });

  it("после перехвата финальный heartbeat — без встречи: она не наша, а строка агента должна ожить", async () => {
    const world = build({
      alone: [false],
      stopAfterPolls: 1000,
      heartbeatError: refusal(TAKEN_OVER),
    });

    await runMeeting(world.options);

    expect(world.finals).toEqual([null]);
  });

  it("другой 403 (доверенность отозвана) — не перехват: встречу дописываем и отдаём", async () => {
    const world = build({
      alone: [false, true],
      heartbeatError: refusal({ error: "Unauthorized" }),
    });

    expect(await runMeeting(world.options)).toBe("recorded");
    expect(world.finals).toEqual(["m-1"]);
  });

  it("403 без машинной причины (старый сервер) — не перехват", async () => {
    const world = build({ alone: [false, true], heartbeatError: refusal("meeting is not yours") });

    expect(await runMeeting(world.options)).toBe("recorded");
  });

  it("та же причина, но не 403 — не перехват", async () => {
    const world = build({
      alone: [false, true],
      heartbeatError: new SwarmHttpError(500, JSON.stringify(TAKEN_OVER)),
    });

    expect(await runMeeting(world.options)).toBe("recorded");
  });

  it("сбой сети на heartbeat — не перехват", async () => {
    const world = build({ alone: [false, true], heartbeatError: new Error("ECONNRESET") });

    expect(await runMeeting(world.options)).toBe("recorded");
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

async function watch(script: Script, silent: (call: number) => boolean | null): Promise<string[]> {
  const world = build(script);
  const reports: string[] = [];
  let samples = 0;
  const options: MeetingRunOptions = {
    ...world.options,
    timing: { ...TIMING, audioSampleMs: 60_000, silenceAlertMs: 180_000 },
    audioWatch: {
      sampleSilent: () => {
        samples += 1;
        return Promise.resolve(silent(samples));
      },
      report: (alert) => {
        reports.push(alert);
      },
    },
  };
  await runMeeting(options);
  return reports;
}

describe("сторож тишины (#861)", () => {
  it("люди в звонке и 3 минуты тишины — одно предупреждение", async () => {
    const reports = await watch({ alone: [false], stopAfterPolls: 120 }, () => true);

    expect(reports).toEqual(["silent"]);
  });

  it("звук вернулся — одно «вернулся», дальше сторож молчит", async () => {
    const reports = await watch({ alone: [false], stopAfterPolls: 120 }, (call) =>
      call <= 4 ? true : call % 2 === 0,
    );

    expect(reports).toEqual(["silent", "back"]);
  });

  it("бот один или замер не удался — тревоги нет", async () => {
    expect(await watch({ alone: [null], stopAfterPolls: 120 }, () => true)).toEqual([]);
    expect(await watch({ alone: [false], stopAfterPolls: 120 }, () => null)).toEqual([]);
  });

  it("сбой замера пишется в журнал и не роняет встречу", async () => {
    const world = build({ alone: [false], stopAfterPolls: 30 });
    const lines: string[] = [];
    const outcome = await runMeeting({
      ...world.options,
      log: (line) => {
        lines.push(line);
      },
      audioWatch: {
        sampleSilent: () => Promise.reject(new Error("ffmpeg упал")),
        report: (): void => undefined,
      },
    });

    expect(outcome).toBe("recorded");
    expect(lines.some((line) => line.includes("замер звука не удался"))).toBe(true);
  });
});

type Speakers = "silent" | "talking" | "no_signal";

async function quietRun(speakers: Speakers): Promise<string[]> {
  const world = build({ alone: [false], stopAfterPolls: 1000 });
  const lines: string[] = [];
  const lastSpokeAt =
    speakers === "no_signal"
      ? undefined
      : (): number | null => (speakers === "talking" ? world.now : null);
  await runMeeting({
    ...world.options,
    timing: { ...TIMING, audioSampleMs: 60_000, silenceAlertMs: 180_000, quietEndMs: 900_000 },
    timeline: { ...world.options.timeline, ...(lastSpokeAt && { lastSpokeAt }) },
    log: (line) => {
      lines.push(line);
    },
    audioWatch: { sampleSilent: () => Promise.resolve(true), report: (): void => undefined },
  });
  return lines;
}

describe("тихий конец встречи (#376)", () => {
  const QUIET = "тишина и никто не говорит";

  it("люди в звонке, но 15 минут тишины и никто не говорит — бот выходит", async () => {
    const lines = await quietRun("silent");

    expect(lines.some((line) => line.includes(QUIET))).toBe(true);
    expect(lines.some((line) => line.includes("остановка снаружи"))).toBe(false);
  });

  it("сборщик говорящих без сигнала — решает один звук", async () => {
    const lines = await quietRun("no_signal");

    expect(lines.some((line) => line.includes(QUIET))).toBe(true);
  });

  it("кто-то подсвечен говорящим — тишина в записи не конец встречи", async () => {
    const lines = await quietRun("talking");

    expect(lines.some((line) => line.includes(QUIET))).toBe(false);
  });
});
