import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunLogs } from "./run-log.ts";

describe("RunLogs — журнал запуска бота на диске службы (#832)", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-runs-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("каждая строка — в файл запуска с отметкой времени", async () => {
    const logs = new RunLogs({ directory, now: () => new Date("2026-10-07T10:00:00Z") });
    const writer = logs.open("run-1");
    writer.line("admitted");
    writer.line("alone=null");

    const text = await readFile(path.join(directory, "run-1.log"), "utf8");
    expect(text).toBe("2026-10-07T10:00:00.000Z admitted\n2026-10-07T10:00:00.000Z alone=null\n");
  });

  it("id запуска не выводит файл за пределы каталога", () => {
    const logs = new RunLogs({ directory });
    expect(logs.pathFor("../../etc/x")).toBe(path.join(directory, "x.log"));
  });

  it("хранит keep самых свежих журналов, чужие файлы не трогает", async () => {
    for (const [name, age] of [
      ["a.log", 3],
      ["b.log", 2],
      ["c.log", 1],
      ["note.txt", 9],
    ] as const) {
      const file = path.join(directory, name);
      await writeFile(file, "x");
      const at = new Date(Date.now() - age * 60_000);
      await utimes(file, at, at);
    }
    new RunLogs({ directory, keep: 2 }).prune();
    const left = await readdir(directory);
    expect(left.toSorted((a, b) => a.localeCompare(b))).toEqual(["b.log", "c.log", "note.txt"]);
  });

  it("сбой записи — одно сообщение службе, встреча не падает", async () => {
    const said: string[] = [];
    // На месте файла — каталог: запись падает с EISDIR, всегда и сразу.
    await mkdir(path.join(directory, "run-2.log"));
    const writer = new RunLogs({
      directory,
      log: (line) => {
        said.push(line);
      },
    }).open("run-2");
    expect(() => {
      writer.line("x");
      writer.line("y");
    }).not.toThrow();
    expect(said).toHaveLength(1);
  });
});
