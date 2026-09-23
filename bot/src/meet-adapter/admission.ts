/**
 * Дверь встречи: впустили / отказали / капча / стоим дальше.
 *
 * Порядок проверок здесь — не вкусовщина, а чужие оплаченные ошибки (приёмы из Vexa,
 * Apache-2.0):
 *  1. Прямой отказ хоста разбирается ПЕРВЫМ: Meet оставляет текст лобби в DOM уже после
 *     того, как человек нажал «отказать», и проверка ожидания раньше отказа заставила бы
 *     бота стоять у закрытой двери до таймаута.
 *  2. Живая капча — только видимый iframe размером с задачу; невидимый reCAPTCHA грузится
 *     на КАЖДОМ обычном входе, и «есть фрейм» капчей не является. Сам размер меряет
 *     скрапер, сюда приходит уже вердикт.
 *  3. Текст ожидания перебивает признаки звонка: тулбар с микрофоном, камерой и «Leave
 *     call» есть и в лобби, поэтому кнопки сами по себе «впустили» не значат.
 *  4. «Впустили» — по СТРУКТУРНЫМ маркерам (`[data-participant-id]`, `[data-self-name]`),
 *     которых в лобби нет и которые не прячутся автоскрытием тулбара.
 *
 * Неизвестное состояние — это «ждём дальше», а не «впустили»: молчаливое «впустили»
 * заканчивается записью тишины, а ожидание упирается в таймаут, который громко виден.
 */
import type { MeetSnapshot } from "./types.ts";

export type AdmissionState = "admitted" | "denied" | "captcha" | "waiting";

export interface AdmissionVerdict {
  readonly state: AdmissionState;
  /** Человекочитаемая причина — она уходит в лог и в уведомление владельцу. */
  readonly reason: string;
}

/** Прямой отказ живого человека. Его не отменяет ничто, включая капчу. */
const HOST_DENIAL_PHRASES = [
  "denied your request",
  "your request to join was denied",
  "you were denied",
  "weren't allowed to join",
  "not allowed to join",
  "wasn't admitted",
  "were not admitted",
  "no one responded to your request",
] as const;

/** Страница ошибки: войти некуда, ждать нечего. */
const ERROR_PAGE_PHRASES = [
  "check your meeting code",
  "meeting not found",
  "couldn't join the video call",
  "can't join this call",
  "cannot join this call",
  "unable to join",
  "invalid video call name",
  "this meeting has ended",
  "meeting has ended",
  "your meeting code is invalid",
  "you can't join this video call",
] as const;

/** Комната ожидания: дверь ещё не открыли и ещё не закрыли. */
const WAITING_PHRASES = [
  "asking to be let in",
  "you'll join the call when someone lets you",
  "waiting for the host to let you in",
  "please wait until a meeting host",
  "you're in the waiting room",
  "ask to join",
  "join now",
] as const;

/**
 * Приводит текст страницы к виду, на котором фразы сравниваются: живой Meet пишет
 * типографским апострофом (’), а любой список фраз в коде — прямым.
 */
export function normalizeMeetText(text: string): string {
  return text
    .replaceAll("’", "'")
    .replaceAll("ʼ", "'")
    .toLowerCase()
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function firstMatch(text: string, phrases: readonly string[]): string | null {
  return phrases.find((phrase) => text.includes(phrase)) ?? null;
}

export function classifyAdmission(snapshot: MeetSnapshot): AdmissionVerdict {
  const text = normalizeMeetText(snapshot.text);

  const denial = firstMatch(text, HOST_DENIAL_PHRASES);
  if (denial !== null) {
    return { state: "denied", reason: `хост отказал: «${denial}»` };
  }

  if (snapshot.captchaChallenge) {
    return { state: "captcha", reason: "на странице живая капча — вход без человека невозможен" };
  }

  const error = firstMatch(text, ERROR_PAGE_PHRASES);
  if (error !== null) {
    return { state: "denied", reason: `страница ошибки: «${error}»` };
  }

  const waiting = firstMatch(text, WAITING_PHRASES);
  if (waiting !== null) {
    return { state: "waiting", reason: `стоим у двери: «${waiting}»` };
  }

  if (snapshot.hasNameInput && snapshot.hasJoinCta) {
    return { state: "waiting", reason: "лобби гостя: имя введено, вход ещё не нажат" };
  }

  if (snapshot.tiles.length > 0 || snapshot.hasSelfTile || snapshot.hasPresentControl) {
    return { state: "admitted", reason: "в звонке: видны плитки участников" };
  }

  return { state: "waiting", reason: "страница не опознана — ждём, но не считаем, что впустили" };
}
