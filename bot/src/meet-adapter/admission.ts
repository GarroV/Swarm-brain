/**
 * Дверь встречи: впустили / отказали / не пустили гостя / встречи нет / капча / стоим дальше.
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
 *  3½. Вход аккаунта бота (T175) разбирается раньше страниц ошибки: под слетевшей сессией Google
 *     показывает тот же «You can't join», и без этой проверки человек услышал бы «откройте
 *     доступ», хотя чинить надо вход бота.
 *  4. «Впустили» — по СТРУКТУРНЫМ маркерам (`[data-participant-id]`, `[data-self-name]`),
 *     которых в лобби нет и которые не прячутся автоскрытием тулбара.
 *
 * Неизвестное состояние — это «ждём дальше», а не «впустили»: молчаливое «впустили»
 * заканчивается записью тишины, а ожидание упирается в таймаут, который громко виден.
 */
import type { MeetSnapshot } from "./types.ts";

type AdmissionState =
  "admitted" | "denied" | "blocked" | "unavailable" | "signin_required" | "captcha" | "waiting";

export interface AdmissionContext {
  /**
   * Бот идёт под своим аккаунтом Google (сохранённый вход подложен в контейнер). Тогда лобби
   * гостя и приглашение войти значат «вход слетел», а не «стоим у двери».
   */
  readonly isSignedIn?: boolean;
}

export interface AdmissionVerdict {
  readonly state: AdmissionState;
  /**
  Человекочитаемая причина — она уходит в лог и в уведомление владельцу.
  */
  readonly reason: string;
}

/**
Прямой отказ живого человека. Его не отменяет ничто, включая капчу.
*/
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

/**
Страница ошибки, которая прямо говорит, что встречи нет: код неверный или встреча кончилась.
*/
const UNAVAILABLE_PHRASES = [
  "check your meeting code",
  "meeting not found",
  "invalid video call name",
  "this meeting has ended",
  "meeting has ended",
  "your meeting code is invalid",
] as const;

/**
 * Страница ошибки без объяснения: Meet не пускает гостя ещё до лобби. Хост заявки не видел —
 * это НЕ его отказ. Живой прогон T004 (28.09.2026): встреча в рабочем домене с доступом
 * «Trusted» отвечает гостю без аккаунта «You can't join this video call». Тот же экран,
 * слово в слово, Google отдаёт и на несуществующий код (проверено в тот же день) — существование
 * встречи он гостю не раскрывает, поэтому причину со страницы не различить и уведомление
 * называет обе.
 */
const BLOCKED_PHRASES = [
  "you can't join this video call",
  "couldn't join the video call",
  "can't join this call",
  "cannot join this call",
  "unable to join",
] as const;

/**
 * Страница входа Google: куда Meet уводит, когда сессии нет, и где Google просит подтвердить
 * вход. Пройти её бот не может и не должен: пароль и второй фактор вводит только человек.
 */
const GOOGLE_SIGNIN_HOST = "accounts.google.com";

const SIGNIN_PHRASES = [
  "verify it's you",
  "confirm it's you",
  "choose an account",
  "sign in to continue",
  "couldn't sign you in",
  "this browser or app may not be secure",
  "use your google account",
] as const;

/**
Комната ожидания: дверь ещё не открыли и ещё не закрыли.
*/
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
  return text.replaceAll(/[’ʼ]/g, "'").toLowerCase().replaceAll(/\s+/gu, " ").trim();
}

function firstMatch(text: string, phrases: readonly string[]): string | null {
  return phrases.find((phrase) => text.includes(phrase)) ?? null;
}

/**
 * Google просит войти. Под своим аккаунтом это «вход слетел» — чинить вход бота; гостем это
 * «встреча пускает только вошедших» — тот же смысл, что у страницы ошибки до лобби.
 */
function signInVerdict(
  snapshot: MeetSnapshot,
  text: string,
  isSignedIn: boolean,
): AdmissionVerdict | null {
  const isOnSignInPage = snapshot.host === GOOGLE_SIGNIN_HOST;
  if (!isSignedIn) {
    return isOnSignInPage
      ? { state: "blocked", reason: `Meet увёл гостя на страницу входа ${GOOGLE_SIGNIN_HOST}` }
      : null;
  }
  const phrase = firstMatch(text, SIGNIN_PHRASES);
  if (isOnSignInPage) {
    const said = phrase === null ? "" : `: «${phrase}»`;
    return {
      state: "signin_required",
      reason: `Google просит вход на ${GOOGLE_SIGNIN_HOST}${said}`,
    };
  }
  if (phrase !== null) {
    return { state: "signin_required", reason: `Google просит вход: «${phrase}»` };
  }
  if (snapshot.hasSignInPrompt) {
    return {
      state: "signin_required",
      reason: "на странице кнопка «Sign in» — сохранённый вход не действует",
    };
  }
  if (snapshot.hasNameInput && snapshot.hasJoinCta) {
    return {
      state: "signin_required",
      reason: "лобби гостя при сохранённом входе — сессия не действует",
    };
  }
  return null;
}

export function classifyAdmission(
  snapshot: MeetSnapshot,
  context: AdmissionContext = {},
): AdmissionVerdict {
  const text = normalizeMeetText(snapshot.text);

  const denial = firstMatch(text, HOST_DENIAL_PHRASES);
  if (denial !== null) {
    return { state: "denied", reason: `хост отказал: «${denial}»` };
  }

  if (snapshot.captchaChallenge) {
    return { state: "captcha", reason: "на странице живая капча — вход без человека невозможен" };
  }

  const signIn = signInVerdict(snapshot, text, context.isSignedIn === true);
  if (signIn !== null) return signIn;

  const unavailable = firstMatch(text, UNAVAILABLE_PHRASES);
  if (unavailable !== null) {
    return { state: "unavailable", reason: `встречи нет: «${unavailable}»` };
  }

  const blocked = firstMatch(text, BLOCKED_PHRASES);
  if (blocked !== null) {
    return { state: "blocked", reason: `Meet не пустил гостя до лобби: «${blocked}»` };
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
