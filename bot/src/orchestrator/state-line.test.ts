import { describe, expect, it } from "vitest";

import { formatStateLine, parseStateLine } from "./state-line.ts";

describe("строка состояния", () => {
  it("туда и обратно", () => {
    expect(parseStateLine(formatStateLine({ meetingId: "m-1" }))).toEqual({ meetingId: "m-1" });
    expect(parseStateLine(formatStateLine({ outcome: "recorded" }))).toEqual({
      outcome: "recorded",
    });
  });

  it("находится и с префиксом журнала перед ней", () => {
    expect(parseStateLine('2026-09-26T10:00:00Z scriba-state {"meetingId":"m-2"}')).toEqual({
      meetingId: "m-2",
    });
  });

  it.each([
    ["чужая строка", "[meet] клик: войти"],
    ["мусор после префикса", "scriba-state {oops"],
    ["не объект", "scriba-state 42"],
    ["пустые поля", 'scriba-state {"meetingId":"","outcome":7}'],
  ])("%s → null", (_what, line) => {
    expect(parseStateLine(line)).toBeNull();
  });
});
