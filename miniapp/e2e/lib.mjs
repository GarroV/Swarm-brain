// Хелперы мобильного смоука: подключение к уже запущенному Chrome по CDP + честные touch-жесты.
// Почему CDP-подключение, а не launch: браузер поднимается один раз (см. README), прогоны не
// плодят профили и не спорят с chrome-devtools MCP, который держит свой профиль заблокированным.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// puppeteer-core берём из кэша npx, если он не установлен в проект: смоук — инструмент
// разработчика, тащить браузерный стек в зависимости miniapp ради него незачем.
function loadPuppeteer() {
  for (const id of ["puppeteer-core", "puppeteer"]) {
    try {
      return require(id);
    } catch { /* следующий кандидат */ }
  }
  const fs = require("node:fs");
  const path = require("node:path");
  const base = path.join(process.env.HOME ?? "", ".npm/_npx");
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const p = path.join(base, dir, "node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("нет puppeteer-core: npm i -D puppeteer-core (или см. e2e/README.md)");
}

export const BASE_URL = process.env.SWARM_E2E_URL ?? "http://localhost:3111/";
export const CDP_URL = process.env.SWARM_E2E_CDP ?? "http://127.0.0.1:9333";
// iPhone 14/15: 390x844. Второй профиль — низкий экран, на нём список гарантированно скроллится.
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const PHONE_SHORT = { ...PHONE, height: 430 };
export const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

export async function connect(viewport = PHONE) {
  const puppeteer = loadPuppeteer();
  // protocolTimeout: аварийный прерыватель. Input.dispatchTouchEvent зависает намертво, если
  // предыдущий прогон умер с «пальцем на экране» или окно свёрнуто — лучше упасть с понятной
  // ошибкой, чем висеть.
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 20000 });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().startsWith(BASE_URL)) ?? pages[0];
  // Окно должно быть на переднем плане: у свёрнутой/перекрытой вкладки CDP не доставляет touch.
  await page.bringToFront().catch(() => {});
  await clearStuckTouch(page);
  await page.setViewport(viewport);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 160)));
  return { browser, page, errors };
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

/** Снять «залипший палец» от прошлого прогона: пустой touchEnd безвреден, если касания нет. */
async function clearStuckTouch(page) {
  try {
    const cdp = await page.createCDPSession();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } catch { /* нечего снимать */ }
}

export const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/** Тап пальцем (touchStart/touchEnd), а не mouse.click — иначе жесты SwipeRow не проверяются. */
export async function tap(page, x, y) {
  const h = await page.touchscreen.touchStart(x, y);
  await wait(60);
  await h.end();
  await wait(700);
}

/** Свайп пальцем: dx/dy — суммарный сдвиг. Вертикальный = скролл, горизонтальный = шторка. */
export async function swipe(page, x, y, dx, dy, steps = 14) {
  const h = await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= steps; i++) {
    await h.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await wait(18);
  }
  await h.end();
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

export const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));

/** Строки списка, завёрнутые в SwipeRow (у внутреннего слоя есть translateX). */
export const swipeRows = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll("div.relative.overflow-hidden")]
    .filter((d) => /translateX/.test(d.children[1]?.style?.transform || ""));
  return rows.map((r) => {
    const b = r.getBoundingClientRect();
    return { y: Math.round(b.y), h: Math.round(b.height), dx: r.children[1].style.transform, title: r.innerText.split("\n")[0].slice(0, 30) };
  });
});

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
