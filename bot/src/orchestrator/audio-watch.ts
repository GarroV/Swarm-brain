/**
 * Сторож тишины: бот в звонке с людьми, а в записи цифровая тишина — сказать владельцу сразу,
 * а не узнать по пустым тезисам после встречи (#861, решение владельца 08.10.2026).
 *
 * Условие: кроме бота в звонке есть люди (`alone === false`) и `silentMs` подряд замер звука
 * тише порога. Одно предупреждение на встречу и одно «звук вернулся», если вернётся; после этого
 * сторож молчит до конца встречи. Нет замера или нет сигнала об участниках — отсчёт сбрасывается:
 * тревога только по доказанной тишине при людях.
 */

export type AudioAlert = "silent" | "back";

export interface AudioSample {
  /**
  Тише порога; `null` — замер не удался.
  */
  readonly silent: boolean | null;
  /**
  Один ли бот; `null` — сигнала нет.
  */
  readonly alone: boolean | null;
}

export class SilenceWatch {
  readonly #silentMs: number;
  #silentSince: number | null = null;
  #alerted = false;
  #done = false;

  constructor(silentMs: number) {
    this.#silentMs = silentMs;
  }

  observe(sample: AudioSample, nowMs: number): AudioAlert | null {
    if (this.#done || sample.silent === null) return null;
    if (!sample.silent) {
      this.#silentSince = null;
      if (!this.#alerted) return null;
      this.#done = true;
      return "back";
    }
    if (this.#alerted) return null;
    if (sample.alone !== false) {
      this.#silentSince = null;
      return null;
    }
    this.#silentSince ??= nowMs;
    if (nowMs - this.#silentSince < this.#silentMs) return null;
    this.#alerted = true;
    return "silent";
  }
}
