// Один путь для вызовов внешних сервисов (OpenAI, Telegram, Google, Granola, Read.ai).
//
// Зачем: голый `fetch()` не имеет срока. Повисший ответ держит функцию до потолка среды, а в
// обработке встреч — ещё и переживает лиз: воркер считается живым, пока висит мёртвый вызов.
// Здесь у каждого запроса есть срок, сбой пишется в лог одинаково и без секретов, а повтор
// делается только там, где он безопасен.
//
// Контракт:
// - срок `timeoutMs` обязателен и покрывает и ожидание ответа, и чтение тела;
// - `signal` вызывающего (например, лиз потерян) прерывает и запрос, и паузу между попытками —
//   и тогда пробрасывается ЕГО причина, а не наша ошибка;
// - не-2xx ответ возвращается вызывающему (тело ему нужно для разбора ошибки), но пишется в лог;
// - истёкший срок и обрыв сети — `ExternalFetchError`;
// - повтор: GET/HEAD — по умолчанию; всё остальное — только по явному `retry` (запрос, который
//   изменяет состояние, повторённый вслепую, мог уже выполниться — например, сообщение ушло);
// - повторяются 429, 5xx и обрыв сети; истёкший срок не повторяется — бюджет времени уже сожжён.

export const TELEGRAM_TIMEOUT_MS = 10_000; // sendMessage, правка сообщений, getMe, getFile
export const TELEGRAM_UPLOAD_TIMEOUT_MS = 60_000; // sendDocument / sendPhoto с файлом
export const TELEGRAM_FILE_TIMEOUT_MS = 60_000; // скачивание файла с api.telegram.org/file (до 20 МБ)
export const OPENAI_EMBEDDING_TIMEOUT_MS = 30_000;
export const OPENAI_CHAT_TIMEOUT_MS = 120_000; // интерактивная генерация (ответ на вопрос, разбор)
// Долгие вызовы модели: Whisper, тезисы, потоковый ответ. Совпадает с MODEL_CALL_TIMEOUT_MS
// обработки встреч — тот канон потолка одного обращения к модели.
export const OPENAI_LONG_TIMEOUT_MS = 180_000;
export const GRANOLA_TIMEOUT_MS = 15_000;
export const READ_AI_TIMEOUT_MS = 15_000;
export const GOOGLE_DRIVE_TIMEOUT_MS = 15_000; // токен, поиск и создание папки
export const GOOGLE_DRIVE_UPLOAD_TIMEOUT_MS = 60_000;
export const USER_LINK_TIMEOUT_MS = 15_000; // страница по ссылке, присланной человеком

const DEFAULT_IDEMPOTENT_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

export type ExternalFailure = "timeout" | "network";

export class ExternalFetchError extends Error {
  constructor(
    readonly service: string,
    readonly reason: ExternalFailure,
    readonly target: string,
    options?: { cause?: unknown },
  ) {
    super(`${service}: ${reason === "timeout" ? "истёк срок ответа" : "сбой сети"} (${target})`, options);
    this.name = "ExternalFetchError";
  }
}

export interface ExternalFetchOptions {
  /** Имя сервиса для лога: "openai", "telegram", "google", "granola"… */
  service: string;
  /** Срок одной попытки, мс. Именованная константа из этого модуля. */
  timeoutMs: number;
  /** Отмена извне (лиз потерян). Прерывает и запрос, и паузу перед повтором. */
  signal?: AbortSignal;
  /**
   * Число попыток. По умолчанию: GET/HEAD — 3, остальные методы — 1 (без повтора).
   * Для POST повтор задаётся только явно и только там, где повтор безопасен.
   */
  attempts?: number;
  /** Подмена для тестов. По умолчанию — `globalThis.fetch` на момент вызова. */
  fetchFn?: typeof fetch;
  /** Подмена паузы для тестов. */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** URL для лога: без query (там бывают ключи и запросы людей) и без токена бота в пути. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/bot[^/]+/, "/bot***")}`;
  } catch {
    return "<invalid url>";
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(res: Response | null, attempt: number): number {
  const retryAfter = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  return Math.pow(2, attempt - 1) * 1000;
}

const isRetryableStatus = (status: number) => status === 429 || (status >= 500 && status < 600);

export async function externalFetch(
  url: string,
  init: RequestInit,
  opts: ExternalFetchOptions,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = Math.max(1, opts.attempts ?? (IDEMPOTENT_METHODS.has(method) ? DEFAULT_IDEMPOTENT_ATTEMPTS : 1));
  const doFetch = opts.fetchFn ?? globalThis.fetch;
  const sleep = opts.sleepFn ?? abortableSleep;
  const target = `${method} ${redactUrl(url)}`;

  for (let attempt = 1;; attempt++) {
    opts.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response | null = null;
    let failure: ExternalFetchError | null = null;
    try {
      res = await doFetch(url, { ...init, signal });
    } catch (e) {
      // Отмена извне — это решение вызывающего, а не сбой сервиса: отдаём его причину как есть.
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      const reason: ExternalFailure = timeout.aborted ? "timeout" : "network";
      failure = new ExternalFetchError(opts.service, reason, target, { cause: e });
      console.error(`[external] ${opts.service} ${target}: ${reason} (попытка ${attempt}/${attempts})`);
      if (reason === "timeout") throw failure;
    }

    const canRetry = attempt < attempts && (failure !== null || (res !== null && isRetryableStatus(res.status)));
    if (res && !res.ok) {
      console.error(`[external] ${opts.service} ${target}: HTTP ${res.status} (попытка ${attempt}/${attempts})`);
    }
    if (!canRetry) {
      if (failure) throw failure;
      return res as Response;
    }
    await res?.body?.cancel();
    await sleep(retryDelayMs(res, attempt), opts.signal);
  }
}

// Готовые наборы (сервис + срок) для частых вызовов: в точке вызова — одно имя, а не два поля.
const preset = (service: string, timeoutMs: number): Readonly<ExternalFetchOptions> =>
  Object.freeze({ service, timeoutMs });
export const VIA_TELEGRAM = preset("telegram", TELEGRAM_TIMEOUT_MS);
export const VIA_TELEGRAM_UPLOAD = preset("telegram", TELEGRAM_UPLOAD_TIMEOUT_MS);
export const VIA_TELEGRAM_FILE = preset("telegram", TELEGRAM_FILE_TIMEOUT_MS);
export const VIA_OPENAI_EMBEDDING = preset("openai", OPENAI_EMBEDDING_TIMEOUT_MS);
export const VIA_OPENAI_CHAT = preset("openai", OPENAI_CHAT_TIMEOUT_MS);
export const VIA_OPENAI_LONG = preset("openai", OPENAI_LONG_TIMEOUT_MS);
export const VIA_GRANOLA = preset("granola", GRANOLA_TIMEOUT_MS);
export const VIA_READ_AI = preset("read-ai", READ_AI_TIMEOUT_MS);
export const VIA_GOOGLE_DRIVE = preset("google-drive", GOOGLE_DRIVE_TIMEOUT_MS);
export const VIA_GOOGLE_DRIVE_UPLOAD = preset("google-drive", GOOGLE_DRIVE_UPLOAD_TIMEOUT_MS);
export const VIA_USER_LINK = preset("user-link", USER_LINK_TIMEOUT_MS);
