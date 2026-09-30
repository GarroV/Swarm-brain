/**
 * Единственное место, которое читает вёрстку Контур.Толка.
 *
 * `collectKonturSnapshot` исполняется В КОНТЕКСТЕ СТРАНИЦЫ (Playwright сериализует функцию
 * исходником), поэтому она самодостаточна: ни импортов, ни внешних констант. Наружу уходит
 * `KonturSnapshot`, дальше работают чистые функции под тестами.
 *
 * Селекторы — по видимым текстам и `aria-label` (живая комната владельца, 30.09.2026). Служебные
 * имена Толка — только три, у которых нет текстового заменителя: элементы
 * `conference-participants-area` / `conference-participant`, класс говорящего `active-speaker` и
 * имя на плитке `.participant-info-content`. Каждый ищется и как тег, и как класс: Толк написан на
 * Angular, и имена компонентов встречаются в обоих видах.
 *
 * Кнопок «Войти» и «Авторизация» здесь нет намеренно: корпоративный вход бот не нажимает никогда.
 */
import type { KonturSnapshot } from "./types.ts";

/**
Поверхность браузера, которой пользуется скрапер (см. то же объявление в `meet-adapter/dom.ts`).
*/
interface DomRect {
  readonly width: number;
  readonly height: number;
}
interface DomStyle {
  readonly visibility: string;
  readonly display: string;
  readonly opacity: string;
}
interface DomElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
  getBoundingClientRect(): DomRect;
  readonly textContent: string | null;
  readonly classList: { contains(token: string): boolean };
}
declare const document: {
  readonly title: string;
  readonly body: { readonly innerText: string } | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
};
declare function getComputedStyle(element: DomElement): DomStyle;

/**
Поле имени гостя: подсказка в поле — видимый текст формы.
*/
export const NAME_INPUT_SELECTORS = [
  'input[placeholder="Например, Сергей Иванов"]',
  'input[placeholder^="Например"]',
] as const;

export const CONTINUE_SELECTORS = ['button:has-text("Продолжить")'] as const;

export const JOIN_SELECTORS = ['button:has-text("Присоединиться")'] as const;

/**
 * Выход из звонка. Точной подписи кнопки выхода в разведке не было — берём только однозначные
 * «покинуть/выйти из встречи». Всё, что похоже на «Завершить», сюда не входит никогда: у
 * организатора это «завершить встречу для всех». Не нашли — адаптер закрывает вкладку.
 */
export const LEAVE_SELECTORS = [
  '[aria-label="Покинуть встречу"]',
  '[aria-label="Выйти из встречи"]',
  '[aria-label="Покинуть"]',
  'button:has-text("Покинуть встречу")',
] as const;

/**
Сколько символов текста страницы уезжает в снимок: фразы входа короткие.
*/
const SNAPSHOT_TEXT_LIMIT = 4000;

/**
 * Что скрапер ищет внутри страницы. Только обычный CSS и точные тексты: `:has-text()` внутри
 * страницы не работает (падает SyntaxError, и селектор молча перестаёт находить).
 */
export interface KonturCss {
  readonly nameInput: readonly string[];
  readonly micOn: readonly string[];
  readonly cameraOn: readonly string[];
  readonly participantsButton: readonly string[];
  readonly area: string;
  readonly tile: string;
  readonly tileName: string;
  readonly speakingClass: string;
  readonly continueText: string;
  readonly joinText: string;
  readonly textLimit: number;
}

export const KONTUR_CSS: KonturCss = {
  nameInput: [...NAME_INPUT_SELECTORS],
  micOn: ['[aria-label="Выключить микрофон"]'],
  cameraOn: ['[aria-label="Выключить камеру"]'],
  participantsButton: ['[aria-label="Участники"]'],
  area: "conference-participants-area, .conference-participants-area",
  tile: "conference-participant, .conference-participant",
  tileName: ".participant-info-content",
  speakingClass: "active-speaker",
  continueText: "продолжить",
  joinText: "присоединиться",
  textLimit: SNAPSHOT_TEXT_LIMIT,
};

