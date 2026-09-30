/**
 * Смоук адаптера Контур.Толка: живой Chromium прогоняет НАСТОЯЩИЙ адаптер по странице-двойнику.
 *
 * Двойник (`fixtures/room.html`) повторяет тексты и подписи живой комнаты (разведка 30.09.2026) и
 * проверяет то, что ломается молча: узнавание закрытой комнаты и перезагрузки, форму имени, экран
 * устройств, немоту до и после входа, говорящего, одиночество, запрет корпоративного входа и
 * освобождение ресурсов. Живой вход в настоящую комнату — задача живого прогона, не этого файла.
 *
 *   node /app/src/kontur-adapter/smoke-kontur.ts
 *
 * Запускается в боевом образе (seccomp-профиль Chromium обязателен). Переменная окружения
 * SCRIBA_KONTUR_FIXTURES — каталог двойников (для прогона на испорченной копии).
 */
import { fileURLToPath } from "node:url";

import { type Browser, type Page, chromium } from "playwright";

import { KonturAdapter, type GuestRoomTiming, konturLaunchOptions } from "./kontur.ts";

declare const window: { readonly __forbidden: number };
declare const sessionStorage: { getItem(key: string): string | null };
declare const navigator: {
  readonly mediaDevices: { getUserMedia(constraints: object): Promise<unknown> };
};

const ROOM = "https://dodobrands.ktalk.ru/smoke-room";
/**
Имя гостя, которое процесс встречи передаёт адаптеру (профиль бота, `guestName`).
*/
const GUEST_NAME = "scriba (запись)";
const FIXTURES_DIRECTORY =
  process.env.SCRIBA_KONTUR_FIXTURES ?? fileURLToPath(new URL("fixtures/", import.meta.url));

const failures: string[] = [];

function check(isPassed: boolean, what: string, detail = ""): void {
  const line = detail === "" ? what : `${what} — ${detail}`;
  if (isPassed) {
    console.log(`  ✔ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✗ ПРОВАЛ: ${line}`);
  }
}

function equals(actual: unknown, expected: unknown, what: string): void {
  check(actual === expected, what, `ожидали ${String(expected)}, получили ${String(actual)}`);
}

interface Scene {
  readonly adapter: KonturAdapter;
  readonly log: string[];
  readonly page: () => Page | undefined;
}

function newScene(browser: Browser, guestRoom: GuestRoomTiming, stop?: AbortSignal): Scene {
  const log: string[] = [];
  const adapter = new KonturAdapter({
    browser,
    guestRoom,
    pollIntervalMs: 150,
    stepReadyTimeoutMs: 4000,
    log: (message) => {
      log.push(message);
    },
    ...(stop !== undefined && { stop }),
    prepareContext: async (context) => {
      await context.route("https://dodobrands.ktalk.ru/**", async (route) =>
        route.fulfill({
          path: `${FIXTURES_DIRECTORY}room.html`,
          contentType: "text/html; charset=utf-8",
        }),
      );
    },
  });
  return { adapter, log, page: () => browser.contexts().at(-1)?.pages()[0] };
}

const SHORT_ROOM: GuestRoomTiming = { waitMs: 3000, reloadMs: 700 };
const LONG_ROOM: GuestRoomTiming = { waitMs: 15_000, reloadMs: 700 };

async function loadsOf(scene: Scene): Promise<number> {
  const raw = await scene.page()?.evaluate(() => sessionStorage.getItem("loads"));
  return Number(raw ?? "0");
}

async function forbiddenClicks(scene: Scene): Promise<number | undefined> {
  return scene.page()?.evaluate(() => window.__forbidden);
}

function hasLogLine(scene: Scene, fragment: string): boolean {
  return scene.log.some((line) => line.includes(fragment));
}

async function sceneClosed(browser: Browser): Promise<void> {
  console.log("\n──── комната закрыта для гостей и не открывается → guest_access_closed");
  const scene = newScene(browser, SHORT_ROOM);
  const started = Date.now();
  await scene.adapter.join(`${ROOM}?scene=closed`, GUEST_NAME);
  const tookMs = Date.now() - started;
  check(tookMs >= 3000 && tookMs < 9000, "ждали окно ожидания, не дольше", `${String(tookMs)} мс`);
  check(
    (await loadsOf(scene)) >= 4,
    "страницу перезагружали",
    `загрузок ${String(await loadsOf(scene))}`,
  );
  equals(await forbiddenClicks(scene), 0, "«Войти» не нажата");
  equals(await scene.adapter.waitAdmitted(1000), "guest_access_closed", "исход двери");
  check(hasLogLine(scene, "комната закрыта для гостей"), "причина в журнале");
  await scene.adapter.leave();
  equals(browser.contexts().length, 0, "контекст закрыт после leave");
}

