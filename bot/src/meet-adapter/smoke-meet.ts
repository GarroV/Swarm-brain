/**
 * Смоук адаптера Meet: живой Chromium прогоняет НАСТОЯЩИЙ адаптер по страницам-двойникам.
 *
 * Зачем двойники, а не живая встреча: встреча Google требует аккаунта и человека у двери, и
 * четыре исхода двери на ней воспроизводятся только руками (это задача живого прогона T004).
 * Двойники же проверяют ровно то, что ломается молча: селекторы, порядок разбора, реакцию на
 * автоскрытие тулбара, освобождение ресурсов. Всё это исполняется в браузере, а не в моках.
 *
 *   node /app/src/meet-adapter/smoke-meet.ts
 *
 * Переменные окружения:
 *   SCRIBA_MEET_FIXTURES — каталог страниц-двойников (для прогона на испорченной копии);
 *   SCRIBA_MEET_LIVE=0   — не ходить в живой meet.google.com; прогон тогда НЕ полный и
 *                          заканчивается кодом 2, а не зелёным.
 */
import { fileURLToPath } from "node:url";

import { type Browser, chromium } from "playwright";

import { MeetAdapter, meetLaunchOptions } from "./meet.ts";
import { pinMeetLocale } from "./url.ts";

/**
Язык браузера читается со страницы; библиотеку DOM ради одного поля не включаем.
*/
declare const navigator: { readonly language: string };

const MEETING_URL = "https://meet.google.com/abc-defg-hij";
const FIXTURES_DIRECTORY =
  process.env.SCRIBA_MEET_FIXTURES ?? fileURLToPath(new URL("fixtures/", import.meta.url));

const failures: string[] = [];
const checks: string[] = [];

