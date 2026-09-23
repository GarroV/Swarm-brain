import { describe, expect, it } from "vitest";

import { ALONE_TIMEOUT_MS, AloneTimer } from "./alone.ts";

describe("AloneTimer", () => {
  it("порог по спеке — две минуты", () => {
    expect(ALONE_TIMEOUT_MS).toBe(120_000);
  });

  it("первое одиночество уходить не велит", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    expect(timer.observe(true, 0)).toBe(false);
  });

  it("две минуты один — пора выходить", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    expect(timer.observe(true, 119_000)).toBe(false);
    expect(timer.observe(true, 120_000)).toBe(true);
  });

  it("кто-то вернулся — отсчёт начинается заново", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    timer.observe(false, 60_000);
    timer.observe(true, 60_001);
    expect(timer.observe(true, 180_000)).toBe(false);
    expect(timer.observe(true, 180_001)).toBe(true);
  });

  it("сигнал не прочитался — это не одиночество: отсчёт сбрасывается", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    expect(timer.observe(null, 60_000)).toBe(false);
    expect(timer.observe(true, 121_000)).toBe(false);
    expect(timer.observe(true, 240_999)).toBe(false);
    expect(timer.observe(true, 241_000)).toBe(true);
  });

  it("сколько секунд бот уже один — для лога и уведомления", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 1_000);
    expect(timer.aloneForMs(61_000)).toBe(60_000);
    timer.observe(false, 61_000);
    expect(timer.aloneForMs(62_000)).toBe(0);
  });
});
