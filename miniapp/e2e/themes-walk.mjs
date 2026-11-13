// Визуальный обход цветовых схем: те же ключевые экраны во ВСЕХ схемах и режимах, 1440×900.
// Нужен, чтобы глазами увидеть то, чего не ловит гейт цветов: белое пятно на тёмной схеме, тёмный
// текст на тёмном, непрокрашенную кнопку. Всё на DEV_MODE-моках, прод не задействован.
//
// Одна команда (из корня репозитория):  make themes-walk
//   · без SWARM_E2E_URL — сам собирает miniapp с NEXT_PUBLIC_DEV_MODE=true, поднимает out/ на
//     свободном порту и гасит его в конце;
//   · с SWARM_E2E_URL — идёт на уже запущенный стенд (npm run dev с DEV_MODE) без сборки.
// Снимки: <THEMES_LIVE_OUT>/<схема>-<режим>/<экран>.png, контактный лист index.html и листы по
// схемам _sheets/<схема>-<режим>.png (9 экранов на картинке — для просмотра пачками).
// Переменные: THEMES_LIVE_OUT (по умолчанию reports/themes-live), THEMES_ONLY=nuar,terminal (подмножество
// схем), THEMES_SCREENS=home,tasks (подмножество экранов), THEMES_SKIP_BUILD=1 (взять готовый out/).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const miniapp = nodePath.resolve(here, "..");
const repo = nodePath.resolve(miniapp, "..");
const OUT = nodePath.resolve(process.env.THEMES_LIVE_OUT ?? nodePath.join(repo, "reports/themes-live"));

// Схемы и режимы — из lib/scheme.ts (там же правило «у однорежимной схемы режим один»), чтобы обход
// не отставал от списка: читаем исходник, а не дублируем таблицу.
function readSchemes() {
  const src = fs.readFileSync(nodePath.join(miniapp, "src/lib/scheme.ts"), "utf8");
  const rows = [...src.matchAll(/\{ id: "(\w+)", ru: "[^"]*", en: "[^"]*", tileRu: "[^"]*", tileEn: "[^"]*", modes: (BOTH|\[[^\]]*\]) \}/g)];
  if (rows.length < 11) throw new Error("themes-walk: не разобрал SCHEME_OPTIONS в lib/scheme.ts — формат строки изменился");
  return rows.map((m) => ({
    id: m[1],
    modes: m[2] === "BOTH" ? ["light", "dark"] : [...m[2].matchAll(/"(light|dark)"/g)].map((x) => x[1]),
  }));
}

const SCREENS = [
  { id: "01-home", env: "home", rail: "Главная", wait: 2200 },
  { id: "02-meetings", env: "meetings", rail: "Встречи", wait: 1800 },
  { id: "03-tasks", env: "tasks", rail: "Задачи", wait: 1800 },
  { id: "04-task-card", env: "task-card", rail: "Задачи", wait: 1800, after: "taskCard" },
  { id: "05-projects", env: "projects", rail: "Проекты", wait: 2200 },
  { id: "06-sprints", env: "sprints", rail: "Спринты", wait: 2200 },
  { id: "07-market", env: "market", rail: "Анализ рынка", wait: 4500 },
  { id: "08-settings", env: "settings", rail: "Настройки", wait: 2200, aria: true },
  { id: "09-appearance", env: "appearance", rail: "Настройки", wait: 1500, aria: true, after: "appearance" },
];

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
function serveOut() {
  const root = nodePath.join(miniapp, "out");
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = nodePath.join(root, url.endsWith("/") ? url + "index.html" : url);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = nodePath.join(root, "index.html");
    res.writeHead(200, { "content-type": mime[nodePath.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

let server = null;
if (!process.env.SWARM_E2E_URL) {
  if (!process.env.THEMES_SKIP_BUILD) {
    console.log("сборка miniapp с NEXT_PUBLIC_DEV_MODE=true …");
    execFileSync("npx", ["--no-install", "next", "build"], { cwd: miniapp, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_DEV_MODE: "true" } });
  }
  const s = await serveOut();
  server = s.server;
  process.env.SWARM_E2E_URL = s.url;
}
const { connect, wait, clickText, shutdown, DESKTOP, BASE_URL } = await import("./lib.mjs");

const onlySchemes = process.env.THEMES_ONLY?.split(",");
const onlyScreens = process.env.THEMES_SCREENS?.split(",");
const schemes = readSchemes().filter((s) => !onlySchemes || onlySchemes.includes(s.id));
const screens = SCREENS.filter((s) => !onlyScreens || onlyScreens.includes(s.env));

const { page, errors } = await connect(DESKTOP);
const problems = [];

async function setLook(scheme, mode) {
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await page.evaluate((s, m) => {
    sessionStorage.clear();
    localStorage.setItem("swarm-scheme", s);
    localStorage.setItem("swarm-theme", m);
  }, scheme, mode);
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await wait(1800);
}

const closeOverlays = async () => { for (let i = 0; i < 2; i++) { await page.keyboard.press("Escape"); await wait(250); } };

async function openByAria(label) {
  return page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "").trim() === l);
    if (!b) return false;
    b.click();
    return true;
  }, label);
}

