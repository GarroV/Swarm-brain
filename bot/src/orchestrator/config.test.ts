import { describe, expect, it } from "vitest";

import { MEETING_ENV, parsePlatform, readMeetingConfig } from "./config.ts";

const BASE = {
  [MEETING_ENV.joinUrl]: "https://meet.google.com/abc-defg-hij",
  [MEETING_ENV.platform]: "meet",
  [MEETING_ENV.onBehalfOf]: "744",
  [MEETING_ENV.swarmUrl]: "https://swarm.example/functions/v1",
  [MEETING_ENV.token]: "t",
  [MEETING_ENV.runId]: "r-1",
};

describe("readMeetingConfig", () => {
  it("минимальное окружение даёт рабочие умолчания", () => {
    const config = readMeetingConfig(BASE);

    expect(config).toMatchObject({
      onBehalfOf: 744,
      platform: "meet",
      version: 0,
      displayName: "scriba",
      leaseDir: "/lease",
      maxMeetingMs: 240 * 60_000,
      segmentSeconds: null,
      timing: {},
      smokeMeetPage: null,
      invite: null,
    });
  });

  it("приглашение читается парой id и ссылки", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.inviteId]: "inv-1",
      [MEETING_ENV.inviteJoinUrl]: "https://meet.google.com/abc-defg-hij",
    });

    expect(config.invite).toEqual({ id: "inv-1", joinUrl: "https://meet.google.com/abc-defg-hij" });
  });

  it.each([MEETING_ENV.inviteId, MEETING_ENV.inviteJoinUrl])(
    "половина приглашения (только %s) — отказ на старте",
    (name) => {
      expect(() => readMeetingConfig({ ...BASE, [name]: "x" })).toThrow(/только вместе/u);
    },
  );

  it("ручки времени читаются, пустые пропускаются", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.aloneMs]: "5000",
      [MEETING_ENV.pollMs]: " ",
      [MEETING_ENV.maxMinutes]: "3",
      [MEETING_ENV.segmentSeconds]: "4",
    });

    expect(config.timing).toEqual({ aloneMs: 5000 });
    expect(config.maxMeetingMs).toBe(180_000);
    expect(config.segmentSeconds).toBe(4);
  });

  it.each([
    MEETING_ENV.joinUrl,
    MEETING_ENV.platform,
    MEETING_ENV.onBehalfOf,
    MEETING_ENV.swarmUrl,
    MEETING_ENV.token,
    MEETING_ENV.runId,
  ])("без %s — отказ с именем переменной", (name) => {
    expect(() => readMeetingConfig({ ...BASE, [name]: "" })).toThrow(name);
  });

  it.each(["0", "-5", "1.5", "abc"])("SCRIBA_ON_BEHALF_OF=%s — отказ", (value) => {
    expect(() => readMeetingConfig({ ...BASE, [MEETING_ENV.onBehalfOf]: value })).toThrow(
      /целым положительным/u,
    );
  });
});

describe("readMeetingConfig — событие календаря (T100)", () => {
  it("без ключа и начала — calendar null", () => {
    const config = readMeetingConfig(BASE);

    expect(config.calendar).toBeNull();
  });

  it("ключ и начало читаются вместе", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.calendarKey]: "evt-1:2026-09-28",
      [MEETING_ENV.calendarStartsAt]: "2026-09-28T10:00:00.000Z",
    });

    expect(config.calendar).toEqual({
      calendarKey: "evt-1:2026-09-28",
      startsAt: "2026-09-28T10:00:00.000Z",
    });
  });

  it("название события доезжает до заявки контейнера", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.calendarKey]: "evt-1:2026-09-28",
      [MEETING_ENV.calendarStartsAt]: "2026-09-28T10:00:00.000Z",
      [MEETING_ENV.calendarTitle]: "Качество агрегаторы",
    });

    expect(config.calendar?.title).toBe("Качество агрегаторы");
  });

  it.each([MEETING_ENV.calendarKey, MEETING_ENV.calendarStartsAt])(
    "половина пары (только %s) — отказ на старте",
    (name) => {
      expect(() => readMeetingConfig({ ...BASE, [name]: "x" })).toThrow(/только вместе/u);
    },
  );

  it("начало не читается как время — отказ с именем переменной", () => {
    expect(() =>
      readMeetingConfig({
        ...BASE,
        [MEETING_ENV.calendarKey]: "evt-1:2026-09-28",
        [MEETING_ENV.calendarStartsAt]: "не время",
      }),
    ).toThrow(new RegExp(MEETING_ENV.calendarStartsAt, "u"));
  });

  it("не сочетается с приглашением — у встречи одно основание", () => {
    expect(() =>
      readMeetingConfig({
        ...BASE,
        [MEETING_ENV.inviteId]: "inv-1",
        [MEETING_ENV.inviteJoinUrl]: "https://meet.google.com/abc-defg-hij",
        [MEETING_ENV.calendarKey]: "evt-1:2026-09-28",
        [MEETING_ENV.calendarStartsAt]: "2026-09-28T10:00:00.000Z",
      }),
    ).toThrow(/одно основание/u);
  });
});

describe("имя бота в звонке", () => {
  it("в Толк гостем — имя, под которым бота видят в Meet (профиль Google «Scriba Notetaker»)", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.platform]: "kontur",
      [MEETING_ENV.joinUrl]: "https://dodobrands.ktalk.ru/abc",
    });
    expect(config.displayName).toBe("Scriba Notetaker");
  });

  it("в Meet — прежнее имя профиля", () => {
    expect(readMeetingConfig(BASE).displayName).toBe("scriba");
  });

  it("SCRIBA_DISPLAY_NAME перебивает оба", () => {
    const config = readMeetingConfig({
      ...BASE,
      [MEETING_ENV.platform]: "kontur",
      [MEETING_ENV.displayName]: "бот-смоук",
    });
    expect(config.displayName).toBe("бот-смоук");
  });
});

describe("parsePlatform", () => {
  it("meet — есть адаптер", () => {
    expect(parsePlatform("meet")).toBe("meet");
  });

  it("kontur — есть адаптер (T111)", () => {
    expect(parsePlatform("kontur")).toBe("kontur");
  });

  it.each(["zoom", "teams", ""])("«%s» — отказ до подъёма контейнера", (raw) => {
    expect(() => parsePlatform(raw)).toThrow(/не поддерживается/u);
  });
});
