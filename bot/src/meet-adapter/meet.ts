/**
 * `MeetAdapter` — Playwright вокруг чистых функций этого блока.
 *
 * Здесь нет ни одного решения о том, что означает увиденное: страницу читает `dom.ts`,
 * вердикты выносят `admission.ts` и `speakers.ts`. Задача этого файла — довести браузер до
 * состояния, в котором снимок вообще можно снять, и освободить ресурсы после.
 *
 * Две особенности живого Meet, из-за которых код выглядит именно так:
 *  - тулбар (микрофон, камера, «Leave call») автоскрывается через несколько секунд, а бот
 *    мышью не двигает. Поэтому перед каждым чтением и каждым кликом идёт СИНТЕТИЧЕСКОЕ
 *    движение мыши — иначе кнопка «есть, но невидима», и адаптер решит, что он не в звонке;
 *  - имя вводится посимвольно, а не подстановкой значения: Meet слушает события ввода.
 */
import type { Browser, BrowserContext, LaunchOptions, Locator, Page } from "playwright";

import { chromiumLaunchOptions } from "../container/browser.ts";
import { classifyAdmission } from "./admission.ts";
import {
  CAMERA_OFF_SELECTORS,
  JOIN_CTA_SELECTORS,
  LEAVE_SELECTORS,
  MIC_OFF_SELECTORS,
  NAME_INPUT_SELECTORS,
  NO_DEVICE_CONTINUE_SELECTORS,
  PEOPLE_BUTTON_SELECTORS,
  SNAPSHOT_CSS,
  collectMeetSnapshot,
} from "./dom.ts";
import { hasSpeakerSignal, isAloneSnapshot, pickActiveSpeaker } from "./speakers.ts";
import type { AdmissionOutcome, MeetSnapshot, PlatformAdapter } from "./types.ts";
import { pinMeetLocale } from "./url.ts";

/**
Язык интерфейса браузера. Вторая половина пиннинга локали — первая живёт в `?hl=en`.
*/
const MEET_BROWSER_LANG = "en-US";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const CONTROL_TIMEOUT_MS = 5000;
const TYPE_DELAY_MS = 60;

export interface MeetAdapterDependencies {
  readonly browser: Browser;
  readonly log?: (message: string) => void;
  readonly pollIntervalMs?: number;
  /**
   * Вызывается на свежем контексте до открытия вкладки. Смоук вешает сюда подмену
   * ответов `meet.google.com` страницами-двойниками — прод-путь при этом не меняется.
   */
  readonly prepareContext?: (context: BrowserContext) => Promise<void>;
}