/** Клик мышью по самому глубокому элементу с точным текстом (строки списков — не кнопки). */
async function clickPlain(text) {
  const box = await page.evaluate((t) => {
    const els = [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.textContent.trim() === t);
    const r = els[0]?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, text);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

async function shoot(dir, screen) {
  if (screen.aria ? !(await openByAria(screen.rail)) : !(await clickText(page, screen.rail))) {
    problems.push(`${dir}/${screen.id}: не нашёл «${screen.rail}»`);
  }
  await wait(screen.wait);
  if (screen.after === "taskCard") {
    // Первая строка списка задач: пробуем известные названия из моков, пока не откроется карточка.
    for (const title of ["Daily inbox zero", "Weekly sales report", "Kazakhstan pricing review", "Biweekly 1:1"]) {
      if (await clickPlain(title)) {
        await wait(1200);
        if (await page.evaluate(() => !!document.querySelector('[role="dialog"]'))) break;
      }
    }
    if (!(await page.evaluate(() => !!document.querySelector('[role="dialog"]')))) problems.push(`${dir}/${screen.id}: карточка задачи не открылась`);
  }
  if (screen.after === "appearance") {
    if (!(await openByAria("Оформление"))) problems.push(`${dir}/${screen.id}: нет кнопки «Оформление»`);
    await wait(900);
  }
  await page.screenshot({ path: nodePath.join(OUT, dir, `${screen.id}.png`) });
  if (screen.after) await closeOverlays();
}

fs.rmSync(OUT, { recursive: true, force: true });
const combos = [];
for (const sc of schemes) {
  for (const mode of sc.modes) {
    const dir = `${sc.id}-${mode}`;
    fs.mkdirSync(nodePath.join(OUT, dir), { recursive: true });
    await setLook(sc.id, mode);
    // Раскраска применена? Схема на <html> и класс режима — иначе снимки врут.
    const look = await page.evaluate(() => ({ scheme: document.documentElement.dataset.scheme ?? "swarm", dark: document.documentElement.classList.contains("dark") }));
    if (look.scheme !== sc.id || look.dark !== (mode === "dark")) problems.push(`${dir}: на <html> схема ${look.scheme}, dark=${look.dark}`);
    for (const screen of screens) {
      try { await shoot(dir, screen); } catch (e) { problems.push(`${dir}/${screen.id}: ${String(e).slice(0, 120)}`); }
    }
    combos.push(dir);
    console.log("снято", dir);
  }
}

// Контактный лист: строка — схема+режим, столбец — экран.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const html = `<!doctype html><meta charset="utf-8"><title>Схемы оформления — живой обход</title>
<style>body{font:13px system-ui;margin:16px;background:#f4f4f2;color:#111}h1{font-size:18px}table{border-collapse:collapse}td,th{padding:4px;vertical-align:top}th{text-align:left;font-weight:600;position:sticky;left:0;background:#f4f4f2}
img{width:300px;height:auto;display:block;border:1px solid #bbb}a{color:inherit}.c{font-size:11px;color:#555}</style>
<h1>Схемы оформления — живой обход, 1440×900</h1><p class="c">Строка — схема и режим, столбец — экран. Клик по снимку — полный размер.</p>
<table><tr><th></th>${screens.map((s) => `<th>${esc(s.id)}</th>`).join("")}</tr>
${combos.map((c) => `<tr><th>${esc(c)}</th>${screens.map((s) => `<td><a href="${esc(c)}/${esc(s.id)}.png"><img loading="lazy" src="${esc(c)}/${esc(s.id)}.png" alt="${esc(c)} ${esc(s.id)}"></a></td>`).join("")}</tr>`).join("\n")}
</table>`;
fs.writeFileSync(nodePath.join(OUT, "index.html"), html);

// Листы по схемам: 3×3 уменьшенных снимка на одной картинке — смотреть пачками.
fs.mkdirSync(nodePath.join(OUT, "_sheets"), { recursive: true });
const sheetPage = await (await page.browser()).newPage();
await sheetPage.setViewport({ width: 1440, height: 1010, deviceScaleFactor: 1 });
for (const c of combos) {
  // Лист — файл рядом со снимками (со страницы about:blank file:// не подгружается).
  const cells = screens.map((s) => `<figure><img src="../${esc(c)}/${esc(s.id)}.png"><figcaption>${esc(c)} · ${esc(s.id)}</figcaption></figure>`).join("");
  const sheetHtml = nodePath.join(OUT, "_sheets", `${c}.html`);
  fs.writeFileSync(sheetHtml, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#888;font:12px system-ui;display:grid;grid-template-columns:repeat(3,480px)}figure{margin:0}img{width:480px;height:300px;display:block}figcaption{background:#222;color:#fff;padding:1px 6px;height:18px;box-sizing:border-box}</style><body>${cells}`);
  await sheetPage.goto("file://" + sheetHtml, { waitUntil: "load" });
  await sheetPage.screenshot({ path: nodePath.join(OUT, "_sheets", `${c}.png`), clip: { x: 0, y: 0, width: 1440, height: Math.ceil(screens.length / 3) * 318 } });
  fs.rmSync(sheetHtml);
}
await sheetPage.close();
await shutdown();
if (server) server.close();

const consoleErrors = [...new Set(errors)].filter((e) => !/Failed to load resource/.test(e));
console.log(`\nснимков: ${combos.length * screens.length} в ${combos.length} сочетаниях → ${OUT}`);
if (consoleErrors.length) console.log("ошибки консоли:\n  " + consoleErrors.slice(0, 10).join("\n  "));
if (problems.length) { console.error("ПРОБЛЕМЫ ОБХОДА:\n  " + problems.join("\n  ")); process.exit(1); }
