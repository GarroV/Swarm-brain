/**
 * Вердикт «это запись или это тишина».
 *
 * Принцип проекта: громкий отказ важнее тихой работы. Контейнер, который пишет тишину,
 * неотличим от работающего, пока не станет поздно, поэтому смоук записи обязан падать на
 * тишине и внятно говорить почему. Разбор метрик ffmpeg и сам порог живут здесь — один
 * источник истины и для смоука, и для проверок при старте.
 */

/**
 * Метрики фильтра ffmpeg `volumedetect`.
 */
export interface VolumeStats {
  readonly meanDb: number;
  readonly maxDb: number;
  readonly samples: number;
}

export interface LoudnessVerdict {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Порог тишины. Цифровая тишина 16 бит даёт −91 dB, живая речь в звонке — от −30 до −3 dB.
 * −50 dB лежит между ними с запасом в обе стороны: тихого собеседника не отбракует,
 * заглушённый Chromium пропустить не сможет.
 */
export const SILENCE_MAX_VOLUME_DB = -50;

const numberFrom = (raw: string): number => (raw === "-inf" ? -Infinity : Number(raw));

export function parseVolumeDetect(stderr: string): VolumeStats | null {
  const mean = /mean_volume:[ \t]*(-?inf|-?\d+(?:\.\d+)?)[ \t]*dB/.exec(stderr);
  const max = /max_volume:[ \t]*(-?inf|-?\d+(?:\.\d+)?)[ \t]*dB/.exec(stderr);
  if (mean?.[1] === undefined || max?.[1] === undefined) return null;

  const samples = /n_samples:[ \t]*(\d+)/.exec(stderr);

  return {
    meanDb: numberFrom(mean[1]),
    maxDb: numberFrom(max[1]),
    samples: samples?.[1] === undefined ? 0 : Number(samples[1]),
  };
}

export function judgeLoudness(
  stats: VolumeStats | null,
  options: { readonly silenceMaxVolumeDb?: number } = {},
): LoudnessVerdict {
  if (stats === null) {
    return {
      ok: false,
      reason:
        "ffmpeg не выдал ни mean_volume, ни max_volume: фильтр volumedetect не отработал — " +
        "громкость не измерена, значит запись НЕ подтверждена",
    };
  }

  if (stats.samples === 0) {
    return {
      ok: false,
      reason: "в записи ноль сэмплов: файл создан, но звука в нём нет вообще",
    };
  }

  const threshold = options.silenceMaxVolumeDb ?? SILENCE_MAX_VOLUME_DB;
  if (stats.maxDb < threshold) {
    return {
      ok: false,
      reason:
        `запись — тишина: max_volume ${String(stats.maxDb)} dB при пороге ${String(threshold)} dB ` +
        `(mean_volume ${String(stats.meanDb)} dB). Вероятные причины по убыванию: Chromium стартовал ` +
        "с --mute-audio (аргумент Playwright по умолчанию, снимается через ignoreDefaultArgs); " +
        "звук ушёл в чужой sink (не сделан set-default-sink); запись велась не с monitor-source",
    };
  }

  return {
    ok: true,
    reason: `звук есть: max_volume ${String(stats.maxDb)} dB, mean_volume ${String(stats.meanDb)} dB`,
  };
}
