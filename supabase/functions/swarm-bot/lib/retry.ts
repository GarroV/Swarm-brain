// Повтор операции, которая может отвалиться разово: сетевой сбой, 504 от шлюза Supabase.
// Живой повод (12.09.2026, issue #305): утренний свод упал от одного 504 и пропал за сутки целиком.

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface RetryOptions {
  /** Сколько всего попыток, включая первую. */
  attempts?: number;
  /** Задержка перед 2-й попыткой; дальше удваивается. */
  baseDelayMs?: number;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T> | T, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}
