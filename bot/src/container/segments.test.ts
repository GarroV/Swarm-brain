import { describe, expect, it } from "vitest";

import {
  INGEST_PART_MAX_BYTES,
  PART_MAX_SECONDS,
  PART_TARGET_BYTES,
  buildRecordArguments,
  expectedPartBytes,
  segmentSeconds,
} from "./segments.ts";

describe("segmentSeconds", () => {
  it("на речевом битрейте ограничение даёт бюджет одного тика обработки, а не размер", () => {
    // 32 кбит/с — 4000 байт/с: 20 МиБ хватило бы на полтора часа, но часть обязана
    // влезать в один тик meeting-process (900 с), иначе воркер не добьёт её.
    expect(segmentSeconds(32)).toBe(PART_MAX_SECONDS);
  });

  it("на высоком битрейте ограничение даёт размер", () => {
    // 1000 кбит/с — 125 000 байт/с: 20 МиБ кончаются за 167 с, раньше 900.
    expect(segmentSeconds(1000)).toBe(167);
  });

  it("часть никогда не перерастает жёсткий лимит сервера ни на одном битрейте", () => {
    for (const bitrate of [16, 24, 32, 64, 128, 256, 512, 1024, 4096]) {
      expect(expectedPartBytes(bitrate, segmentSeconds(bitrate))).toBeLessThanOrEqual(
        INGEST_PART_MAX_BYTES,
      );
    }
  });

  it("запас до жёсткого лимита реальный: цель ниже предела", () => {
    expect(PART_TARGET_BYTES).toBeLessThan(INGEST_PART_MAX_BYTES);
  });

  it("нулевой и отрицательный битрейт — отказ, а не деление на ноль", () => {
    expect(() => segmentSeconds(0)).toThrow(/битрейт/i);
    expect(() => segmentSeconds(-5)).toThrow(/битрейт/i);
  });

  it("битрейт, при котором в бюджет не влезает и секунда, — отказ, а не нулевая нарезка", () => {
    expect(() => segmentSeconds(1_000_000)).toThrow(/секунд/i);
  });
});

describe("buildRecordArguments", () => {
  const argv = buildRecordArguments({
    monitorSource: "scriba.monitor",
    outputPattern: "/out/part-%03d.m4a",
    bitrateKbps: 32,
    segmentSeconds: 900,
  });

  const flagValue = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  it("читает именно monitor-source нашего sink через pulse", () => {
    expect(flagValue("-f")).toBe("pulse");
    expect(flagValue("-i")).toBe("scriba.monitor");
  });

  it("режет muxer'ом segment по времени", () => {
    expect(argv).toContain("segment");
    expect(flagValue("-segment_time")).toBe("900");
  });

  it("reset_timestamps выставлен явно — по умолчанию он выключен", () => {
    expect(flagValue("-reset_timestamps")).toBe("1");
  });

  it("формат частей — AAC в m4a, тот же, что принимает meeting-ingest", () => {
    expect(flagValue("-c:a")).toBe("aac");
    expect(flagValue("-b:a")).toBe("32k");
    expect(flagValue("-segment_format")).toBe("ipod");
    expect(argv.at(-1)).toBe("/out/part-%03d.m4a");
  });

  it("звук сводится в одну дорожку — решение D008, дорожек на участника нет", () => {
    expect(flagValue("-ac")).toBe("1");
  });

  it("список частей со смещениями пишется, когда его попросили", () => {
    const withList = buildRecordArguments({
      monitorSource: "scriba.monitor",
      outputPattern: "/out/part-%03d.m4a",
      bitrateKbps: 32,
      segmentSeconds: 900,
      segmentListPath: "/out/parts.csv",
    });

    expect(withList).toContain("-segment_list");
    expect(withList).toContain("/out/parts.csv");
  });

  it("нецелая длина сегмента — отказ: ffmpeg молча округлит и части разъедутся", () => {
    expect(() =>
      buildRecordArguments({
        monitorSource: "scriba.monitor",
        outputPattern: "/out/part-%03d.m4a",
        bitrateKbps: 32,
        segmentSeconds: 12.5,
      }),
    ).toThrow(/цел/i);
  });

  it("пустое имя monitor-source — отказ: запись ушла бы в никуда", () => {
    expect(() =>
      buildRecordArguments({
        monitorSource: "",
        outputPattern: "/out/part-%03d.m4a",
        bitrateKbps: 32,
        segmentSeconds: 900,
      }),
    ).toThrow(/monitor/i);
  });

  it("шаблон без счётчика — отказ: ffmpeg перезапишет часть частью", () => {
    expect(() =>
      buildRecordArguments({
        monitorSource: "scriba.monitor",
        outputPattern: "/out/part.m4a",
        bitrateKbps: 32,
        segmentSeconds: 900,
      }),
    ).toThrow(/%/);
  });
});
