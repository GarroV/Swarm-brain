import { describe, expect, it } from "vitest";
import { isTransient, parseRetryAfterMs, SwarmHttpError, SwarmTransportError } from "./errors.ts";

describe("isTransient", () => {
  it.each([
    [500, true],
    [502, true],
    [503, true],
    [429, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [413, false],
  ])("HTTP %i повторяем: %s", (status, expected) => {
    expect(isTransient(new SwarmHttpError(status, "body"))).toBe(expected);
  });

  it("сетевой сбой повторяем — до сервера не дошли, ответа нет", () => {
    expect(isTransient(new SwarmTransportError("connection reset"))).toBe(true);
  });

  it("чужая ошибка не повторяется: повторять баг в своём коде нечего", () => {
    expect(isTransient(new TypeError("boom"))).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("число секунд", () => {
    expect(parseRetryAfterMs("12")).toBe(12_000);
  });

  it("ноль — это «сразу», а не «сервер не просил»", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("HTTP-дата считается от переданного «сейчас»", () => {
    const now = Date.parse("2026-09-23T10:00:00Z");
    expect(parseRetryAfterMs("Wed, 23 Sep 2026 10:00:30 GMT", now)).toBe(30_000);
  });

  it("дата в прошлом не даёт отрицательного ожидания", () => {
    const now = Date.parse("2026-09-23T10:01:00Z");
    expect(parseRetryAfterMs("Wed, 23 Sep 2026 10:00:00 GMT", now)).toBe(0);
  });

  it.each([null, "", " ".repeat(3), "потом", "-5"])("мусор %o читается как «не просил»", (raw) => {
    expect(parseRetryAfterMs(raw)).toBeUndefined();
  });
});

describe("SwarmHttpError", () => {
  it("длинное тело ответа в сообщение целиком не тащится", () => {
    const error = new SwarmHttpError(500, "x".repeat(5000));
    expect(error.message.length).toBeLessThan(600);
    expect(error.bodyText).toHaveLength(5000);
  });
});
