import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandResult } from "./shell.ts";

const run = vi.hoisted(() =>
  vi.fn<(command: string, argv: readonly string[]) => Promise<CommandResult>>(),
);

vi.mock("./shell.ts", () => ({ run }));

const { measureLoudness, probeAudioEnvironment, probeAudioFile } = await import("./probe.ts");

const ok = (stdout: string, stderr = ""): CommandResult => ({ code: 0, stdout, stderr });
const broken = (): CommandResult => ({ code: 1, stdout: "", stderr: "нет доступа" });

const settings = {
  sinkName: "scriba",
  outputDirectory: "/recordings",
  bitrateKbps: 32,
  runtimeDirectory: "/run/user/1001",
  display: ":99",
};

beforeEach(() => {
  run.mockReset();
});

describe("probeAudioEnvironment", () => {
  it("живой pactl — окружение признаётся годным", async () => {
    run.mockImplementation((_command, argv) => {
      if (argv[0] === "info") return Promise.resolve(ok("Default Sink: scriba"));
      if (argv[2] === "sinks") return Promise.resolve(ok("0\tscriba\tm\ts16le\tRUNNING"));
      return Promise.resolve(ok("0\tscriba.monitor\tm\ts16le\tIDLE"));
    });

    const report = await probeAudioEnvironment(settings);

    expect(report.ok).toBe(true);
    expect(report.monitorSource).toBe("scriba.monitor");
  });

  it("pactl не отвечает — окружение НЕ годно, а не «пустой список, значит порядок»", async () => {
    run.mockResolvedValue(broken());

    const report = await probeAudioEnvironment(settings);

    expect(report.ok).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
  });
});

describe("measureLoudness", () => {
  it("метрики volumedetect из stderr ffmpeg", async () => {
    run.mockResolvedValue(
      ok("", "[Parsed_volumedetect_0] n_samples: 100\nmean_volume: -20.0 dB\nmax_volume: -5.0 dB"),
    );

    await expect(measureLoudness("/out/part-000.m4a")).resolves.toEqual({
      meanDb: -20,
      maxDb: -5,
      samples: 100,
    });
  });

  it("ffmpeg ничего не измерил — null, и это не «тихо»", async () => {
    run.mockResolvedValue(ok("", "Invalid data found when processing input"));

    await expect(measureLoudness("/out/part-000.m4a")).resolves.toBeNull();
  });
});

describe("probeAudioFile", () => {
  const good = JSON.stringify({
    format: { duration: "3.008000", size: "12345" },
    streams: [{ codec_name: "aac", codec_type: "audio" }],
  });

  it("часть открывается сама — отдаёт размер, длину и кодек", async () => {
    run.mockResolvedValue(ok(good));

    await expect(probeAudioFile("/out/part-000.m4a")).resolves.toEqual({
      bytes: 12_345,
      durationSeconds: 3.008,
      codec: "aac",
    });
  });

  it("ffprobe не прочитал файл — null: как самостоятельный файл части нет", async () => {
    run.mockResolvedValue(broken());

    await expect(probeAudioFile("/out/part-000.m4a")).resolves.toBeNull();
  });

  it("ffprobe вернул не-JSON — null, а не падение смоука на разборе", async () => {
    run.mockResolvedValue(ok("не json"));

    await expect(probeAudioFile("/out/part-000.m4a")).resolves.toBeNull();
  });

  it("в файле нет звуковой дорожки — null", async () => {
    run.mockResolvedValue(
      ok(
        JSON.stringify({
          format: { duration: "1", size: "2" },
          streams: [{ codec_type: "video" }],
        }),
      ),
    );

    await expect(probeAudioFile("/out/part-000.m4a")).resolves.toBeNull();
  });
});