async function sceneOpens(browser: Browser): Promise<void> {
  console.log("\n──── комнату открыли на третьей загрузке → форма имени → устройства → звонок");
  const scene = newScene(browser, LONG_ROOM);
  await scene.adapter.join(`${ROOM}?scene=opens`, GUEST_NAME);
  equals(await loadsOf(scene), 3, "дождались открытия перезагрузками");
  equals(await scene.adapter.waitAdmitted(4000), "admitted", "впустили");
  const typed = await scene
    .page()
    ?.evaluate(() => (window as unknown as { __name: string }).__name);
  equals(typed, GUEST_NAME, "имя гостя введено в форму");
  const capture = await scene.page()?.evaluate(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return "granted";
    } catch (error) {
      return (error as { name: string }).name;
    }
  });
  equals(capture, "NotAllowedError", "захват микрофона страницей отказан");
  equals(await forbiddenClicks(scene), 0, "«Авторизация» не нажата");
  equals(await scene.adapter.activeSpeaker(), "Анна", "говорящий — плитка active-speaker");
  equals(await scene.adapter.aloneSignal(), false, "в звонке двое — не один");
  await scene.adapter.leave();
  check(hasLogLine(scene, "клик: покинуть встречу"), "вышли кнопкой, а не только закрыли вкладку");
  equals(browser.contexts().length, 0, "контекст закрыт после leave");
}

async function sceneOpen(browser: Browser): Promise<void> {
  console.log("\n──── комната открыта сразу — без перезагрузок");
  const scene = newScene(browser, LONG_ROOM);
  await scene.adapter.join(`${ROOM}?scene=open`, GUEST_NAME);
  equals(await loadsOf(scene), 1, "перезагрузок не было");
  equals(await scene.adapter.waitAdmitted(4000), "admitted", "впустили");
  await scene.adapter.leave();
}

async function sceneSlowForm(browser: Browser): Promise<void> {
  console.log("\n──── форма имени появилась, когда join уже вернулся (прод 30.09.2026)");
  const scene = newScene(browser, LONG_ROOM);
  await scene.adapter.join(`${ROOM}?scene=slow`, GUEST_NAME);
  equals(
    await scene.adapter.waitAdmitted(10_000),
    "admitted",
    "представился и вошёл из waitAdmitted",
  );
  check(hasLogLine(scene, "клик: присоединиться"), "«Присоединиться» нажата");
  await scene.adapter.leave();
}

async function sceneMicBeforeJoin(browser: Browser): Promise<void> {
  console.log("\n──── на экране устройств микрофон включён → в звонок не входим");
  const scene = newScene(browser, LONG_ROOM);
  // Отказ выносит тот, кто первым увидел экран устройств: join (бросает) или круг двери (mic_live).
  let message = "";
  let door = "";
  try {
    await scene.adapter.join(`${ROOM}?scene=mic`, GUEST_NAME);
    door = await scene.adapter.waitAdmitted(4000);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    message.includes("микрофон и камера") || door === "mic_live",
    "отказ с причиной",
    message || door,
  );
  check(!hasLogLine(scene, "клик: присоединиться"), "«Присоединиться» не нажата");
  await scene.adapter.leave();
}

async function sceneMicInCall(browser: Browser): Promise<void> {
  console.log("\n──── в звонке видна «Выключить микрофон» → mic_live");
  const scene = newScene(browser, LONG_ROOM);
  await scene.adapter.join(`${ROOM}?scene=mic-in-call`, GUEST_NAME);
  equals(await scene.adapter.waitAdmitted(4000), "mic_live", "исход двери");
  await scene.adapter.leave();
}

async function sceneAlone(browser: Browser): Promise<void> {
  console.log("\n──── в звонке только бот → один");
  const scene = newScene(browser, LONG_ROOM);
  await scene.adapter.join(`${ROOM}?scene=alone`, GUEST_NAME);
  equals(await scene.adapter.waitAdmitted(4000), "admitted", "впустили");
  equals(await scene.adapter.aloneSignal(), true, "один в звонке");
  equals(await scene.adapter.activeSpeaker(), null, "своя плитка говорящим не считается");
  await scene.adapter.leave();
}

async function sceneStop(browser: Browser): Promise<void> {
  console.log("\n──── остановка снаружи во время ожидания закрытой комнаты");
  const controller = new AbortController();
  const scene = newScene(browser, { waitMs: 60_000, reloadMs: 700 }, controller.signal);
  setTimeout(() => {
    controller.abort("smoke");
  }, 1500);
  const started = Date.now();
  await scene.adapter.join(`${ROOM}?scene=closed`, GUEST_NAME);
  const tookMs = Date.now() - started;
  check(tookMs < 5000, "ожидание прервано сигналом, а не окном", `${String(tookMs)} мс`);
  await scene.adapter.leave();
}

const browser = await chromium.launch(konturLaunchOptions());
try {
  await sceneClosed(browser);
  await sceneOpens(browser);
  await sceneOpen(browser);
  await sceneSlowForm(browser);
  await sceneMicBeforeJoin(browser);
  await sceneMicInCall(browser);
  await sceneAlone(browser);
  await sceneStop(browser);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\nСМОУК КОНТУРА ПРОВАЛЕН: ${String(failures.length)}\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("\nСМОУК КОНТУРА ПРОЙДЕН");
}
