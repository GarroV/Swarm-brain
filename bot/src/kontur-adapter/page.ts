/**
 * Что показывает страница Толка и что с этим делать — чистые функции над снимком.
 *
 * Этапы гостевого входа (живая комната владельца, 30.09.2026):
 *  - `closed` — «Доступ для внешних участников отключен»: комната закрыта для гостей. Тот же
 *    экран Толк отдаёт и на несуществующую комнату (проверено на случайном коде в тот же день) —
 *    существование комнаты гостю не раскрывается, поэтому человеку называются обе причины;
 *  - `name_form` — «Представьтесь…»: поле имени и «Продолжить»;
 *  - `devices` — экран устройств с «Присоединиться»;
 *  - `in_call` — звонок: область плиток участников;
 *  - `unknown` — ничего из этого: страница грузится или это зал ожидания, текста которого мы не
 *    видели. Неизвестное — это «ждём», а не «впустили»: молчаливое «впустили» кончается записью
 *    тишины, ожидание упирается в таймаут двери, который громко виден.
 *
 * Кнопку «Войти» / «Авторизация» (корпоративный вход) бот не нажимает никогда: у него нет аккаунта
 * пространства (D040), и нажатие увело бы его на чужую страницу входа.
 */
import type { KonturSnapshot } from "./types.ts";

export type KonturStage = "closed" | "name_form" | "devices" | "in_call" | "unknown";

export interface StageVerdict {
  readonly stage: KonturStage;
  /**
  Человекочитаемая причина — в журнал и в деталь нотисы.
  */
  readonly reason: string;
}

/**
Комната закрыта для внешних участников (или её нет — экран тот же).
*/
const CLOSED_PHRASES = [
  "доступ для внешних участников отключен",
  "доступ для внешних участников отключён",
  "включить доступ для внешних участников",
] as const;

/**
Форма имени гостя.
*/
const NAME_FORM_PHRASES = ["представьтесь, чтобы участники могли вас узнать"] as const;

/**
Заголовок вкладки внутри звонка.
*/
const IN_CALL_TITLE = "встреча — толк";

/**
 * Приводит текст к виду, на котором сравниваются фразы: нижний регистр, одинарные пробелы,
 * неразрывный пробел — обычный.
 */
function normalizeKonturText(text: string): string {
  return text.replaceAll("\u{A0}", " ").toLowerCase().replaceAll(/\s+/gu, " ").trim();
}

function firstMatch(text: string, phrases: readonly string[]): string | null {
  return phrases.find((phrase) => text.includes(phrase)) ?? null;
}

/**
 * Этап входа по снимку. Порядок проверок: звонок по структуре (область плиток) — первым, потому
 * что в звонке текст страницы может содержать что угодно (чат, имена); затем закрытая комната —
 * раньше формы, потому что экран закрытой комнаты тоже предлагает «войти».
 */
export function classifyKonturStage(snapshot: KonturSnapshot): StageVerdict {
  const text = normalizeKonturText(snapshot.text);
  const title = normalizeKonturText(snapshot.title);

  if (snapshot.hasParticipantsArea || snapshot.tiles.length > 0) {
    return { stage: "in_call", reason: "в звонке: видна область плиток участников" };
  }

  const closed = firstMatch(text, CLOSED_PHRASES);
  if (closed !== null) {
    return { stage: "closed", reason: `комната закрыта для гостей: «${closed}»` };
  }

  if (snapshot.hasNameInput) {
    const said = firstMatch(text, NAME_FORM_PHRASES);
    return {
      stage: "name_form",
      reason:
        said === null ? "форма имени гостя: видно поле имени" : `форма имени гостя: «${said}»`,
    };
  }

  if (snapshot.hasJoinButton) {
    return { stage: "devices", reason: "экран устройств: видна кнопка «Присоединиться»" };
  }

  if (title === IN_CALL_TITLE) {
    // Заголовок звонка без плиток: интерфейс звонка ещё дорисовывается. Не «впустили»,
    // пока нет структурного признака.
    return { stage: "unknown", reason: "заголовок звонка, но плиток ещё нет — ждём" };
  }

  return { stage: "unknown", reason: "страница не опознана — ждём, но не считаем, что впустили" };
}

/**
 * Бот обязан входить немым: и перед «Присоединиться», и уже в звонке. Видимая кнопка
 * «Выключить микрофон/камеру» значит, что устройство включено. `null` — нарушения нет.
 */
export function mutedViolation(snapshot: KonturSnapshot): string | null {
  const live = [
    ...(snapshot.hasMicOnControl ? ["микрофон"] : []),
    ...(snapshot.hasCameraOnControl ? ["камера"] : []),
  ];
  if (live.length === 0) return null;
  return (
    `у бота включены ${live.join(" и ")} (видна кнопка «Выключить…») — бот обязан входить ` +
    "немым, иначе контейнер шумит в звонок"
  );
}

export type GuestRoomStep = "proceed" | "wait" | "reload" | "give_up";

export interface GuestRoomClock {
  readonly nowMs: number;
  /**
  Когда бот впервые открыл комнату.
  */
  readonly startedAtMs: number;
  /**
  Когда страница загружалась последний раз.
  */
  readonly lastLoadAtMs: number;
  /**
  Сколько всего ждать открытия комнаты.
  */
  readonly waitMs: number;
  /**
  Как часто перезагружать закрытую комнату.
  */
  readonly reloadMs: number;
}

/**
 * Решение у закрытой двери гостя (D040): человек открывает комнату в настройках, бот ждёт.
 * Толк сам экран закрытой комнаты не обновляет — поэтому перезагрузка по часам.
 *
 * Не `closed` — идём дальше (форма, устройства, звонок или «не опознано» — дальше разбирается
 * вход). `closed` — перезагрузить, если пора; сдаться, если время вышло; иначе ждать.
 * Сдаться — раньше перезагрузки: последняя перезагрузка на границе окна ничего не даёт.
 */
export function nextGuestRoomStep(stage: KonturStage, clock: GuestRoomClock): GuestRoomStep {
  if (stage !== "closed") return "proceed";
  if (clock.nowMs - clock.startedAtMs >= clock.waitMs) return "give_up";
  if (clock.nowMs - clock.lastLoadAtMs >= clock.reloadMs) return "reload";
  return "wait";
}
