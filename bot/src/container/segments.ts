/**
 * Нарезка записи на части, которые примет существующий конвейер Swarm.
 *
 * Два ограничения, и оба настоящие:
 *  - `meeting-ingest` отбивает часть больше 25 МБ (`OPENAI_AUDIO_MAX_BYTES`);
 *  - `meeting-process` добивает длинную встречу по куску за тик, и часть длиннее 15 минут
 *    не влезает в бюджет одного тика — рекордер по той же причине режет по 900 с.
 *
 * У muxer'а `segment` нет нарезки по размеру в байтах, поэтому размер пересчитывается в
 * секунды через битрейт, и из двух ограничений берётся строгое.
 */

/**
 * Жёсткий предел сервера: `OPENAI_AUDIO_MAX_BYTES` в `meeting-ingest`.
 */
export const INGEST_PART_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Цель с запасом — как `Segmenter.splitTargetBytes` у рекордера.
 */
export const PART_TARGET_BYTES = 20 * 1024 * 1024;

/**
 * Бюджет одного тика `meeting-process` — как `Segmenter.maxPartSeconds` у рекордера.
 */
export const PART_MAX_SECONDS = 900;

const BITS_IN_BYTE = 8;

export interface RecordArgumentsInput {
  /**
   * monitor-source null-sink'а: `<sink>.monitor`.
   */
  readonly monitorSource: string;
  /**
   * Шаблон имени части со счётчиком, например `/out/part-%03d.m4a`.
   */
  readonly outputPattern: string;
  readonly bitrateKbps: number;
  readonly segmentSeconds: number;
  /**
   * Сколько секунд писать; без него запись идёт до остановки процесса — так пишется встреча.
   * Ограничение нужно смоуку, которому надо закончить самому.
   */
  readonly durationSeconds?: number;
  /**
   * Куда сложить список частей со смещениями; без него список не пишется.
   */
  readonly segmentListPath?: string;
  readonly channels?: number;
  readonly sampleRate?: number;
}

function bytesPerSecond(bitrateKbps: number): number {
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    throw new Error(`битрейт должен быть положительным, получено: ${String(bitrateKbps)}`);
  }
  return (bitrateKbps * 1000) / BITS_IN_BYTE;
}

export function expectedPartBytes(bitrateKbps: number, seconds: number): number {
  return bytesPerSecond(bitrateKbps) * seconds;
}

export function segmentSeconds(
  bitrateKbps: number,
  options: { readonly targetBytes?: number; readonly maxSeconds?: number } = {},
): number {
  const targetBytes = options.targetBytes ?? PART_TARGET_BYTES;
  const maxSeconds = options.maxSeconds ?? PART_MAX_SECONDS;

  const bySize = Math.floor(targetBytes / bytesPerSecond(bitrateKbps));
  if (bySize < 1) {
    throw new Error(
      `при битрейте ${String(bitrateKbps)} кбит/с в ${String(targetBytes)} байт не влезает и ` +
        "секунды записи — такой поток конвейер не примет",
    );
  }

  return Math.min(bySize, maxSeconds);
}

export function buildRecordArguments(input: RecordArgumentsInput): string[] {
  if (input.monitorSource === "") {
    throw new Error("не задан monitor-source: запись ушла бы в никуда");
  }
  if (!input.outputPattern.includes("%")) {
    throw new Error(
      `шаблон «${input.outputPattern}» без счётчика вида %03d: ffmpeg перезапишет каждую часть следующей`,
    );
  }
  if (!Number.isSafeInteger(input.segmentSeconds) || input.segmentSeconds < 1) {
    throw new Error(
      `длина сегмента должна быть целым числом секунд, получено: ${String(input.segmentSeconds)}`,
    );
  }

  const segmentList =
    input.segmentListPath === undefined
      ? []
      : ["-segment_list", input.segmentListPath, "-segment_list_type", "csv"];

  const duration = input.durationSeconds === undefined ? [] : ["-t", String(input.durationSeconds)];

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-f",
    "pulse",
    "-i",
    input.monitorSource,
    ...duration,
    // Одна сведённая дорожка: кто говорит, приносит адаптер площадки таймлайном (решение D008).
    "-ac",
    String(input.channels ?? 1),
    "-ar",
    String(input.sampleRate ?? 48_000),
    "-c:a",
    "aac",
    "-b:a",
    `${String(input.bitrateKbps)}k`,
    "-f",
    "segment",
    "-segment_time",
    String(input.segmentSeconds),
    // По умолчанию выключен: без него у второй и следующих частей время начинается не с нуля,
    // и плеер (а за ним и транскрибация) видит дыру в начале файла.
    "-reset_timestamps",
    "1",
    "-segment_format",
    "ipod",
    ...segmentList,
    input.outputPattern,
  ];
}