function check(isPassed: boolean, what: string, detail = ""): void {
  const line = detail === "" ? what : `${what} — ${detail}`;
  if (isPassed) {
    checks.push(line);
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
  readonly adapter: MeetAdapter;
  readonly log: readonly string[];
  readonly browser: Browser;
}

async function openScene(browser: Browser, fixture: string): Promise<Scene> {
  const log: string[] = [];
  const adapter = new MeetAdapter({
    browser,
    pollIntervalMs: 150,
    log: (message) => {
      log.push(message);
    },
    prepareContext: async (context) => {
      await context.route("https://meet.google.com/**", async (route) => {
        await route.fulfill({
          path: `${FIXTURES_DIRECTORY}${fixture}`,
          contentType: "text/html; charset=utf-8",
        });
      });
    },
  });

  await adapter.join(MEETING_URL, "scriba");
  return { adapter, log, browser };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sceneLobby(browser: Browser): Promise<void> {
  console.log("\n──── лобби: имя введено, локаль запиннена, дверь ещё не открыта");
  const scene = await openScene(browser, "lobby.html");
  const context = browser.contexts().at(-1);
  const page = context?.pages()[0];

  equals(page?.url(), `${MEETING_URL}?hl=en`, "ссылка ушла с ?hl=en");
  // eslint-disable-next-line unicorn/isolated-functions -- функция исполняется в браузере, там navigator есть
  const language = await page?.evaluate(() => navigator.language);
  equals(language, "en-US", "язык браузера запиннен");
  equals(await page?.locator("input[jsname]").inputValue(), "scriba", "имя введено в поле");
  equals(await scene.adapter.waitAdmitted(1200), "timeout", "лобби без ответа хоста — timeout");

  await scene.adapter.leave();
  equals(browser.contexts().length, 0, "контекст закрыт после leave");
}

async function sceneDoor(browser: Browser, fixture: string, expected: string): Promise<void> {
  console.log(`\n──── дверь: ${fixture} → ${expected}`);
  const scene = await openScene(browser, fixture);
  equals(await scene.adapter.waitAdmitted(2500), expected, `исход двери по ${fixture}`);
  await scene.adapter.leave();
  equals(browser.contexts().length, 0, "контекст закрыт после leave");
}

async function sceneInCall(browser: Browser): Promise<void> {
  console.log("\n──── в звонке: говорящий, число участников, выход из-под автоскрытия тулбара");
  const scene = await openScene(browser, "in-call-speaking.html");
  const page = browser.contexts().at(-1)?.pages()[0];

  equals(await scene.adapter.waitAdmitted(2500), "admitted", "впустили");
  check(
    scene.log.some((line) => line.includes("клик: открыть панель участников")),
    "панель участников открыта — счёт людей идёт по ней, а не по галерее",
  );
  equals(await scene.adapter.activeSpeaker(), "Василий Гарро", "имя говорящего");
  equals(await scene.adapter.isAlone(), false, "в звонке не один");

  // Тулбар Meet прячется сам. Сначала убеждаемся, что он действительно спрятался, —
  // иначе следующая проверка зелёная по случайности, а не по делу.
  await sleep(1800);
  equals(
    await page?.locator('button[aria-label="Leave call"]').isVisible(),
    false,
    "тулбар спрятался сам",
  );

  await scene.adapter.leave();
  check(
    scene.log.some((line) => line.includes("клик: выйти из звонка")),
    "кнопка выхода нажата — синтетическое движение мыши вернуло тулбар",
  );
  equals(browser.contexts().length, 0, "вкладка и контекст освобождены");
}

async function sceneAlone(browser: Browser): Promise<void> {
  console.log("\n──── один в звонке: сторож дожидается порога и выходит");
  const scene = await openScene(browser, "in-call-alone.html");
  equals(await scene.adapter.isAlone(), true, "бот в звонке один");

  const { watchAlone } = await import("./alone.ts");
  const startedAt = Date.now();
  const isLeft = await watchAlone({
    probe: () => scene.adapter.aloneSignal(),
    onLeave: () => scene.adapter.leave(),
    thresholdMs: 1000,
    pollMs: 150,
  });

  check(isLeft, "сторож вывел бота из звонка");
  check(Date.now() - startedAt >= 1000, "выход не раньше порога");
  equals(browser.contexts().length, 0, "ресурсы освобождены");
}

async function sceneNoSignal(browser: Browser): Promise<void> {
  console.log("\n──── сигнала громкости нет: молчать об этом нельзя");
  const scene = await openScene(browser, "in-call-no-signal.html");
  equals(await scene.adapter.activeSpeaker(), null, "имя не выдумано");
  check(
    scene.log.some((line) => line.includes("СИГНАЛА ГОВОРЯЩЕГО НЕТ")),
    "отсутствие сигнала названо громко",
  );
  await scene.adapter.leave();
}

function hasCyrillic(text: string): boolean {
  return /\p{Script=Cyrillic}/u.test(text);
}

/**
 * Живой Google. Браузер поднимается с русским языком — так выглядит машина пользователя,
 * у которого интерфейс не английский. Без `?hl=en` страница обязана прийти русской, с ним —
 * английской. Если обе английские, проверка НИЧЕГО не доказала, и это сказано вслух.
 */
async function sceneLiveLocale(): Promise<void> {
  console.log("\n──── живой meet.google.com: пиннинг локали против русского браузера");
  const browser = await chromium.launch(meetLaunchOptions({ lang: "ru-RU" }));
  try {
    const context = await browser.newContext({ locale: "ru-RU" });
    const page = await context.newPage();

    await page.goto(MEETING_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const russianText = await page.locator("body").innerText();
    const russian = russianText.slice(0, 500);

    await page.goto(pinMeetLocale(MEETING_URL), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const pinnedText = await page.locator("body").innerText();
    const pinned = pinnedText.slice(0, 500);

    console.log(`  без hl: ${russian.replaceAll("\n", " ").slice(0, 120)}`);
    console.log(`  с hl=en: ${pinned.replaceAll("\n", " ").slice(0, 120)}`);

    check(
      hasCyrillic(russian),
      "без пиннинга живой Meet отвечает по-русски (иначе доказывать нечего)",
    );
    check(!hasCyrillic(pinned), "с ?hl=en тот же Meet отвечает по-английски");
  } finally {
    await browser.close();
  }
}

/**
 * Живой Google, вторая половина: настоящий адаптер против настоящей вёрстки Meet.
 * Ссылка с несуществующим кодом — единственный исход двери, который воспроизводится без
 * аккаунта и без человека у двери. Google отвечает «You can\'t join this video call», и
 * адаптер обязан назвать это отказом, а не стоять до таймаута.
 */
async function sceneLiveDoor(): Promise<void> {
  console.log("\n──── живой meet.google.com: несуществующая встреча читается как отказ");
  const browser = await chromium.launch(meetLaunchOptions());
  try {
    const log: string[] = [];
    const adapter = new MeetAdapter({
      browser,
      pollIntervalMs: 1000,
      log: (message) => {
        log.push(message);
      },
    });

    await adapter.join(MEETING_URL, "scriba");
    equals(await adapter.waitAdmitted(20_000), "denied", "живой Meet: несуществующий код");
    console.log(`  из лога адаптера: ${log.at(-1) ?? "(пусто)"}`);
    await adapter.leave();
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch(meetLaunchOptions());
  try {
    await sceneLobby(browser);
    await sceneDoor(browser, "waiting.html", "timeout");
    await sceneDoor(browser, "denied.html", "denied");
    await sceneDoor(browser, "captcha.html", "captcha");
    await sceneInCall(browser);
    await sceneAlone(browser);
    await sceneNoSignal(browser);
  } finally {
    await browser.close();
  }

  const isLive = process.env.SCRIBA_MEET_LIVE !== "0";
  if (isLive) {
    await sceneLiveLocale();
    await sceneLiveDoor();
  } else {
    console.log("\n──── живой meet.google.com ПРОПУЩЕН (SCRIBA_MEET_LIVE=0) — прогон не полный");
  }

  console.log(`\nвыполнено проверок: ${String(checks.length + failures.length)}`);
  if (failures.length > 0) {
    console.log(`ПРОВАЛЕНО ${String(failures.length)}:`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
    return;
  }
  if (!isLive) {
    console.log("зелёного нет: живая часть пропущена");
    process.exitCode = 2;
    return;
  }
  console.log("смоук адаптера пройден полностью");
}

await main();