/**
Собирает снимок страницы. Исполняется в браузере — только чтение, без побочных эффектов.
*/
export function collectKonturSnapshot(css: KonturCss): KonturSnapshot {
  // Функции объявлены ВНУТРИ: страница получает эту функцию исходником.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- функция едет в браузер
  const isVisible = (element: DomElement): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const visibleAll = (selectors: readonly string[]): DomElement[] =>
    selectors.flatMap((selector) => {
      try {
        return [...document.querySelectorAll(selector)].filter((element) => isVisible(element));
      } catch {
        return [];
      }
    });

  const hasPresent = (selectors: readonly string[]): boolean =>
    selectors.some((selector) => {
      try {
        return [...document.querySelectorAll(selector)].length > 0;
      } catch {
        return false;
      }
    });

  const hasButtonText = (wanted: string): boolean =>
    [...document.querySelectorAll('button, [role="button"]')].some(
      (element) =>
        (element.textContent ?? "").replaceAll(/\s+/gu, " ").trim().toLowerCase() === wanted &&
        isVisible(element),
    );

  const tiles = [...document.querySelectorAll(css.tile)].map((tile) => {
    const raw = tile.querySelector(css.tileName)?.textContent ?? null;
    return {
      name: raw === null || raw.trim() === "" ? null : raw,
      speaking: tile.classList.contains(css.speakingClass),
    };
  });

  let participantCount: number | null = null;
  for (const button of visibleAll(css.participantsButton)) {
    const digits = /\d+/u.exec(button.textContent ?? "");
    if (digits !== null) {
      participantCount = Number(digits[0]);
      break;
    }
  }

  return {
    title: document.title,
    text: (document.body?.innerText ?? "").slice(0, css.textLimit),
    hasNameInput: visibleAll(css.nameInput).length > 0,
    hasContinueButton: hasButtonText(css.continueText),
    hasJoinButton: hasButtonText(css.joinText),
    // Присутствие, а не видимость: спрятанная автоскрытием кнопка «Выключить микрофон» всё равно
    // значит, что микрофон включён. Ложное «включён» кончается громким отказом, ложное
    // «выключен» — писком в чужой звонок.
    hasMicOnControl: hasPresent(css.micOn),
    hasCameraOnControl: hasPresent(css.cameraOn),
    hasParticipantsArea: [...document.querySelectorAll(css.area)].length > 0,
    tiles,
    participantCount,
  };
}

declare const navigator: {
  readonly mediaDevices?: object;
};
declare const DOMException: new (message: string, name: string) => Error;

/**
 * Скрипт на каждую страницу контекста ДО скриптов Толка: захват микрофона, камеры и экрана
 * отказан так же, как отказал бы человек (`NotAllowedError`). Это вторая половина немоты бота —
 * первая в том, что контексту не выдано разрешений (`permissions: []`). Звук контейнера (pulse)
 * иначе мог бы уйти в звонок как микрофон: владелец слышал писк бота с фейковыми устройствами.
 * Исполняется в браузере — самодостаточна.
 */
export function denyCaptureDevices(): void {
  const devices = navigator.mediaDevices;
  if (devices === undefined) return;
  // eslint-disable-next-line unicorn/consistent-function-scoping -- функция едет в браузер
  const deny = async (): Promise<never> => {
    await Promise.resolve();
    throw new DOMException("scriba joins muted: capture is disabled", "NotAllowedError");
  };
  // Свойство — геттер с немым сеттером, а не `writable: false`: Толк при входе сам присваивает
  // `mediaDevices.getUserMedia` (обёртка), и в строгом режиме запись в read-only бросает TypeError —
  // скрипт Толка падал, страница перезагружалась на форму имени, и бот ходил по кругу (прод
  // 30.09.2026). Запись теперь проглатывается, а читается всегда отказ.
  for (const name of ["getUserMedia", "getDisplayMedia"]) {
    Object.defineProperty(devices, name, {
      get: () => deny,
      set: (): void => undefined,
      configurable: false,
    });
  }
}
