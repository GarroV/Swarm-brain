// Заявка записи проверяется по серверному времени встречи. Секунды claim присылает клиент, и правило
// полноты (arbiter.ts) сравнивает их с записью держателя, поэтому на уже существующую встречу
// заявленное не может быть больше, чем встреча могла идти по часам сервера. Образец — потолок удара
// бота (meeting-heartbeat/write.ts, recordedSecondsCeiling): прошедшее время с запасом 10%.
//
// От чего отсчитывать. Рекордер заявляется на стопе, то есть строка встречи часто появляется уже
// ПОСЛЕ встречи, — отсчёт от появления строки (created_at) урезал бы честную запись. Начало встречи
// (started_at строки) прислал первый заявитель; заявка этого начала не переписывает. Берём более
// раннее из двух: у рекордера это начало, у бота (заявляется до захода) — появление строки.
// Запись может начаться раньше начала, записанного первым заявителем (человек зашёл заранее, у
// склейки по составу начала расходятся), — на это запас в пять минут сверх 10% прошедшего.
//
// Заявиться можно и много позже встречи (досылка из карантина рекордера): тогда потолок велик — это
// ограничение сверху, а не проверка длины записи.

import { MAX_RECORDED_SECONDS } from "../_shared/claim-lease.ts";

/** Запас к прошедшему времени — тот же, что у удара бота. */
export const CLAIM_CLOCK_GROWTH_FACTOR = 1.1;

/** Насколько запись может начаться раньше известного серверу начала встречи (сек). */
export const CLAIM_EARLY_START_SEC = 300;

/** Что claim читает о времени встречи из её строки. */
export interface MeetingClock {
  started_at: string | null;
  created_at: string | null;
}

function earliestMs(clock: MeetingClock): number {
  const known = [clock.started_at, clock.created_at]
    .map((v) => (v === null ? Number.NaN : Date.parse(v)))
    .filter((ms) => Number.isFinite(ms));
  return known.length === 0 ? Number.NaN : Math.min(...known);
}

/** Больше скольких секунд заявка на эту встречу быть не может. Времени у строки нет — суточный потолок. */
export function claimSecondsCeiling(clock: MeetingClock, nowIso: string): number {
  const anchorMs = earliestMs(clock);
  if (!Number.isFinite(anchorMs)) return MAX_RECORDED_SECONDS;
  const elapsedSec = Math.max(0, (Date.parse(nowIso) - anchorMs) / 1000);
  return Math.min(MAX_RECORDED_SECONDS, elapsedSec * CLAIM_CLOCK_GROWTH_FACTOR + CLAIM_EARLY_START_SEC);
}

/** Секунды заявки, урезанные потолком встречи; нет секунд — нет и после. */
export function boundClaimSeconds(
  clock: MeetingClock,
  seconds: number | undefined,
  nowIso: string,
): number | undefined {
  if (seconds === undefined) return undefined;
  return Math.min(seconds, claimSecondsCeiling(clock, nowIso));
}
