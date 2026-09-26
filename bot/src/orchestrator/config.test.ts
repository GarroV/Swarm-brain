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
    });
  });

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

describe("parsePlatform", () => {
  it("meet — есть адаптер", () => {
    expect(parsePlatform("meet")).toBe("meet");
  });

  it.each(["zoom", "kontur", ""])("«%s» — отказ до подъёма контейнера", (raw) => {
    expect(() => parsePlatform(raw)).toThrow(/не поддерживается/u);
  });
});
