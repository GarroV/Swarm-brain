import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adoptOrphanedRuns, runQueueRoot, touchAlive } from "./run-directories.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const quiet = (): void => {
  // журнал в тестах не нужен
};

describe("очереди запусков на томе", () => {
  let person = "";

  async function run(runId: string, aliveAgoMs: number | null, meetings: string[]): Promise<void> {
    const root = runQueueRoot(person, runId);
    for (const meeting of meetings) {
      await mkdir(path.join(root, "pending", meeting), { recursive: true });
      await writeFile(path.join(root, "pending", meeting, "meta.json"), "{}");
    }
    await mkdir(root, { recursive: true });
    if (aliveAgoMs !== null) await touchAlive(root, new Date(NOW - aliveAgoMs));
  }

  beforeEach(async () => {
    person = await mkdtemp(path.join(tmpdir(), "scriba-runs-"));
  });

  afterEach(async () => {
    await rm(person, { recursive: true, force: true });
  });

  it("встречи замолчавшего запуска переезжают к новому, живого — остаются у него", async () => {
    await run("dead", 10 * 60_000, ["m-1", "m-2"]);
    await run("busy", 5000, ["m-3"]);

    const moved = await adoptOrphanedRuns({
      personDirectory: person,
      ownRunId: "me",
      nowMs: NOW,
      log: quiet,
    });

    expect(moved).toBe(2);
    const adopted = await readdir(path.join(person, "me", "pending"));
    expect(adopted.toSorted((left, right) => left.localeCompare(right))).toEqual(["m-1", "m-2"]);
    expect(await readdir(path.join(person, "busy", "pending"))).toEqual(["m-3"]);
    // От запуска ничего не осталось — каталог убран целиком.
    expect(await readdir(person)).not.toContain("dead");
  });

  it("свой запуск не усыновляется, как бы давно он ни отмечался", async () => {
    await run("me", 10 * 60_000, ["m-1"]);

    expect(
      await adoptOrphanedRuns({ personDirectory: person, ownRunId: "me", nowMs: NOW, log: quiet }),
    ).toBe(0);
  });

  it("каталог без отметки alive — не запуск, не трогаем", async () => {
    await run("stranger", null, ["m-1"]);

    expect(
      await adoptOrphanedRuns({ personDirectory: person, ownRunId: "me", nowMs: NOW, log: quiet }),
    ).toBe(0);
    expect(await readdir(path.join(person, "stranger", "pending"))).toEqual(["m-1"]);
  });

  it("dead-letter осиротевшего запуска остаётся на месте — он для человека", async () => {
    await run("dead", 10 * 60_000, []);
    await mkdir(path.join(person, "dead", "failed", "m-9"), { recursive: true });

    await adoptOrphanedRuns({ personDirectory: person, ownRunId: "me", nowMs: NOW, log: quiet });

    expect(await readdir(path.join(person, "dead", "failed"))).toEqual(["m-9"]);
  });

  it("двое стартовали одновременно — каждая встреча достаётся ровно одному", async () => {
    await run("dead", 10 * 60_000, ["m-1", "m-2", "m-3"]);

    const [a, b] = await Promise.all([
      adoptOrphanedRuns({ personDirectory: person, ownRunId: "a", nowMs: NOW, log: quiet }),
      adoptOrphanedRuns({ personDirectory: person, ownRunId: "b", nowMs: NOW, log: quiet }),
    ]);

    expect(a + b).toBe(3);
  });

  it("человека ещё нет на томе — ноль, а не исключение", async () => {
    expect(
      await adoptOrphanedRuns({
        personDirectory: path.join(person, "nobody"),
        ownRunId: "me",
        nowMs: NOW,
        log: quiet,
      }),
    ).toBe(0);
  });

  it("файл вместо каталога запуска пропускается", async () => {
    await writeFile(path.join(person, "junk"), "x");

    expect(
      await adoptOrphanedRuns({ personDirectory: person, ownRunId: "me", nowMs: NOW, log: quiet }),
    ).toBe(0);
  });

  it("touchAlive обновляет отметку", async () => {
    const root = runQueueRoot(person, "me");
    await touchAlive(root, new Date(NOW - 60_000));
    await touchAlive(root, new Date(NOW));
    const info = await stat(path.join(root, "alive"));

    expect(info.mtimeMs).toBe(NOW);
  });
});
