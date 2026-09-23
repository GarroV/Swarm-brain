/**
 * Повтор с задержкой — то, чем встреча переживает короткий сбой сети.
 *
 * Бэкофф с полным джиттером: задержка = случайное из `[exp/2, exp]`, где `exp = base * 2^i`
 * с потолком. Джиттер здесь не украшение: без него несколько ботов, упавших на одном
 * всплеске 429, вернутся к серверу одновременно и повторят тот же всплеск.
 *
 * `Retry-After` сильнее бэкоффа: если сервер сказал, сколько ждать, спорить с ним нечем.
 *
 * Сон и случайность внедряются снаружи — иначе тест на пять попыток идёт полминуты
 * настоящего времени, и его перестают гонять.
 */
import { isTransient, SwarmHttpError } from "./errors.ts";

export interface RetryAttemptInfo {
  /**
   * Номер неудавшейся попытки, начиная с 1.
   */
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: unknown;
}

export interface RetryOptions {
  /**
   * Сколько попыток всего, считая первую.
   */
  readonly attempts?: number;
  readonly baseMs?: number;
  readonly maxBackoffMs?: number;
  /**
   * Потолок на `Retry-After`: сервер может попросить и час — столько мы не ждём.
   */
  readonly maxRetryAfterMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Источник случайности для джиттера: `[0, 1)`.
   */
  readonly random?: () => number;
  /**
   * Зовётся перед каждым ожиданием — чтобы сбой было видно в логе, а не только в итоге.
   */
  readonly onRetry?: (info: RetryAttemptInfo) => void;
}

const DEFAULTS = {
  attempts: 5,
  baseMs: 1000,
  maxBackoffMs: 30_000,
  maxRetryAfterMs: 60_000,
} as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Полный джиттер: `random(exp/2 … exp)`, где `exp` растёт вдвое до потолка.
 */
export function backoffMs(attemptIndex: number, options: RetryOptions = {}): number {
  const base = options.baseMs ?? DEFAULTS.baseMs;
  const cap = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const random = options.random ?? Math.random;
  const exp = Math.min(base * 2 ** attemptIndex, cap);
  return Math.round(exp / 2 + random() * (exp / 2));
}

function delayFor(attemptIndex: number, error: unknown, options: RetryOptions): number {
  if (
    error instanceof SwarmHttpError &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs > 0
  ) {
    return Math.min(error.retryAfterMs, options.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs);
  }
  return backoffMs(attemptIndex, options);
}

/**
 * Повторяет операцию, пока сбой временный и попытки не кончились. Постоянный сбой бросается
 * сразу, без ожидания: его повтор — это только задержка перед тем же ответом.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransient(error)) throw error;
      lastError = error;
      if (index === attempts - 1) break;
      const delayMs = delayFor(index, error, options);
      options.onRetry?.({ attempt: index + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
