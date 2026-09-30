/**
 * Поводок: контейнер обязан заметить смерть оркестратора, и не раньше, чем пройдёт порог.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LEASE_FILE_NAME, LeaseTracker, parseLease, readLease, writeLease } from "./lease.ts";

describe("LeaseTracker", () => {
  it("seq двигается — поводок жив сколь угодно долго", () => {
    const tracker = new LeaseTracker(0, 90_000);

    for (let step = 1; step <= 100; step += 1) {
      expect(tracker.observe(step, step * 5000)).toBe(false);
    }
  });

  it("seq замер дольше порога — оркестратора нет", () => {
    const tracker = new LeaseTracker(0, 90_000);
    tracker.observe(7, 1000);

    expect(tracker.observe(7, 91_000)).toBe(false);
    expect(tracker.observe(7, 91_001)).toBe(true);
    expect(tracker.silentForMs(91_001)).toBe(90_001);
  });

  it("поводка не было с самого старта — тоже сирота, по тому же порогу", () => {
    const tracker = new LeaseTracker(0, 90_000);

    expect(tracker.observe(null, 90_000)).toBe(false);
    expect(tracker.observe(null, 90_001)).toBe(true);
  });

  it("файл пропал посреди встречи — отсчёт идёт от последнего изменения, а не сбрасывается", () => {
    const tracker = new LeaseTracker(0, 90_000);
    tracker.observe(3, 10_000);

    expect(tracker.observe(null, 100_001)).toBe(true);
  });

  it("новый оркестратор начал seq заново — это движение, а не смерть", () => {
    const tracker = new LeaseTracker(0, 90_000);
    tracker.observe(500, 10_000);

    expect(tracker.observe(1, 95_000)).toBe(false);
  });
});

describe("parseLease", () => {
  it.each([
    ["нет файла", null],
    ["не JSON", "{seq"],
    ["не объект", "7"],
    ["null", "null"],
    ["seq не число", '{"seq":"7"}'],
    ["seq дробный", '{"seq":1.5}'],
  ])("%s → null", (_what, text) => {
    expect(parseLease(text)).toBeNull();
  });

  it("целый seq читается", () => {
    expect(parseLease('{"seq":42}')).toBe(42);
  });
});

describe("файл поводка", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-lease-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("записанное читается обратно, временных файлов не остаётся", async () => {
    await writeLease(directory, 1);
    await writeLease(directory, 2);

    expect(await readLease(directory)).toBe(2);
    expect(await readdir(directory)).toEqual([LEASE_FILE_NAME]);
  });

  it("каталога нет — null, а не исключение", async () => {
    expect(await readLease(path.join(directory, "missing"))).toBeNull();
  });

  it("мусор в файле — null", async () => {
    await writeFile(path.join(directory, LEASE_FILE_NAME), "garbage");

    expect(await readLease(directory)).toBeNull();
  });
});
