/**
 * Правило «два минуты один в звонке — выходим» (спека: «Бот остался в звонке один → вышел
 * через 2 минуты»). Часы приходят снаружи: правило проверяется тестом, а не ожиданием.
 */

export const ALONE_TIMEOUT_MS = 120_000;

export class AloneTimer {
  readonly #thresholdMs: number;
  #since: number | null = null;

  constructor(thresholdMs: number = ALONE_TIMEOUT_MS) {
    this.#thresholdMs = thresholdMs;
  }

  /**
   * Принимает очередное наблюдение и говорит, пора ли выходить.
   * `alone === null` — сигнал не прочитался; отсчёт сбрасывается, потому что уйти
   * из живой встречи по непрочитанному сигналу дороже, чем постоять лишнее.
   */
  observe(alone: boolean | null, nowMs: number): boolean {
    if (alone !== true) {
      this.#since = null;
      return false;
    }

    this.#since ??= nowMs;
    return nowMs - this.#since >= this.#thresholdMs;
  }

  /** Сколько миллисекунд бот уже один — для лога и уведомления владельцу. */
  aloneForMs(nowMs: number): number {
    return this.#since === null ? 0 : nowMs - this.#since;
  }
}
