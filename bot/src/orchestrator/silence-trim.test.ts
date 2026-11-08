import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  VAD_PADDING_SECONDS,
  VAD_WINDOW_SECONDS,
  WindowClassifier,
  blocksFromWindows,
  blocksToCut,
  detectSpeechBlocks,
  trimPart,
} from "./silence-trim.ts";

const TOLERANCE = 0.12;

/**
 * [старт, конец] «речи» (тон 440 Гц, ≈ −12 dBFS RMS), секунды. Всё между — цифровая тишина.
 */
const BURSTS: readonly (readonly [number, number])[] = [
  [3, 7],
  [12, 15], // пауза 5 с между первыми двумя — короткая, резать нельзя
  [45, 50], // до него 30 с тишины — режем
  [75, 77], // до него 25 с тишины — режем
];
const TOTAL_SECONDS = 80;

function ffmpegSync(arguments_: readonly string[]): Buffer {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- ffmpeg в PATH — контракт образа блока container
  return execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...arguments_], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Файл: тоны на тишине по расписанию. Тон включается выражением по времени (амплитуда у `sine` по умолчанию 0,125, ×3).
 */
function makeFixture(
  file: string,
  bursts: readonly (readonly [number, number])[],
  seconds: number,
): void {
  const gate =
    bursts.length === 0
      ? "0"
      : bursts.map(([a, b]) => `between(t,${String(a)},${String(b)})`).join("+");
  ffmpegSync([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${String(seconds)}`,
    "-af",
    `volume='3*(${gate})':eval=frame`,
    "-ac",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "32k",
    "-f",
    "ipod",
    file,
  ]);
}

/**
 * Окна «речь/тишина» файла, прочитанные независимо от тримера (с тем же порогом).
 */
function windowsOf(file: string): boolean[] {
  const pcm = ffmpegSync(["-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  const classifier = new WindowClassifier(-30);
  classifier.push(pcm);
  return classifier.finish();
}

function firstSpeechAt(file: string): number {
  const index = windowsOf(file).indexOf(true);
  return index * VAD_WINDOW_SECONDS;
}

const context = { directory: "", fixture: "" };

beforeAll(async () => {
  context.directory = await mkdtemp(path.join(tmpdir(), "scriba-trim-"));
  context.fixture = path.join(context.directory, "part-000.m4a");
  makeFixture(context.fixture, BURSTS, TOTAL_SECONDS);
});

afterAll(async () => {
  await rm(context.directory, { recursive: true, force: true });
});

const speech = (seconds: number): boolean[] =>
  Array.from({ length: Math.round(seconds / VAD_WINDOW_SECONDS) }, () => true);
const quiet = (seconds: number): boolean[] =>
  Array.from({ length: Math.round(seconds / VAD_WINDOW_SECONDS) }, () => false);

describe("blocksFromWindows", () => {
  it("пауза короче 20 с остаётся внутри блока, длиннее — рвёт его", () => {
    const flags = [...speech(2), ...quiet(19), ...speech(2), ...quiet(21), ...speech(2)];
    const blocks = blocksFromWindows(flags);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.start).toBeCloseTo(0, 5);
    expect(blocks[0]?.end).toBeCloseTo(2 + 19 + 2 + VAD_PADDING_SECONDS, 5);
    expect(blocks[1]?.start).toBeCloseTo(2 + 19 + 2 + 21 - VAD_PADDING_SECONDS, 5);
  });

  it("тишина без речи не даёт блоков", () => {
    expect(blocksFromWindows(quiet(60))).toEqual([]);
  });
});

describe("blocksToCut", () => {
  it("плотная речь (≥95%) не режется", () => {
    expect(blocksToCut([{ start: 0, end: 96 }], 100)).toBeNull();
  });

  it("сбой анализа и отсутствие блоков — часть уходит целиком", () => {
    expect(blocksToCut(null, 100)).toBeNull();
    expect(blocksToCut([], 100)).toBeNull();
  });
});

describe("WindowClassifier", () => {
  it("считает мощность на границах чанков, не теряя байты внутри сэмпла", () => {
    const loud = Buffer.alloc(800 * 4);
    for (let index = 0; index < 800; index += 1) loud.writeFloatLE(0.5, index * 4);
    const classifier = new WindowClassifier(-30);
    classifier.push(loud.subarray(0, 1001)); // рвём посреди сэмпла
    classifier.push(loud.subarray(1001));
    classifier.push(Buffer.alloc(800 * 4));
    expect(classifier.finish()).toEqual([true, false]);
  });
});

describe("silence trimming on a generated call-like fixture", () => {
  it("находит блоки вокруг каждой реплики, короткую паузу не режет", async () => {
    const detection = await detectSpeechBlocks(context.fixture);
    expect(detection).not.toBeNull();
    expect(detection?.seconds).toBeCloseTo(TOTAL_SECONDS, 0);
    const blocks = detection?.blocks ?? [];

    // Три блока: [3..15] слитые (пауза 5 с), [45..50], [75..77].
    expect(blocks).toHaveLength(3);
    for (const [from, to] of BURSTS) {
      const covering = blocks.filter((b) => b.start <= from + TOLERANCE && b.end >= to - TOLERANCE);
      expect(covering, `реплика ${String(from)}–${String(to)} не покрыта блоком`).toHaveLength(1);
    }
    const [first, second, third] = blocks;
    expect(Math.abs((first?.start ?? NaN) - (3 - VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);
    expect(Math.abs((first?.end ?? NaN) - (15 + VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);
    expect(Math.abs((second?.start ?? NaN) - (45 - VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);
    expect(Math.abs((second?.end ?? NaN) - (50 + VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);
    expect(Math.abs((third?.start ?? NaN) - (75 - VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);
    expect(Math.abs((third?.end ?? NaN) - (77 + VAD_PADDING_SECONDS))).toBeLessThan(TOLERANCE);

    const kept = blocks.reduce((sum, b) => sum + (b.end - b.start), 0);
    expect(kept).toBeCloseTo(12.7 + 5.7 + 2.7, 0);
  });

  it("режет в файлы с offset на шкале записи: речь не потеряна, таймлайн сходится", async () => {
    const parts = await trimPart(context.fixture);
    expect(parts).not.toBeNull();
    const cut = parts ?? [];
    expect(cut.map((p) => Math.round(p.offset))).toEqual([3, 45, 75]);

    // Из 80 с осталось ~21 с; каждый файл реально существует и не пустой.
    expect(cut.reduce((s, p) => s + p.duration, 0)).toBeCloseTo(21.1, 0);
    for (const part of cut) {
      const info = await stat(part.file);
      expect(info.size).toBeGreaterThan(1024);
    }

    // Каждая реплика лежит внутри ровно одного вырезанного файла, а её абсолютное время
    // (offset файла + момент появления тона в файле) совпадает с исходным: именно это сервер
    // прибавит к таймстампам Whisper, и по нему же таймлайн говорящих найдёт имя.
    for (const [from, to] of BURSTS) {
      const owner = cut.find(
        (p) => p.offset <= from + TOLERANCE && p.offset + p.duration >= to - TOLERANCE,
      );
      expect(owner, `реплика ${String(from)}–${String(to)} не попала ни в один файл`).toBeDefined();
    }
    const firstOfEachFile = cut.map((p) => p.offset + firstSpeechAt(p.file));
    expect(Math.abs((firstOfEachFile[0] ?? 0) - 3)).toBeLessThan(TOLERANCE);
    expect(Math.abs((firstOfEachFile[1] ?? 0) - 45)).toBeLessThan(TOLERANCE);
    expect(Math.abs((firstOfEachFile[2] ?? 0) - 75)).toBeLessThan(TOLERANCE);

    // Внутри первого файла короткая пауза на месте: 7→12 с по-прежнему тишина между двумя репликами.
    const inFirst = windowsOf((cut[0] ?? { file: "" }).file);
    const offsetFirst = cut[0]?.offset ?? 0;
    const at = (t: number): boolean | undefined =>
      inFirst[Math.round((t - offsetFirst) / VAD_WINDOW_SECONDS)];
    expect(at(5)).toBe(true);
    expect(at(9.5)).toBe(false);
    expect(at(13)).toBe(true);
  });

  it("плотная речь и тишина без речи уходят целиком (trimPart → null), мусор — тоже", async () => {
    const dense = path.join(context.directory, "dense.m4a");
    makeFixture(dense, [[0, 30]], 30);
    expect(await trimPart(dense)).toBeNull();

    const silent = path.join(context.directory, "silent.m4a");
    makeFixture(silent, [], 30);
    expect(await trimPart(silent)).toBeNull();

    const garbage = path.join(context.directory, "garbage.m4a");
    await writeFile(garbage, Buffer.from("not an audio file at all"));
    expect(await trimPart(garbage)).toBeNull();
    const names = await readdir(context.directory);
    expect(names.filter((n) => !n.startsWith("part-000") && n.includes(".vad"))).toHaveLength(0);
  });
});
