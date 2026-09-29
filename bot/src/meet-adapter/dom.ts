/**
 * Единственное место, которое читает вёрстку Google Meet.
 *
 * `collectMeetSnapshot` исполняется В КОНТЕКСТЕ СТРАНИЦЫ (Playwright сериализует функцию
 * исходником), поэтому она обязана быть самодостаточной: ни импортов, ни ссылок на
 * внешние константы — всё внутри. Наружу уходит `MeetSnapshot`, и дальше работают чистые
 * функции, проверенные тестами.
 *
 * Правила выбора селекторов, а не просто список:
 *  - семантика прежде всего: `role`, `aria-label`, data-атрибуты Meet (`data-participant-id`,
 *    `data-self-name`, `data-audio-level`). Обфусцированные классы Meet меняются с релизом
 *    молча (у Vexa, Apache-2.0, построенное на них давало «вся встреча — один человек»),
 *    поэтому они — только там, где семантики нет. Исключение одно, решение D034: сигнал
 *    говорящего. `data-audio-level` Meet больше не отдаёт (живой звонок 29.09.2026), и
 *    индикатор звука на плитке читается по классам (`SPEAKER_*` ниже). Незнакомый набор
 *    классов — «сигнала нет», а не речь и не тишина: имя наугад не подставится.
 *    Ещё один класс — стандартный маркер `notranslate` (его смысл задаёт Google Translate).
 *  - локаль запиннена (`?hl=en` + `--lang=en-US`), поэтому английские тексты — не удача,
 *    а конструкция; структурные селекторы всё равно идут первыми.
 *  - «не нашли» — это `null`, а не догадка: имя не выдумывается никогда.
 */
import type { MeetSnapshot } from "./types.ts";

/**
 * Поверхность браузера, которой пользуется скрапер, объявлена здесь, а не включением
 * библиотеки `DOM` на весь проект: остальной код бота — Node, и `document` в нём быть не
 * должно. Заодно список ниже — точная опись того, что адаптер трогает на странице.
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
  matches(selector: string): boolean;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
  getBoundingClientRect(): DomRect;
  readonly textContent: string | null;
  readonly classList: { contains(token: string): boolean };
}
declare const document: {
  readonly body: { readonly innerText: string } | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
};
declare function getComputedStyle(element: DomElement): DomStyle;
declare const location: { readonly hostname: string };

/**
Порядок важен: локаленезависимое — первым, английские подписи — запасными.
*/
export const NAME_INPUT_SELECTORS = [
  'input[jsname][type="text"]',
  'div[jscontroller] input[type="text"]',
  'input[type="text"][aria-label="Your name"]',
  'input[type="text"]:not([aria-hidden="true"])',
] as const;

export const JOIN_CTA_SELECTORS = [
  'button[aria-label="Ask to join"]',
  'button[aria-label="Join now"]',
  'button:has-text("Ask to join")',
  'button:has-text("Join now")',
  'button:has-text("Join")',
] as const;

export const MIC_OFF_SELECTORS = [
  'button[aria-label*="Turn off microphone"]',
  '[role="button"][aria-label*="Turn off microphone"]',
] as const;

export const CAMERA_OFF_SELECTORS = [
  'button[aria-label*="Turn off camera"]',
  '[role="button"][aria-label*="Turn off camera"]',
] as const;

/**
 * Диалог «камеры и микрофона нет»: на машине без устройств Meet показывает его перед лобби,
 * и без клика дальше не пускает. Бот пишет звук системой, свои устройства ему не нужны.
 */
export const NO_DEVICE_CONTINUE_SELECTORS = [
  'button[aria-label*="Continue without"]',
  'button:has-text("Continue without microphone and camera")',
  'button:has-text("Continue without microphone")',
  'button:has-text("Continue without camera")',
] as const;

export const LEAVE_SELECTORS = [
  'button[aria-label="Leave call"]',
  'button[aria-label*="Leave call"]',
  'button[aria-label*="Leave meeting"]',
  'button[aria-label*="Hang up"]',
  '[role="button"][aria-label*="Leave call"]',
] as const;

export const PEOPLE_BUTTON_SELECTORS = [
  'button[aria-label^="People"]',
  'button[aria-label*="Show everyone"]',
  'button[aria-label*="participants"]',
  'button[aria-label*="Participants"]',
] as const;

/**
Сколько символов текста страницы уезжает в снимок: фразы двери короткие.
*/
const SNAPSHOT_TEXT_LIMIT = 4000;

/**
 * Селекторы, которые едут ВНУТРЬ страницы. Только обычный CSS: в контексте страницы работает
 * `document.querySelector`, и движки Playwright (`:has-text()`) там падают с SyntaxError —
 * молча, через try/catch вызывающего, то есть селектор просто перестаёт что-либо находить.
 * Список передаётся аргументом, а не копируется в тело функции: копия разъедется.
 */
export interface SnapshotCss {
  readonly nameInput: readonly string[];
  readonly joinCta: readonly string[];
  readonly presentControl: readonly string[];
  /**
   * Приглашение войти: ссылки на страницу входа Google. Кнопку с текстом «Sign in» скрапер
   * ищет сам — `:has-text()` внутри страницы не работает (см. выше).
   */
  readonly signInPrompt: readonly string[];
  readonly textLimit: number;
}

export const SNAPSHOT_CSS: SnapshotCss = {
  nameInput: [
    'input[jsname][type="text"]',
    'div[jscontroller] input[type="text"]',
    'input[type="text"][aria-label="Your name"]',
    'input[type="text"]:not([aria-hidden="true"])',
  ],
  joinCta: ['button[aria-label="Ask to join"]', 'button[aria-label="Join now"]'],
  presentControl: [
    'button[aria-label*="Present now"]',
    'button[aria-label*="Share screen"]',
    'button[aria-label*="Present"]',
  ],
  signInPrompt: [
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/signin"]',
    'a[href*="accounts.google.com/v3/signin"]',
  ],
  textLimit: SNAPSHOT_TEXT_LIMIT,
};

