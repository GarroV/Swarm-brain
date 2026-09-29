import { describe, expect, it } from "vitest";

import { SILENCE_MAX_VOLUME_DB, judgeLoudness, parseVolumeDetect } from "./loudness.ts";

const LOUD = [
  "[Parsed_volumedetect_0 @ 0x5f0] n_samples: 480000",
  "[Parsed_volumedetect_0 @ 0x5f0] mean_volume: -23.5 dB",
  "[Parsed_volumedetect_0 @ 0x5f0] max_volume: -3.2 dB",
  "[Parsed_volumedetect_0 @ 0x5f0] histogram_3db: 12",
].join("\n");

const DIGITAL_SILENCE = [
  "[Parsed_volumedetect_0 @ 0x5f0] n_samples: 480000",
  "[Parsed_volumedetect_0 @ 0x5f0] mean_volume: -91.0 dB",
  "[Parsed_volumedetect_0 @ 0x5f0] max_volume: -91.0 dB",
].join("\n");

const FLOAT_SILENCE = [
  "[Parsed_volumedetect_0 @ 0x5f0] n_samples: 480000",
  "[Parsed_volumedetect_0 @ 0x5f0] mean_volume: -inf dB",
  "[Parsed_volumedetect_0 @ 0x5f0] max_volume: -inf dB",
].join("\n");

describe("parseVolumeDetect", () => {
  it("достаёт mean, max и число сэмплов", () => {
    expect(parseVolumeDetect(LOUD)).toEqual({ meanDb: -23.5, maxDb: -3.2, samples: 480_000 });
  });

  it("минус бесконечность у чистой тишины читается как -Infinity, а не как NaN", () => {
    const stats = parseVolumeDetect(FLOAT_SILENCE);

    expect(stats?.maxDb).toBe(-Infinity);
    expect(stats?.meanDb).toBe(-Infinity);
  });

  it("нет строк volumedetect — null, а не выдуманные нули", () => {
    expect(parseVolumeDetect("ffmpeg version 7.1\nInput #0, wav")).toBeNull();
    expect(parseVolumeDetect("")).toBeNull();
  });
});

describe("judgeLoudness", () => {
  it("живой звук проходит", () => {
    const verdict = judgeLoudness(parseVolumeDetect(LOUD));

    expect(verdict.ok).toBe(true);
  });

  it("цифровая тишина -91 dB — отказ, и в причине названы и значение, и порог", () => {
    const verdict = judgeLoudness(parseVolumeDetect(DIGITAL_SILENCE));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("-91");
    expect(verdict.reason).toContain(String(SILENCE_MAX_VOLUME_DB));
  });

  it("причина отказа называет вероятный источник — --mute-audio или чужой sink", () => {
    const verdict = judgeLoudness(parseVolumeDetect(DIGITAL_SILENCE));

    expect(verdict.reason).toContain("--mute-audio");
  });

  it("-inf тоже тишина, а не «метрики нет»", () => {
    expect(judgeLoudness(parseVolumeDetect(FLOAT_SILENCE)).ok).toBe(false);
  });

  it("нет метрик — отказ, а не молчаливое «сойдёт»", () => {
    const verdict = judgeLoudness(null);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("volumedetect");
  });

  it("ноль сэмплов — отказ: файл есть, звука в нём нет", () => {
    const verdict = judgeLoudness({ meanDb: -10, maxDb: -1, samples: 0 });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("сэмпл");
  });

  it("порог можно поднять, и тогда прежде проходивший звук уже не проходит", () => {
    const stats = parseVolumeDetect(LOUD);

    expect(judgeLoudness(stats, { silenceMaxVolumeDb: -1 }).ok).toBe(false);
  });
});
