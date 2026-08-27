// Хелперы мобильного смоука: свой браузер на временном профиле + честные touch-жесты.
//
// Почему набор поднимает Chrome сам, а не подключается к уже открытому: у долгоживущего
// инстанса ломается ввод. После нескольких прогонов (особенно после группы с десктопным
// вьюпортом, где hasTouch=false) `Input.dispatchTouchEvent` начинает висеть до таймаута на
// ЛЮБОМ жесте и лечится только перезапуском браузера — проверено на себе: 42/42, 42/42, затем
// «touch timeout» на первом же свайпе. Свой процесс на чистом профиле убирает это в корне.
// Подключиться к внешнему браузеру всё ещё можно: `SWARM_E2E_CDP=http://127.0.0.1:9333`.
import { createRequire } from "node:module";
import os from "node:os";
import nodePath from "node:path";

const require = createRequire(import.meta.url);

// puppeteer-core берём из проекта, иначе из кэша npx: смоук — инструмент разработчика,
// тащить браузерный стек в зависимости miniapp ради него незачем.
function loadPuppeteer() {
  for (const id of ["puppeteer-core", "puppeteer"]) {
    try {
      return require(id);
    } catch { /* следующий кандидат */ }
  }
  const fs = require("node:fs");
  const base = nodePath.join(process.env.HOME ?? "", ".npm/_npx");
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const p = nodePath.join(base, dir, "node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("нет puppeteer-core: npm i -D puppeteer-core (или см. e2e/README.md)");
}

export const BASE_URL = process.env.SWARM_E2E_URL ?? "http://localhost:3111/";
export const CHROME = process.env.SWARM_E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// iPhone 14/15: 390x844. Второй профиль — низкий экран, на нём список гарантированно скроллится.
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const PHONE_SHORT = { ...PHONE, height: 430 };
export const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

let browser = null;
let owned = false;

async function getBrowser() {
  if (browser) return browser;
  const puppeteer = loadPuppeteer();
  if (process.env.SWARM_E2E_CDP) {
    browser = await puppeteer.connect({ browserURL: process.env.SWARM_E2E_CDP, defaultViewport: null, protocolTimeout: 20000 });
    owned = false;
    return browser;
  }
  browser = await puppeteer.launch({
    executablePath: CHROME,
    // Видимое окно — по SWARM_E2E_HEADED=1, когда хочется смотреть глазами.
    headless: process.env.SWARM_E2E_HEADED ? false : "new",
    userDataDir: nodePath.join(os.tmpdir(), `swarm-e2e-${process.pid}`),
    args: ["--window-size=430,900", "--no-first-run", "--no-default-browser-check"],
    defaultViewport: null,
    protocolTimeout: 20000,
  });
  owned = true;
  return browser;
}

/** Закрыть свой браузер (внешний, подключённый по CDP, только отпускаем). */
export async function shutdown() {
  if (!browser) return;
  try {
    if (owned) await browser.close();
    else await browser.disconnect();
  } catch { /* уже закрыт */ }
  browser = null;
}

/**
 * Страница с нужным вьюпортом. Возвращает объект той же формы, что раньше отдавал connect(),
 * чтобы группы проверок не знали, свой браузер или внешний: `browser.disconnect()` внутри
 * группы теперь ничего не закрывает — общий процесс живёт до shutdown() в конце набора.
 */
export async function connect(viewport = PHONE) {
  const b = await getBrowser();
  const pages = await b.pages();
  const page = pages.find((p) => p.url().startsWith(BASE_URL)) ?? pages[0] ?? (await b.newPage());
  await page.bringToFront().catch(() => {});
  await page.setViewport(viewport);
  // Тач-эмуляцию включаем ЯВНО: setViewport её обратно не поднимает, и после десктопной группы
  // касания перестают доходить.
  try {
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: !!viewport.hasTouch, maxTouchPoints: 1 });
    await cdp.detach();
  } catch { /* эмуляция недоступна — жесты всё равно попробуем */ }
  const errors = [];
  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 160)));
  return { browser: { disconnect: async () => {} }, page, errors };
}

/** Чистый вход: сбрасываем сохранённый таб/вид, иначе прогон зависит от предыдущего. */
export async function freshLoad(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem("roy_tasks_view");
  });
  await page.reload({ waitUntil: "networkidle2" });
  await wait(1800);
}

export const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/**
 * Проверка «браузер вообще принимает касания» — на случай подключения к внешнему инстансу с
 * поломанным вводом (со своим браузером такого не бывает: профиль чистый).
 */
export async function assertTouchWorks(page) {
  try {
    await tap(page, 5, 5);
  } catch {
    console.error(
      "\nБраузер не принимает касания (Input.dispatchTouchEvent висит).\n" +
      "Если задан SWARM_E2E_CDP — перезапусти тот браузер; без него набор поднимает свой сам.\n",
    );
    await shutdown();
    process.exit(2);
  }
}

