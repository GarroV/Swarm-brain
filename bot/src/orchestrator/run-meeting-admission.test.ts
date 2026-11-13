import { describe, expect, it } from "vitest";
import { type MeetingRunOptions, runMeeting } from "./run-meeting.ts";
import { build, kinds } from "../../test-support/run-meeting.ts";

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

  // Каждому исходу двери — своё уведомление. Страница ошибки Meet — не «хост отклонил» (T173):
  // хост заявки не видел, и человеку нужен другой совет.
  it.each([
    { door: "denied", outcome: "door_denied", what: "хост отклонил" },
    { door: "blocked", outcome: "door_blocked", what: "Meet не пустил гостя до лобби" },
    { door: "unavailable", outcome: "meeting_unavailable", what: "встречи нет или она кончилась" },
    { door: "captcha", outcome: "captcha", what: "капча" },
    // Вход аккаунта бота слетел (T175): чинить вход бота, а не доступ к встрече.
    { door: "signin_required", outcome: "account_signin_required", what: "Google просит вход" },
    // Толк: комната так и не открылась для гостей (D040) — совет «откройте комнату», а не «впустите».
    { door: "guest_access_closed", outcome: "guest_access_closed", what: "комната Толка закрыта" },
  ] as const)("$what → нотиса $outcome, выход", async ({ door, outcome }) => {
    const world = build({ door: [door] });

    expect(await runMeeting(world.options)).toBe(outcome);
    expect(kinds(world)).toEqual([outcome]);
    expect(world.calls).toContain("leave");
  });

  // Ранний «стук» (12.11.2026): пока адаптер Толка ждёт открытия комнаты, нотиса уже ушла.
  it("комната Толка закрыта → «стук» guest_access_waiting сразу при заходе, до исхода двери", async () => {
    const world = build({ guestRoomClosedOnJoin: true, door: ["guest_access_closed"] });

    expect(await runMeeting(world.options)).toBe("guest_access_closed");
    expect(kinds(world)).toEqual(["guest_access_waiting", "guest_access_closed"]);
    expect(world.notices[0]).toEqual({ kind: "guest_access_waiting", meetingId: "m-1" });
  });

  it("комнату открыли после «стука» — больше нотис нет, пишем как обычно", async () => {
    const world = build({ guestRoomClosedOnJoin: true, door: ["admitted"] });

    expect(await runMeeting(world.options)).toBe("recorded");
    expect(kinds(world)).toEqual(["guest_access_waiting"]);
  });

  it("в звонке у бота живой микрофон → join_failed с причиной, выход, записи нет", async () => {
    const world = build({ door: ["mic_live"] });

    expect(await runMeeting(world.options)).toBe("join_failed");
    expect(world.notices).toHaveLength(1);
    expect(world.notices[0]).toMatchObject({ kind: "join_failed", meetingId: "m-1" });
    expect(JSON.stringify(world.notices[0])).toMatch(/microphone or camera was on/u);
    expect(world.calls).toContain("leave");
    expect(world.calls).not.toContain("record:start");
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

  it("сбой загрузки страницы звонка → вторая попытка, нотисы нет, дальше запись", async () => {
    const timeout = new Error(
      "page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating to https://meet.google.com/abc, waiting until domcontentloaded",
    );
    const world = build({ joinErrors: [timeout, null] });

    expect(await runMeeting(world.options)).toBe("recorded");
    expect(world.calls.filter((call) => call.startsWith("join:"))).toHaveLength(2);
    expect(world.notices).toEqual([]);
  });

  it("три сбоя загрузки подряд → ровно одна нотиса join_failed после последней", async () => {
    const world = build({ joinError: new Error("net::ERR_CONNECTION_RESET at https://meet") });
    const lines: string[] = [];
    const options = {
      ...world.options,
      log: (line: string): void => {
        lines.push(line);
      },
    };

    expect(await runMeeting(options)).toBe("join_failed");
    expect(world.calls.filter((call) => call.startsWith("join:"))).toHaveLength(3);
    expect(world.notices).toHaveLength(1);
    expect(world.notices[0]).toMatchObject({ kind: "join_failed", meetingId: "m-1" });
    expect(lines.filter((line) => line.startsWith("заход: попытка"))).toEqual([
      "заход: попытка 1 из 3 — net::ERR_CONNECTION_RESET at https://meet",
      "заход: попытка 2 из 3 — net::ERR_CONNECTION_RESET at https://meet",
    ]);
  });

  it("отказ захода по существу → без повтора, сразу join_failed", async () => {
    const world = build({
      joinError: new Error("Комната закрыта для гостей — в звонок не входим"),
    });

    expect(await runMeeting(world.options)).toBe("join_failed");
    expect(world.calls.filter((call) => call.startsWith("join:"))).toHaveLength(1);
    expect(world.notices).toHaveLength(1);
  });

  it("остановили между попытками → повтора нет", async () => {
    const world = build({ joinError: new Error("net::ERR_TIMED_OUT") });
    world.stop.abort();

    expect(await runMeeting(world.options)).toBe("join_failed");
    expect(world.calls.filter((call) => call.startsWith("join:"))).toHaveLength(1);
  });

  it("календарное задание со starts_at в будущем → заход не раньше начала, строка в журнале", async () => {
    const world = build();
    const lines: string[] = [];
    const options = {
      ...world.options,
      enterAt: new Date(62_000).toISOString(),
      log: (line: string): void => {
        lines.push(line);
      },
    };

    expect(await runMeeting(options)).toBe("recorded");
    expect(world.joinedAt).toHaveLength(1);
    expect(world.joinedAt[0]).toBeGreaterThanOrEqual(62_000);
    expect(lines).toContain("жду начала встречи до 00:01:02 UTC");
  });

  it("starts_at в прошлом → заход сразу, без ожидания", async () => {
    const world = build();
    world.now = 100_000;
    const lines: string[] = [];
    const options = {
      ...world.options,
      enterAt: new Date(10_000).toISOString(),
      log: (line: string): void => {
        lines.push(line);
      },
    };

    expect(await runMeeting(options)).toBe("recorded");
    expect(world.joinedAt).toEqual([100_000]);
    expect(lines.some((line) => line.startsWith("жду начала"))).toBe(false);
  });

  it("ручное приглашение (без enterAt) → заход сразу", async () => {
    const world = build();

    expect(await runMeeting(world.options)).toBe("recorded");
    expect(world.joinedAt).toEqual([0]);
  });

  it("остановили во время ожидания начала → нет захода, нет join_failed", async () => {
    const world = build();
    const options = {
      ...world.options,
      enterAt: new Date(600_000).toISOString(),
      sleep: (ms: number): Promise<void> => {
        world.now += ms;
        world.stop.abort();
        return Promise.resolve();
      },
    };

    expect(await runMeeting(options)).toBe("stopped_before_join");
    expect(world.joinedAt).toEqual([]);
    expect(world.notices).toEqual([]);
    expect(world.calls).toContain("leave");
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
