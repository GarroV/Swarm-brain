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

  /**
  Сколько миллисекунд бот уже один — для лога и уведомления владельцу.
  */
  aloneForMs(nowMs: number): number {
    return this.#since === null ? 0 : nowMs - this.#since;
  }
}

export interface AloneWatchOptions {
  /**
  Тристатный опрос: `true` — один, `false` — не один, `null` — сигнала нет.
  */
  readonly probe: () => Promise<boolean | null>;
  /**
  Что делать, когда порог выдержан. В боте это `leave`.
  */
  readonly onLeave: () => Promise<void>;
  readonly thresholdMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
  /**
  Внешний выключатель: встреча кончилась по другой причине — сторож уходит.
  */
  readonly stopped?: () => boolean;
}

const DEFAULT_ALONE_POLL_MS = 5000;

/**
 * Сторож одиночества: опрашивает звонок и выходит, когда бот пробыл один дольше порога.
 * Часы и ожидание — параметры, поэтому правило проверяется тестом за миллисекунды,
 * а не двумя минутами реального ожидания.
 *
 * Возвращает `true`, если выход состоялся.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- имя описывает действие сторожа, не предикат
export async function watchAlone(options: AloneWatchOptions): Promise<boolean> {
  const thresholdMs = options.thresholdMs ?? ALONE_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_ALONE_POLL_MS;
  const now = options.now ?? ((): number => Date.now());
  const wait =
    options.sleep ??
    (async (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const log = options.log ?? ((): void => undefined);
  const timer = new AloneTimer(thresholdMs);

  while (options.stopped?.() !== true) {
    const alone = await options.probe();

    if (timer.observe(alone, now())) {
      log(`один в звонке дольше ${String(thresholdMs)} мс — выходим`);
      await options.onLeave();
      return true;
    }

    await wait(pollMs);
  }

  return false;
}