/**
Параметры запуска Chromium, которых требует адаптер: язык интерфейса запиннен.
*/
export function meetLaunchOptions(input: { lang?: string } = {}): LaunchOptions {
  const options = chromiumLaunchOptions({ lang: input.lang ?? MEET_BROWSER_LANG });
  return {
    headless: options.headless,
    ignoreDefaultArgs: [...options.ignoreDefaultArgs],
    args: [...options.args],
  };
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class MeetAdapter implements PlatformAdapter {
  readonly #deps: MeetAdapterDependencies;
  readonly #log: (message: string) => void;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #displayName: string | null = null;
  #speakerSignalReported = false;
  #aloneSignalReported = false;

  constructor(dependencies: MeetAdapterDependencies) {
    this.#deps = dependencies;
    this.#log =
      dependencies.log ??
      ((message): void => {
        console.log(`[meet] ${message}`);
      });
  }

  async #snapshot(): Promise<MeetSnapshot> {
    const page = this.#requirePage();
    return page.evaluate(collectMeetSnapshot, SNAPSHOT_CSS);
  }

  #requirePage(): Page {
    if (this.#page === null) {
      throw new Error("адаптер не в звонке: join не вызывали или уже был leave");
    }
    return this.#page;
  }

  /**
   * Синтетическое движение мыши. Без него тулбар Meet остаётся скрытым, и каждая проверка
   * видимости врёт — эта грабля стоила Vexa ложных «не впустили» на живых встречах.
   */
  async #wakeUi(page: Page = this.#requirePage()): Promise<void> {
    try {
      // eslint-disable-next-line sonarjs/pseudo-random -- дрожание курсора, а не криптография
      await page.mouse.move(640 + Math.random() * 40, 360 + Math.random() * 40);
    } catch {
      // Мышь — вспомогательное действие; её отказ не повод ронять чтение страницы.
    }
  }

  async #findVisible(selectors: readonly string[], page?: Page): Promise<Locator | null> {
    const target = page ?? this.#requirePage();
    for (const selector of selectors) {
      const locator = target.locator(selector).first();
      try {
        if (await locator.isVisible({ timeout: 200 })) return locator;
      } catch {
        // Неподходящий селектор — пробуем следующий; порядок в списке и есть приоритет.
      }
    }
    return null;
  }

  async #clickFirst(selectors: readonly string[], what: string, page?: Page): Promise<boolean> {
    const locator = await this.#findVisible(selectors, page);
    if (locator === null) return false;

    try {
      await locator.click({ timeout: CONTROL_TIMEOUT_MS });
      this.#log(`клик: ${what}`);
      return true;
    } catch (error) {
      this.#log(`не удалось нажать «${what}»: ${String(error)}`);
      return false;
    }
  }

  async join(url: string, displayName: string): Promise<void> {
    const target = pinMeetLocale(url);
    this.#displayName = displayName;

    const context = await this.#deps.browser.newContext({
      locale: MEET_BROWSER_LANG,
      viewport: { width: 1280, height: 720 },
    });
    this.#context = context;
    await this.#deps.prepareContext?.(context);

    const page = await context.newPage();
    this.#page = page;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    this.#log(`открыта встреча ${target} под именем «${displayName}»`);

    await this.#wakeUi();
    // Диалог «камеры и микрофона нет»: без него Meet не пускает дальше на машине без устройств.
    await this.#clickFirst(NO_DEVICE_CONTINUE_SELECTORS, "продолжить без устройств");

    const nameInput = await this.#findVisible(NAME_INPUT_SELECTORS);
    if (nameInput === null) {
      this.#log("поле имени не найдено — либо это не лобби гостя, либо вёрстка изменилась");
    } else {
      await nameInput.click();
      await nameInput.fill("");
      await nameInput.pressSequentially(displayName, { delay: TYPE_DELAY_MS });
    }

    await this.#clickFirst(MIC_OFF_SELECTORS, "выключить микрофон");
    await this.#clickFirst(CAMERA_OFF_SELECTORS, "выключить камеру");

    const isJoined = await this.#clickFirst(JOIN_CTA_SELECTORS, "войти");
    if (!isJoined) {
      this.#log(
        "кнопка входа не найдена: страница не похожа на лобби. Вердикт вынесет waitAdmitted — " +
          "молча «зашли» здесь не объявляется",
      );
    }
  }

  async waitAdmitted(timeoutMs: number): Promise<AdmissionOutcome> {
    const poll = this.#deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    let lastReason = "страница ещё не прочитана";

    while (Date.now() < deadline) {
      await this.#wakeUi();
      const verdict = classifyAdmission(await this.#snapshot());
      lastReason = verdict.reason;

      if (verdict.state !== "waiting") {
        this.#log(`дверь: ${verdict.state} — ${verdict.reason}`);
        if (verdict.state === "admitted") {
          // Панель участников точнее галереи: в галерее Meet показывает не всех, а
          // «один ли бот в звонке» решается именно числом людей.
          await this.#clickFirst(PEOPLE_BUTTON_SELECTORS, "открыть панель участников");
        }
        return verdict.state;
      }

      const left = Math.max(0, deadline - Date.now());
      await sleep(Math.min(poll, left));
    }

    this.#log(`дверь: timeout за ${String(timeoutMs)} мс — последнее, что видели: ${lastReason}`);
    return "timeout";
  }

  async activeSpeaker(): Promise<string | null> {
    const snapshot = await this.#snapshot();

    if (snapshot.tiles.length > 0 && !hasSpeakerSignal(snapshot)) {
      if (!this.#speakerSignalReported) {
        this.#speakerSignalReported = true;
        this.#log(
          "СИГНАЛА ГОВОРЯЩЕГО НЕТ: ни на одной плитке нет data-audio-level. Таймлайн будет " +
            "пустым — это не тишина в звонке, а изменившаяся вёрстка Meet",
        );
      }
      return null;
    }

    return pickActiveSpeaker(snapshot, this.#displayName ?? undefined);
  }

  /**
  Тристатное «один ли бот»: `null` — сигнала нет. Для сторожа, которому важна разница.
  */
  async aloneSignal(): Promise<boolean | null> {
    const alone = isAloneSnapshot(await this.#snapshot());

    if (alone === null && !this.#aloneSignalReported) {
      this.#aloneSignalReported = true;
      this.#log("СИГНАЛА ОБ УЧАСТНИКАХ НЕТ: ни плиток, ни панели — одиночество не определяется");
    }

    return alone;
  }

  async isAlone(): Promise<boolean> {
    return (await this.aloneSignal()) === true;
  }

  async leave(): Promise<void> {
    const page = this.#page;
    const context = this.#context;
    this.#page = null;
    this.#context = null;

    if (page !== null && !page.isClosed()) {
      try {
        await this.#wakeUi(page);
        const isClicked = await this.#clickFirst(LEAVE_SELECTORS, "выйти из звонка", page);
        if (!isClicked) {
          this.#log("кнопка выхода не найдена — закрываем вкладку, ресурсы важнее вежливости");
        }
      } catch (error) {
        this.#log(`выход из звонка не удался: ${String(error)}`);
      }
      await page.close();
    }

    await context?.close();
    this.#log("вкладка и контекст браузера закрыты");
  }
}
