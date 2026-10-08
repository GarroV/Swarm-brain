/**
 * `KonturAdapter` — Playwright вокруг чистых функций этого блока: гостевой вход в Контур.Толк.
 *
 * Решений о смысле увиденного здесь нет: страницу читает `dom.ts`, этап входа и немоту решает
 * `page.ts`, говорящего и одиночество — `speakers.ts`. Этот файл доводит браузер до звонка и
 * освобождает ресурсы.
 *
 * Путь гостя (D040, живая комната владельца 30.09.2026): ссылка → (комната закрыта — ждём, пока
 * человек её откроет, перезагружая страницу) → форма «Представьтесь» → экран устройств →
 * «Присоединиться» → звонок. Бот входит НЕМЫМ: контексту не выданы разрешения, захват устройств
 * отказан скриптом (`denyCaptureDevices`), и перед «Присоединиться», и в звонке адаптер
 * проверяет, что кнопок «Выключить микрофон/камеру» нет. Нарушение — не входить / выйти.
 *
 * Корпоративный вход («Войти», «Авторизация») бот не нажимает никогда.
 */
import type { Browser, BrowserContext, LaunchOptions, Locator, Page } from "playwright";

import { chromiumLaunchOptions } from "../container/browser.ts";
import type { AdmissionOutcome, PlatformAdapter } from "../meet-adapter/types.ts";
import {
  CONTINUE_SELECTORS,
  JOIN_SELECTORS,
  KONTUR_CSS,
  LEAVE_SELECTORS,
  NAME_INPUT_SELECTORS,
  collectKonturSnapshot,
  denyCaptureDevices,
} from "./dom.ts";
import {
  type StageVerdict,
  classifyKonturStage,
  mutedViolation,
  nextGuestRoomStep,
} from "./page.ts";
import { isAloneKonturSnapshot, pickKonturSpeaker } from "./speakers.ts";
import {
  KONTUR_TURN_RELAYS,
  PEERS_GLOBAL,
  collectAudioHealth,
  pinTurnRelays,
} from "./turn-relay.ts";
import type { KonturSnapshot } from "./types.ts";
import { checkKonturUrl } from "./url.ts";

/**
Язык интерфейса: фразы входа сверяются по-русски.
*/
const KONTUR_BROWSER_LANG = "ru-RU";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const CONTROL_TIMEOUT_MS = 5000;
/**
Сколько ждать, пока страница дорисует очередной экран входа (форму, устройства).
*/
const STEP_READY_TIMEOUT_MS = 20_000;
const TYPE_DELAY_MS = 60;
/**
Как часто писать в журнал, доходит ли звук звонка (`turn-relay.ts`).
*/
const AUDIO_REPORT_INTERVAL_MS = 60_000;

export interface GuestRoomTiming {
  /**
  Сколько всего ждать, пока комнату откроют для гостей.
  */
  readonly waitMs: number;
  /**
  Как часто перезагружать закрытую комнату.
  */
  readonly reloadMs: number;
}

export interface KonturAdapterDependencies {
  readonly browser: Browser;
  /**
  Ожидание закрытой комнаты — из профиля бота (`BOT_PROFILE.guestRoom`).
  */
  readonly guestRoom: GuestRoomTiming;
  readonly log?: (message: string) => void;
  readonly pollIntervalMs?: number;
  readonly stepReadyTimeoutMs?: number;
  /**
   * Остановка снаружи (SIGTERM, поводок, потолок): ожидание закрытой комнаты длится минуты, и
   * сигнал не должен ждать его конца.
   */
  readonly stop?: AbortSignal;
  /**
  Смоук вешает сюда подмену ответов Толка страницами-двойниками.
  */
  readonly prepareContext?: (context: BrowserContext) => Promise<void>;
}

/**
Параметры запуска Chromium для Толка: язык интерфейса — русский.
*/
export function konturLaunchOptions(): LaunchOptions {
  const options = chromiumLaunchOptions({ lang: KONTUR_BROWSER_LANG });
  return {
    headless: options.headless,
    chromiumSandbox: options.chromiumSandbox,
    ignoreDefaultArgs: [...options.ignoreDefaultArgs],
    args: [...options.args],
  };
}

export class KonturAdapter implements PlatformAdapter {
  readonly #deps: KonturAdapterDependencies;
  readonly #log: (message: string) => void;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #displayName: string | null = null;
  /**
  Комната так и не открылась для гостей — причина для журнала; `null` — открылась.
  */
  #closedReason: string | null = null;
  /**
  Последний шаг входа (представиться / присоединиться) и когда он сделан — чтобы не повторять.
  */
  #lastStep: { readonly stage: StageVerdict["stage"]; readonly atMs: number } | null = null;
  #aloneSignalReported = false;
  #speakerSignalReported = false;
  #audioReport: { readonly atMs: number; readonly packets: number } | null = null;

  constructor(dependencies: KonturAdapterDependencies) {
    this.#deps = dependencies;
    this.#log =
      dependencies.log ??
      ((message): void => {
        console.log(`[kontur] ${message}`);
      });
  }

