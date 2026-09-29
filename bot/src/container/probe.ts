/**
 * Замеры на живом контейнере: что реально в sink'е и что реально в файле.
 *
 * Разбор и вердикты живут в `audio.ts` и `loudness.ts` и проверены тестами; здесь только
 * вызовы pactl, ffmpeg и ffprobe вокруг них.
 */
import { type AudioEnvironmentReport, inspectAudioEnvironment } from "./audio.ts";
import type { ContainerSettings } from "./environment.ts";
import { type VolumeStats, parseVolumeDetect } from "./loudness.ts";
import { run } from "./shell.ts";

export interface AudioFileFacts {
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly codec: string;
}

export async function probeAudioEnvironment(
  settings: ContainerSettings,
): Promise<AudioEnvironmentReport> {
  const pactl = async (argv: readonly string[]): Promise<string> => {
    const result = await run("pactl", argv);
    return result.code === 0 ? result.stdout : "";
  };

  const [sinksShort, sourcesShort, info] = await Promise.all([
    pactl(["list", "short", "sinks"]),
    pactl(["list", "short", "sources"]),
    pactl(["info"]),
  ]);

  return inspectAudioEnvironment({
    sinkName: settings.sinkName,
    sinksShort,
    sourcesShort,
    info,
    runtimeDirectory: settings.runtimeDirectory,
  });
}

/**
 * Громкость файла по фильтру ffmpeg `volumedetect`. `null` значит «измерить не удалось» —
 * это отдельный исход от «тихо», и путать их нельзя: вердикт выносит `judgeLoudness`.
 */
export async function measureLoudness(file: string): Promise<VolumeStats | null> {
  const result = await run("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-i",
    file,
    "-map",
    "0:a",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);

  return parseVolumeDetect(result.stderr);
}

/**
 * Открывается ли часть сама по себе. `null` — ffprobe её не прочитал, то есть как
 * самостоятельный файл она не существует, чем бы ни был занят остальной конвейер.
 */
export async function probeAudioFile(file: string): Promise<AudioFileFacts | null> {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size",
    "-show_entries",
    "stream=codec_name,codec_type",
    "-of",
    "json",
    file,
  ]);
  if (result.code !== 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  const payload = parsed as {
    format?: { duration?: string; size?: string };
    streams?: { codec_name?: string; codec_type?: string }[];
  };
  const audio = payload.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(payload.format?.duration ?? NaN);
  const bytes = Number(payload.format?.size ?? NaN);

  if (audio?.codec_name === undefined || Number.isNaN(duration) || Number.isNaN(bytes)) {
    return null;
  }

  return { bytes, durationSeconds: duration, codec: audio.codec_name };
}
