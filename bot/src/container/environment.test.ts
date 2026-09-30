import { describe, expect, it } from "vitest";

import { readSettings } from "./environment.ts";

describe("readSettings", () => {
  it("пустое окружение даёт рабочие умолчания", () => {
    const settings = readSettings({});

    expect(settings.sinkName).toBe("scriba");
    expect(settings.outputDirectory).toBe("/recordings");
    expect(settings.bitrateKbps).toBe(32);
    expect(settings.runtimeDirectory).toBeUndefined();
    expect(settings.display).toBeUndefined();
  });

  it("значения из окружения перекрывают умолчания", () => {
    const settings = readSettings({
      SCRIBA_SINK_NAME: "scriba-b",
      SCRIBA_OUTPUT_DIR: "/out",
      SCRIBA_AUDIO_BITRATE_KBPS: "64",
      XDG_RUNTIME_DIR: "/run/user/1001",
      DISPLAY: ":99",
    });

    expect(settings).toEqual({
      sinkName: "scriba-b",
      outputDirectory: "/out",
      bitrateKbps: 64,
      runtimeDirectory: "/run/user/1001",
      display: ":99",
    });
  });

  it("пустая строка читается как «не задано», а не как пустое имя sink", () => {
    const settings = readSettings({ SCRIBA_SINK_NAME: "  ", XDG_RUNTIME_DIR: "" });

    expect(settings.sinkName).toBe("scriba");
    expect(settings.runtimeDirectory).toBeUndefined();
  });

  it("нечисловой битрейт — отказ при старте, а не «0k» в аргументах ffmpeg", () => {
    expect(() => readSettings({ SCRIBA_AUDIO_BITRATE_KBPS: "быстро" })).toThrow(/BITRATE/);
    expect(() => readSettings({ SCRIBA_AUDIO_BITRATE_KBPS: "0" })).toThrow(/BITRATE/);
  });
});