  get #poll(): number {
    return this.#deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  get #isStopped(): boolean {
    return this.#deps.stop?.aborted === true;
  }

  #requirePage(): Page {
    if (this.#page === null) {
      throw new Error("адаптер не в звонке: join не вызывали или уже был leave");
    }
    return this.#page;
  }

  async #snapshot(): Promise<KonturSnapshot> {
    return this.#requirePage().evaluate(collectKonturSnapshot, KONTUR_CSS);
  }

  async #stage(): Promise<{ snapshot: KonturSnapshot; verdict: StageVerdict }> {
    const snapshot = await this.#snapshot();
    return { snapshot, verdict: classifyKonturStage(snapshot) };
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

  /**
   * Пауза, которую прерывает остановка снаружи. Шаг — опрос: сигнал ждёт не дольше него.
   */
  async #pause(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (!this.#isStopped) {
      const left = until - Date.now();
      if (left <= 0) return;
      await this.#requirePage().waitForTimeout(Math.min(left, this.#poll));
    }
  }

  /**
   * Ждать, пока комнату откроют для гостей (D040). Возвращает этап, на котором страница
   * перестала быть закрытой, или `null` — не открылась за окно ожидания либо остановили.
   */
  async #waitGuestRoom(): Promise<StageVerdict | null> {
    const { waitMs, reloadMs } = this.#deps.guestRoom;
    const startedAtMs = Date.now();
    let lastLoadAtMs = startedAtMs;
    let isClosedReported = false;

    while (!this.#isStopped) {
      const { verdict } = await this.#stage();
      const step = nextGuestRoomStep(verdict.stage, {
        nowMs: Date.now(),
        startedAtMs,
        lastLoadAtMs,
        waitMs,
        reloadMs,
      });
      if (step === "proceed") {
        const isLoading =
          verdict.stage === "unknown" &&
          Date.now() - lastLoadAtMs < (this.#deps.stepReadyTimeoutMs ?? STEP_READY_TIMEOUT_MS);
        if (!isLoading) return verdict;
        await this.#pause(this.#poll);
        continue;
      }
      if (!isClosedReported) {
        isClosedReported = true;
        this.#log(
          `${verdict.reason} — ждём, пока её откроют: до ${String(waitMs / 1000)} с, ` +
            `перезагрузка раз в ${String(reloadMs / 1000)} с`,
        );
      }
      if (step === "give_up") {
        this.#closedReason = `${verdict.reason}; не открылась за ${String(waitMs / 1000)} с`;
        this.#log(`комната так и не открылась для гостей — уходим: ${this.#closedReason}`);
        return null;
      }
      if (step === "reload") {
        await this.#requirePage().reload({
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        lastLoadAtMs = Date.now();
        continue;
      }
      await this.#pause(this.#poll);
    }
    this.#log("остановлены, пока ждали открытия комнаты");
    return null;
  }

  async #introduce(displayName: string): Promise<void> {
    const input = await this.#findVisible(NAME_INPUT_SELECTORS);
    if (input === null) {
      this.#log("поле имени не найдено — вёрстка формы изменилась");
      return;
    }
    await input.click();
    await input.fill("");
    await input.pressSequentially(displayName, { delay: TYPE_DELAY_MS });
    if (!(await this.#clickFirst(CONTINUE_SELECTORS, "продолжить"))) {
      this.#log("кнопка «Продолжить» не найдена — попробуем на следующем круге");
    }
  }

  /**
   * Сделать шаг входа, который просит текущий экран: форма имени — представиться, экран
   * устройств — проверить немоту и нажать «Присоединиться». Зовётся и из `join`, и на каждом
   * круге `waitAdmitted`: комната открывается перезагрузкой, первая загрузка бывает медленной,
   * и экран входа может показаться уже после того, как `join` вернулся. Тот же шаг повторяется
   * не чаще раза в `stepReadyTimeoutMs`, чтобы не перебивать имя на каждом опросе.
   * Возвращает нарушение немоты — тогда в звонок не входим; иначе `null`.
   */
  async #advance(verdict: StageVerdict, snapshot: KonturSnapshot): Promise<string | null> {
    if (verdict.stage !== "name_form" && verdict.stage !== "devices") return null;
    const now = Date.now();
    const retryMs = this.#deps.stepReadyTimeoutMs ?? STEP_READY_TIMEOUT_MS;
    const last = this.#lastStep;
    if (last !== null && last.stage === verdict.stage && now - last.atMs < retryMs) return null;
    this.#lastStep = { stage: verdict.stage, atMs: now };

    if (verdict.stage === "name_form") {
      await this.#introduce(this.#displayName ?? "");
      return null;
    }
    const violation = mutedViolation(snapshot);
    if (violation !== null) return violation;
    if (!(await this.#clickFirst(JOIN_SELECTORS, "присоединиться"))) {
      this.#log("кнопка «Присоединиться» не найдена — попробуем на следующем круге");
    }
    return null;
  }

  /**
   * Раз в минуту — доходит ли звук: число принятых аудиопакетов и путь медиа. Ноль новых пакетов
   * при живом соединении — та самая тишина #861, она пишется громко, а не угадывается по записи.
   */
  async #reportAudio(): Promise<void> {
    const now = Date.now();
    const previous = this.#audioReport;
    if (previous !== null && now - previous.atMs < AUDIO_REPORT_INTERVAL_MS) return;
    try {
      const health = await this.#requirePage().evaluate(collectAudioHealth, PEERS_GLOBAL);
      this.#audioReport = { atMs: now, packets: health.packets };
      if (previous === null) return;
      const fresh = health.packets - previous.packets;
      const line = `аудиопакетов +${String(fresh)} за минуту, соединений ${String(health.peers)}, путь ${health.path ?? "не выбран"}`;
      this.#log(
        fresh > 0
          ? `звук: ${line}`
          : `ЗВУКА ИЗ ЗВОНКА НЕТ (все молчат или медиа не доходит): ${line}`,
      );
    } catch (error) {
      this.#log(`звук: статистика WebRTC не прочитана — ${String(error)}`);
      this.#audioReport = { atMs: now, packets: previous?.packets ?? 0 };
    }
  }

  async join(url: string, displayName: string): Promise<void> {
    const target = checkKonturUrl(url);
    this.#displayName = displayName;
    this.#closedReason = null;
    this.#lastStep = null;

    const context = await this.#deps.browser.newContext({
      locale: KONTUR_BROWSER_LANG,
      viewport: { width: 1280, height: 720 },
      // Немота бота, половина первая: ни микрофона, ни камеры контексту не выдано.
      permissions: [],
    });
    this.#context = context;
    // Половина вторая: захват устройств отказан до того, как Толк успеет его попросить.
    await context.addInitScript(denyCaptureDevices);
    // Медиа — только через проверенные TURN Толка: часть его серверов звук не пропускает (#861).
    await context.addInitScript(pinTurnRelays, {
      relays: KONTUR_TURN_RELAYS,
      peersGlobal: PEERS_GLOBAL,
    });
    await this.#deps.prepareContext?.(context);

    const page = await context.newPage();
    this.#page = page;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    this.#log(`открыта комната ${target} гостем под именем «${displayName}»`);

    const verdict = await this.#waitGuestRoom();
    if (verdict === null) return;
    const violation = await this.#advance(verdict, await this.#snapshot());
    if (violation !== null) {
      throw new Error(`${violation} — в звонок не входим`);
    }
  }

  async waitAdmitted(timeoutMs: number): Promise<AdmissionOutcome> {
    if (this.#closedReason !== null) {
      this.#log(`дверь: guest_access_closed — ${this.#closedReason}`);
      return "guest_access_closed";
    }
    const deadline = Date.now() + timeoutMs;
    let lastReason = "страница ещё не прочитана";

    while (Date.now() < deadline) {
      const { snapshot, verdict } = await this.#stage();
      lastReason = verdict.reason;
      if (verdict.stage === "in_call") {
        const violation = mutedViolation(snapshot);
        if (violation !== null) {
          this.#log(`дверь: mic_live — ${violation}; выходим сразу`);
          return "mic_live";
        }
        this.#log(`дверь: admitted — ${verdict.reason}`);
        return "admitted";
      }
      const violation = await this.#advance(verdict, snapshot);
      if (violation !== null) {
        this.#log(`дверь: mic_live — ${violation}; в звонок не входим`);
        return "mic_live";
      }
      if (verdict.stage === "closed") {
        this.#closedReason = verdict.reason;
        this.#log(`дверь: guest_access_closed — комнату закрыли для гостей, пока бот входил`);
        return "guest_access_closed";
      }
      const left = Math.max(0, deadline - Date.now());
      await this.#requirePage().waitForTimeout(Math.min(this.#poll, left));
    }

    this.#log(`дверь: timeout за ${String(timeoutMs)} мс — последнее, что видели: ${lastReason}`);
    return "timeout";
  }

  async activeSpeaker(): Promise<string | null> {
    await this.#reportAudio();
    const snapshot = await this.#snapshot();
    if (snapshot.tiles.length === 0) {
      if (!this.#speakerSignalReported) {
        this.#speakerSignalReported = true;
        this.#log(
          "СИГНАЛА ГОВОРЯЩЕГО НЕТ: плиток conference-participant нет. Таймлайн будет пустым — " +
            "это не тишина в звонке, а изменившаяся вёрстка Толка",
        );
      }
      return null;
    }
    return pickKonturSpeaker(snapshot, this.#displayName ?? undefined);
  }

  /**
  Тристатное «один ли бот»: `null` — сигнала нет.
  */
  async aloneSignal(): Promise<boolean | null> {
    const alone = isAloneKonturSnapshot(await this.#snapshot());
    if (alone === null && !this.#aloneSignalReported) {
      this.#aloneSignalReported = true;
      this.#log("СИГНАЛА ОБ УЧАСТНИКАХ НЕТ: ни числа на «Участники», ни плиток");
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
        if (!(await this.#clickFirst(LEAVE_SELECTORS, "покинуть встречу", page))) {
          this.#log("кнопка выхода не найдена — закрываем вкладку, соединение рвётся вместе с ней");
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
