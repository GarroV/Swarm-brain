/**
 * Повтор захода в звонок при сбое загрузки страницы. Сбой по существу (не впустили, комната
 * закрыта, вход слетел) приходит не исключением захода, а исходом двери, и сюда не попадает.
 * Правило общее для Meet и Контур.Толка: оба адаптера открывают страницу через `page.goto`.
 */

/**
 * Сколько всего попыток захода, считая первую.
 */
export const JOIN_MAX_ATTEMPTS = 3;
/**
 * Пауза между попытками: даёт сети или Meet прийти в себя.
 */
export const JOIN_RETRY_PAUSE_MS = 7000;

/**
 * Признаки сбоя загрузки: таймаут навигации Playwright, сетевая ошибка Chromium (`net::ERR_*`),
 * обрыв соединения, закрытая посреди захода страница. Всё остальное — отказ по существу.
 */
const TRANSIENT_LOAD_PATTERNS: readonly RegExp[] = [
  /page\.goto: Timeout/u,
  /Timeout \d+ms exceeded.*navigating/su,
  /net::ERR_/u,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/u,
  /Target (?:page, context or browser|closed)/u,
];

export function isTransientLoadError(message: string): boolean {
  return TRANSIENT_LOAD_PATTERNS.some((pattern) => pattern.test(message));
}
