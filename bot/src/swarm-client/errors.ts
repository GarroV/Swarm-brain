/**
 * Ошибки клиента Swarm и единственный вопрос, ради которого они различаются:
 * стоит ли повторять запрос.
 *
 * Граница ровно та же, что у `bumblebee` (`SwarmClient.swift`, `withRetry`): 5xx и 429 —
 * временно, остальные 4xx — постоянно. Повторять 401 (мёртвый токен), 403 (не владелец
 * транскрибации) или 413 (часть больше 25 МБ) бессмысленно: сервер ответит то же самое,
 * а запись будет висеть в очереди, изображая работу.
 */

/**
 * Сервер ответил, и ответ не в диапазоне 2xx.
 */
export class SwarmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    /**
     * Сколько сервер просит подождать (`Retry-After`), если просил.
     */
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${String(status)}: ${bodyText.slice(0, 500)}`);
    this.name = "SwarmHttpError";
  }
}

/**
 * До сервера не дошли: сеть, DNS, таймаут, оборванное соединение.
 */
export class SwarmTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwarmTransportError";
  }
}

/**
 * Сервер ответил успехом, но ответ не той формы: не JSON, нет обязательного поля,
 * незнакомое решение арбитража. Повторять нечего — повторится то же самое, — а молча
 * подставить умолчание тут страшнее всего: неизвестное решение, прочитанное как
 * «транскрибируем», отправит аудио поверх чужого права.
 */
export class SwarmProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwarmProtocolError";
  }
}

/**
 * Право транскрибации у другого участника (`claim` → `defer`). Бросается вместо отправки
 * аудио: молчаливый `void` здесь нарушил бы принцип №1 (громкий отказ важнее тихой работы)
 * и спрятал бы ошибку оркестратора, который дошёл до выгрузки после отказа.
 */
export class SwarmDeferredError extends Error {
  constructor(
    readonly meetingId: string,
    readonly heldBy: number | null,
  ) {
    super(
      `meeting ${meetingId} is claimed by someone else (held_by=${String(heldBy)}) — audio not sent`,
    );
    this.name = "SwarmDeferredError";
  }
}

/**
 * Повторять или нет. Всё, что не ответ сервера, считаем сетевым сбоем — его повторяем.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof SwarmHttpError) {
    return error.status >= 500 || error.status === 429;
  }
  return error instanceof SwarmTransportError;
}

/**
 * `Retry-After`: либо число секунд, либо HTTP-дата. Мусор и отрицательные значения — `undefined`,
 * то есть «сервер не просил», а не «ждать ноль».
 */
export function parseRetryAfterMs(
  header: string | null,
  nowMs: number = Date.now(),
): number | undefined {
  const raw = header?.trim();
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds * 1000 : undefined;
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - nowMs);
}
