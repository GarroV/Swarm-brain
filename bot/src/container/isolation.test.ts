import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CONTAINER_LIMITS, loadSeccompProfile, validLimits } from "./isolation.ts";

describe("границы контейнера встречи", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-isolation-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("профиль seccomp из репозитория читается и остаётся профилем", () => {
    const profile = JSON.parse(loadSeccompProfile()) as { syscalls: unknown[] };
    expect(profile.syscalls.length).toBeGreaterThan(0);
  });

  it("файл без списка syscalls — громкий отказ, а не контейнер без профиля", async () => {
    const file = path.join(directory, "broken.json");
    await writeFile(file, JSON.stringify({ defaultAction: "SCMP_ACT_ALLOW" }));
    expect(() => loadSeccompProfile(pathToFileURL(file))).toThrow(/не профиль/);
  });

  it("нулевой потолок — отказ, а не «без ограничений»", () => {
    expect(() => validLimits({ ...DEFAULT_CONTAINER_LIMITS, pids: 0 })).toThrow(/pids/);
  });
});
