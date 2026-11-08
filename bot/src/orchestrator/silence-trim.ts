/**
 * Обрезка тишины в частях записи бота перед выгрузкой (#869).
 *
 * Whisper тарифицируется по длительности аудио, а на обычной встрече три четверти записи —
 * тишина (замер на созвоне в 78 минут: остаётся 1194 с из 4665). Тот же подход и те же числа,
 * что у `SilenceTrimmer` рекордера (recorder/Sources/SwarmRecorder/SilenceTrimmer.swift):
 * энергия окнами по 50 мс, порог −30 dBFS, разрез только по паузе от 20 с, паддинг 0,35 с,
 * блок короче 0,2 с выбрасывается; речь покрывает ≥95% файла — файл уходит как есть.
 *
 * Порядок реплик держит `offset`: каждый блок несёт реальный старт на шкале записи
 * (`start` части + старт блока в части). Сервер прибавляет его к таймстампам Whisper
 * (`transcribePartInto`: `s.start + p.offset`), а таймлайн говорящих приходит в секундах от
 * начала записи, поэтому `nameAt(timeline, start, end)` сводит их без поправок.
 *
 * Анализ не удался (ffmpeg упал, мусор вместо аудио) — `null`: вызывающий отдаёт часть
 * целиком, речь не теряется ради экономии.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Порог речи, dBFS. Ниже — тишина (как `thresholdDecibels` рекордера).
 */
const VAD_THRESHOLD_DB = -30;
/**
 * Пауза, по которой режем, секунды (как `cutSilence` рекордера).
 */
const VAD_CUT_SECONDS = 20;
/**
 * Запас вокруг блока, чтобы не срезать начало и конец слова.
 */
export const VAD_PADDING_SECONDS = 0.35;
/**
 * Окно анализа энергии, секунды.
 */
export const VAD_WINDOW_SECONDS = 0.05;
/**
 * Блок короче этого не стоит вызова Whisper.
 */
const VAD_MIN_BLOCK_SECONDS = 0.2;
/**
 * Доля речи в части, выше которой её не режем (не перекодируем зря).
 */
const VAD_DENSE_RATIO = 0.95;

const ANALYSIS_SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 4;
const MIN_CUT_PART_SECONDS = 0.1;

export interface SpeechBlock {
  readonly start: number;
  readonly end: number;
}

export interface TrimOptions {
  readonly thresholdDecibels?: number;
  readonly cutSeconds?: number;
}

/**
 * Свести признаки окон (true — речь) в блоки: блок рвётся, когда подряд тишины не меньше
 * `cutSeconds`; затем паддинг и слияние блоков, перекрывшихся после него.
 */
export function blocksFromWindows(
  speechFlags: readonly boolean[],
  cutSeconds: number = VAD_CUT_SECONDS,
): SpeechBlock[] {
  const window = VAD_WINDOW_SECONDS;
  const cutWindows = Math.ceil(cutSeconds / window);
  const raw: SpeechBlock[] = [];
  let blockStart: number | null = null;
  let lastSpeech = -1;
  let silenceRun = 0;

  for (const [index, speech] of speechFlags.entries()) {
    if (speech) {
      blockStart ??= index;
      lastSpeech = index;
      silenceRun = 0;
      continue;
    }
    silenceRun += 1;
    if (blockStart !== null && silenceRun >= cutWindows) {
      raw.push({ start: blockStart * window, end: (lastSpeech + 1) * window });
      blockStart = null;
    }
  }
  if (blockStart !== null) {
    raw.push({ start: blockStart * window, end: (lastSpeech + 1) * window });
  }

  const total = speechFlags.length * window;
  const padded: SpeechBlock[] = [];
  for (const block of raw) {
    const start = Math.max(0, block.start - VAD_PADDING_SECONDS);
    const end = Math.min(total, block.end + VAD_PADDING_SECONDS);
    const last = padded.at(-1);
    if (last !== undefined && start <= last.end) {
      padded[padded.length - 1] = { start: last.start, end: Math.max(last.end, end) };
    } else {
      padded.push({ start, end });
    }
  }
  return padded;
}

/**
 * Признаки речи по окнам из потока float32 mono: окно «речь», если средняя мощность не ниже
 * порога (сравниваем квадраты, без логарифма в горячем цикле).
 */
export class WindowClassifier {
  private sum = 0;

  private count = 0;

  private carry: Buffer = Buffer.alloc(0);

  private readonly windowSamples = Math.round(VAD_WINDOW_SECONDS * ANALYSIS_SAMPLE_RATE);

  private readonly powerThreshold: number;

  private readonly flags: boolean[] = [];