// Жесты — через свежую CDP-сессию, со своим таймаутом и одной повторной попыткой.
const GESTURE_TIMEOUT = 5000;

async function withTouchSession(page, fn, attempt = 0) {
  const cdp = await page.createCDPSession();
  const point = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }];
  const send = (type, points) => Promise.race([
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("touch timeout")), GESTURE_TIMEOUT)),
  ]);
  try {
    await fn(send, point);
  } catch (e) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
    await cdp.detach().catch(() => {});
    if (attempt === 0) {
      await wait(500);
      return withTouchSession(page, fn, 1);
    }
    throw e;
  }
  await cdp.detach().catch(() => {});
}

/** Тап пальцем (touchStart/touchEnd), а не mouse.click — иначе жесты SwipeRow не проверяются. */
export async function tap(page, x, y) {
  await withTouchSession(page, async (send, point) => {
    await send("touchStart", point(x, y));
    await wait(60);
    await send("touchEnd", []);
  });
  await wait(700);
}

/** Свайп пальцем: dx/dy — суммарный сдвиг. Вертикальный = скролл, горизонтальный = шторка. */
export async function swipe(page, x, y, dx, dy, steps = 14) {
  await withTouchSession(page, async (send, point) => {
    await send("touchStart", point(x, y));
    for (let i = 1; i <= steps; i++) {
      await send("touchMove", point(x + (dx * i) / steps, y + (dy * i) / steps));
      await wait(18);
    }
    await send("touchEnd", []);
  });
  await wait(700);
}

/** Клик по видимой кнопке с таким текстом (сначала точное совпадение, потом вхождение). */
export function clickText(page, text) {
  return page.evaluate((t) => {
    const all = [...document.querySelectorAll('button,[role="button"],a')];
    const el = all.find((x) => x.innerText.trim() === t) ?? all.find((x) => x.innerText.includes(t));
    if (!el) return false;
    el.click();
    return true;
  }, text);
}

/**
 * Ждать условие на странице, а не «сколько-нибудь миллисекунд». Фиксированные паузы дают
 * плавающие падения: возврат из вычитки иногда не успевал за 1200мс, и следующая проверка
 * читала ещё старый экран — падало четыре проверки подряд на исправном продукте.
 */
export async function waitFor(page, fn, { timeout = 6000, step = 200 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) return false;
    await wait(step);
  }
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));

/** Строки списка, завёрнутые в SwipeRow (у внутреннего слоя есть translateX). */
export const swipeRows = (page) => page.evaluate(() => {
  // Опора — [data-swipe-content] (сдвигаемый слой SwipeRow). По порядку детей искать нельзя:
  // слой действий рендерится только при тронутой шторке.
  return [...document.querySelectorAll("[data-swipe-content]")].map((content) => {
    const row = content.parentElement;
    const b = row.getBoundingClientRect();
    return { y: Math.round(b.y), h: Math.round(b.height), dx: content.style.transform, title: row.innerText.split("\n")[0].slice(0, 30) };
  });
});

/**
 * Строки, положение которых устаканилось. После закрытия карточки задачи список перезапрашивается
 * (bumpTasks → refetch) и строки уезжают: координата, снятая сразу после Escape, к моменту жеста
 * уже врала — свайп попадал в промежуток между строками и «шторка не открывалась» на исправном коде.
 */
export async function stableRows(page, { timeout = 5000 } = {}) {
  const until = Date.now() + timeout;
  let prev = JSON.stringify(await swipeRows(page));
  for (;;) {
    await wait(300);
    const now = JSON.stringify(await swipeRows(page));
    if (now === prev || Date.now() > until) return JSON.parse(now);
    prev = now;
  }
}

export const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('[role="dialog"]'));

/** Нижний таб-бар: подписи кнопок (с бейджами) — по нему проверяем набор разделов. */
export const tabBar = (page) => page.evaluate(() => {
  const bar = [...document.querySelectorAll("div")]
    .filter((d) => {
      const r = d.getBoundingClientRect();
      return r.height < 100 && r.bottom > window.innerHeight - 6 && d.querySelectorAll("button").length >= 3;
    })
    .pop();
  return bar ? [...bar.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()) : null;
});

export function reporter(name) {
  const results = [];
  return {
    ok(label, pass, detail = "") {
      results.push({ label, pass });
      console.log(`${pass ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
      return pass;
    },
    finish(errors = []) {
      const bad = [...new Set(errors)];
      if (bad.length) console.log("\nошибки консоли:", JSON.stringify(bad.slice(0, 6)));
      const passed = results.filter((r) => r.pass).length;
      console.log(`\n${name}: ${passed}/${results.length}`);
      return passed === results.length && bad.length === 0;
    },
  };
}