/**
 * Собирает снимок страницы. Исполняется в браузере — см. шапку файла.
 * Никаких побочных эффектов: только чтение.
 */
export function collectMeetSnapshot(css: SnapshotCss): MeetSnapshot {
  const CAPTCHA_MIN_WIDTH = 120;
  const CAPTCHA_MIN_HEIGHT = 40;

  /*
   * Функции ниже объявлены ВНУТРИ: страница получает эту функцию исходником, и ссылка
   * на внешнюю область видимости превратится в `ReferenceError` уже в браузере.
   */
  // eslint-disable-next-line unicorn/consistent-function-scoping -- см. комментарий выше
  const isVisible = (element: DomElement): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const hasAnyVisible = (selectors: readonly string[]): boolean =>
    selectors.some((selector) => {
      try {
        return [...document.querySelectorAll(selector)].some((element) => isVisible(element));
      } catch {
        return false;
      }
    });

  // eslint-disable-next-line unicorn/consistent-function-scoping -- функция едет в браузер
  const nameOfTile = (tile: DomElement): string | null => {
    const self = tile.matches("[data-self-name]")
      ? tile.getAttribute("data-self-name")
      : (tile.querySelector("[data-self-name]")?.getAttribute("data-self-name") ?? null);
    if (self !== null && self.trim() !== "") return self;

    const aria = tile.getAttribute("aria-label");
    if (aria !== null && aria.trim() !== "") return aria;

    const listItem = tile.querySelector('[role="listitem"]');
    if (listItem?.textContent != null && listItem.textContent.trim() !== "") {
      return listItem.textContent;
    }

    // Последний по порядку: `notranslate` — стандартный маркер, а не тема оформления.
    const translated = tile.querySelector("span.notranslate");
    return translated?.textContent ?? null;
  };

  // Индикатор звука на плитке и его классы (D034, замер на живом звонке 29.09.2026).
  const SPEAKER_INDICATOR_SELECTOR = ".IisKdb";
  const SPEAKER_SILENT_CLASS = "gjg47c";
  const SPEAKER_TALKING_CLASSES = ["Oaajhc", "HX2H7", "wEsLMd", "OgVli"];

  // eslint-disable-next-line unicorn/consistent-function-scoping -- функция едет в браузер
  const audioLevelOfTile = (tile: DomElement): number | null => {
    const holder = tile.matches("[data-audio-level]")
      ? tile
      : tile.querySelector("[data-audio-level]");
    const raw = holder?.getAttribute("data-audio-level");
    if (raw != null) {
      const level = Number(raw);
      return Number.isFinite(level) ? level : null;
    }
    // Индикатор звука плитки (D034): класс молчания или один из классов уровня речи. Иной
    // набор — вёрстка сменилась, сигнала нет.
    const indicator = tile.querySelector(SPEAKER_INDICATOR_SELECTOR);
    if (indicator === null) return null;
    if (SPEAKER_TALKING_CLASSES.some((name) => indicator.classList.contains(name))) return 1;
    if (indicator.classList.contains(SPEAKER_SILENT_CLASS)) return 0;
    return null;
  };

  const tiles = [...document.querySelectorAll("[data-participant-id]")].map((tile, index) => ({
    id: tile.getAttribute("data-participant-id") ?? `tile-${String(index)}`,
    name: nameOfTile(tile),
    self: tile.matches("[data-self-name]") || tile.querySelector("[data-self-name]") !== null,
    audioLevel: audioLevelOfTile(tile),
  }));

  // Панель участников: берём самый длинный список ролей — в чате и меню списки короче.
  let panelParticipantCount: number | null = null;
  for (const list of document.querySelectorAll('[role="list"]')) {
    const items = [...list.querySelectorAll('[role="listitem"]')].length;
    if (items > 0 && (panelParticipantCount === null || items > panelParticipantCount)) {
      panelParticipantCount = items;
    }
  }

  // ЖИВАЯ капча — видимый iframe размером с задачу. Невидимый reCAPTCHA грузится на каждом
  // обычном входе, и считать его капчей значит объявить капчу на любой встрече. Под аккаунтом
  // Meet показывает его значком 256×60 (`size=invisible` в адресе) — видимым и крупнее порога:
  // живой вход 29.09.2026 бот бросил с «captcha», стоя у двери перед «Ask to join».
  const isCaptchaChallenge = [...document.querySelectorAll('iframe[src*="recaptcha"]')].some(
    (frame) => {
      if ((frame.getAttribute("src") ?? "").includes("size=invisible")) return false;
      if (!isVisible(frame)) return false;
      const rect = frame.getBoundingClientRect();
      return rect.width >= CAPTCHA_MIN_WIDTH && rect.height >= CAPTCHA_MIN_HEIGHT;
    },
  );

  const hasSignInButton = [...document.querySelectorAll('a, button, [role="button"]')].some(
    (element) => element.textContent?.trim().toLowerCase() === "sign in" && isVisible(element),
  );

  return {
    text: (document.body?.innerText ?? "").slice(0, css.textLimit),
    host: location.hostname,
    hasSignInPrompt: hasSignInButton || hasAnyVisible(css.signInPrompt),
    hasNameInput: hasAnyVisible(css.nameInput),
    hasJoinCta: hasAnyVisible(css.joinCta),
    hasSelfTile: document.querySelector("[data-self-name]") !== null,
    hasPresentControl: hasAnyVisible(css.presentControl),
    captchaChallenge: isCaptchaChallenge,
    tiles,
    panelParticipantCount,
  };
}