  constructor(thresholdDecibels: number) {
    this.powerThreshold = (10 ** (thresholdDecibels / 20)) ** 2;
  }

  private flushWindow(): void {
    if (this.count > 0) this.flags.push(this.sum / this.count >= this.powerThreshold);
    this.sum = 0;
    this.count = 0;
  }

  push(chunk: Buffer): void {
    const data = this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    const usable = data.length - (data.length % BYTES_PER_SAMPLE);
    for (let at = 0; at < usable; at += BYTES_PER_SAMPLE) {
      const sample = data.readFloatLE(at);
      this.sum += sample * sample;
      this.count += 1;
      if (this.count >= this.windowSamples) this.flushWindow();
    }
    this.carry = data.subarray(usable);
  }

  finish(): boolean[] {
    this.flushWindow();
    return this.flags;
  }
}

interface FfmpegResult {
  readonly code: number | null;
  readonly stderr: string;
}

async function runFfmpeg(
  argv: readonly string[],
  onStdout?: (chunk: Buffer) => void,
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- ffmpeg в PATH — контракт образа блока container
    const child = spawn("ffmpeg", [...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      stderr = (stderr + text).slice(-2000);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      onStdout?.(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

export interface Detection {
  readonly blocks: readonly SpeechBlock[];
  /**
   * Длина файла по декодированному потоку (с точностью до окна), секунды.
   */
  readonly seconds: number;
}

/**
 * Речевые блоки файла, секунды от его начала. `null` — анализ не удался.
 */
export async function detectSpeechBlocks(
  file: string,
  options: TrimOptions = {},
): Promise<Detection | null> {
  const classifier = new WindowClassifier(options.thresholdDecibels ?? VAD_THRESHOLD_DB);
  let result: FfmpegResult;
  try {
    result = await runFfmpeg(
      [
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(ANALYSIS_SAMPLE_RATE),
        "-f",
        "f32le",
        "-",
      ],
      (chunk) => {
        classifier.push(chunk);
      },
    );
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  const flags = classifier.finish();
  return {
    blocks: blocksFromWindows(flags, options.cutSeconds),
    seconds: flags.length * VAD_WINDOW_SECONDS,
  };
}

export interface TrimmedPart {
  readonly file: string;
  /**
   * Старт блока от начала части, секунды (к нему вызывающий прибавляет старт части).
   */
  readonly offset: number;
  readonly duration: number;
}

/**
 * Решение по части: `null` — отдать как есть (анализ не удался, речи нет вовсе или она плотная),
 * иначе — блоки речи, которые стоит вырезать. Тишина целиком не выбрасывается, как и у рекордера
 * на системной дорожке: пустой вердикт анализа не повод терять речь собеседников.
 */
export function blocksToCut(
  blocks: readonly SpeechBlock[] | null,
  fullSeconds: number,
): SpeechBlock[] | null {
  if (blocks === null || blocks.length === 0) return null;
  const speech = blocks.reduce((sum, block) => sum + (block.end - block.start), 0);
  if (fullSeconds > 0 && speech >= fullSeconds * VAD_DENSE_RATIO) return null;
  const kept = blocks.filter((block) => block.end - block.start >= VAD_MIN_BLOCK_SECONDS);
  return kept.length === 0 ? null : kept;
}

/**
 * Вырезать речевые блоки части в отдельные m4a (без перекодирования, как нарезка рекордера).
 * `null` — часть уходит целиком. Файлы блоков кладутся рядом: `<имя части>.vad<N>.m4a`.
 */
export async function trimPart(
  file: string,
  options: TrimOptions = {},
): Promise<TrimmedPart[] | null> {
  const detection = await detectSpeechBlocks(file, options);
  if (detection === null) return null;
  const total = detection.seconds;
  const cut = blocksToCut(detection.blocks, total);
  if (cut === null) return null;

  const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
  const out: TrimmedPart[] = [];
  for (const [index, block] of cut.entries()) {
    const end = Math.min(block.end, total);
    const duration = end - block.start;
    if (duration < MIN_CUT_PART_SECONDS) continue;
    const target = `${base}.vad${String(index)}.m4a`;
    const result = await runFfmpeg([
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(block.start),
      "-t",
      String(duration),
      "-i",
      file,
      "-vn",
      "-c:a",
      "copy",
      "-f",
      "ipod",
      target,
    ]);
    if (result.code !== 0) {
      await Promise.all(
        [...out.map((part) => part.file), target].map(async (made) => rm(made, { force: true })),
      );
      return null;
    }
    out.push({ file: target, offset: block.start, duration });
  }
  return out.length === 0 ? null : out;
}
