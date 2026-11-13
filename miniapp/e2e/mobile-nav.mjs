// Смоук мобильного каркаса: жесты списка, набор табов, поиск, проекты, встречи, хвосты.
// Проверяет ровно то, что ломалось живьём (2026-08-22): скролл открывал задачу, настройки были
// доступны с одного экрана из четырёх, проектов на телефоне не было, созданная задача «пропадала».
// Запуск: SWARM_E2E_URL=<remote preview> node e2e/mobile-nav.mjs; API всегда синтетические.
import fs from "node:fs";
import {
  connect as connectBrowser, freshLoad, wait, waitFor, tap, swipe, bodyText, tabBar, assertTouchWorks, BASE_URL,
  reporter, shutdown, PHONE, PHONE_SHORT, DESKTOP,
} from "./lib.mjs";

import { clickText, touchControl, swipeRows, stableRows, dialogOpen, visibleTitle } from "./mobile-nav.helpers.mjs";
import { installMobileFixture } from "./mobile-nav.fixture.mjs";
const fixtures = new Set();
let activeErrors = [];
async function connect(viewport) {
  const result = await connectBrowser(viewport);
  activeErrors = result.errors;
  const fixture = await installMobileFixture(result.page);
  fixture.reset();
  fixtures.add(fixture);
  return result;
}
async function section(name, run) {
  try { await run(); }
  catch (error) { r.ok(`${name}: незавершённый сценарий`, false, error instanceof Error ? error.message : String(error)); }
  finally { allErrors.push(...activeErrors); }
}
const results = [];
const report = reporter("mobile-nav");
const r = { ...report, ok(label, pass, detail = "") {
  results.push({ label, pass: !!pass, detail });
  return report.ok(label, !!pass, detail);
} };
const allErrors = [];

// ── 1. Жесты строки задачи: скролл НЕ открывает задачу ───────────────────────
await section("Блок 1", async () => {
  const { browser, page } = await connect(PHONE_SHORT);
  await assertTouchWorks(page);
  await freshLoad(page);
  // Вид задаём заранее через сохранённое состояние (его читает useReminderTasks при монтировании):
  // на дефолте «Мои/Сегодня» в моках одна строка, и проверка «скроллит ли» прошла бы зелёной,
  // ничего не проверив. «Все/Все» даёт список длиннее экрана.
  await page.evaluate(() => localStorage.setItem("roy_tasks_view", JSON.stringify({ activeList: "all", lens: "all" })));
  await page.reload({ waitUntil: "networkidle2" });
  await wait(1700);
  const scrollable = await page.evaluate(() => {
    const sc = document.querySelector("div.relative.h-full.overflow-y-auto");
    return sc ? sc.scrollHeight > sc.clientHeight + 4 : false;
  });
  r.ok("список длиннее экрана — есть что скроллить", scrollable);
  const rows = await swipeRows(page);
  r.ok("список задач рисует строки со свайпом", rows.length > 0, `строк: ${rows.length}`);
  if (rows.length) {
    const row = rows.find((x) => x.y > 120) ?? rows[0];
    const y = row.y + row.h / 2;

    await swipe(page, 195, y, 0, -160);
    const scrolled = await page.evaluate(() => {
      const sc = document.querySelector("div.relative.h-full.overflow-y-auto");
      return sc ? Math.round(sc.scrollTop) : 0;
    });
    r.ok("вертикальный свайп скроллит и НЕ открывает задачу", !(await dialogOpen(page)) && scrolled > 10, `scrollTop=${scrolled}`);

    // Кнопка «+» должна остаться внизу справа: она была absolute ВНУТРИ скролл-контейнера и
    // на прокрученном списке всплывала поверх строк, съедая по ним тап и свайп.
    const fab = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Создать"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { top: Math.round(r.top), bottomGap: Math.round(globalThis.innerHeight - r.bottom) };
    });
    r.ok("кнопка «+» не уезжает вверх при скролле списка", !!fab && fab.top > 215, JSON.stringify(fab) + " (экран 430px)");

    const settled = await stableRows(page);
    const fresh = settled.find((x) => x.y > 60) ?? settled[0];
    const y2 = fresh.y + fresh.h / 2;
    await tap(page, 195, y2);
    r.ok("тап по строке открывает карточку задачи", await dialogOpen(page));
    await page.keyboard.press("Escape");
    await wait(700);

    await swipe(page, 320, y2, -130, 0);
    const opened = (await swipeRows(page)).find((x) => /translateX\(-\d+px\)/.test(x.dx));
    r.ok("горизонтальный свайп открывает шторку действий", !!opened, opened?.dx);
    r.ok("горизонтальный свайп НЕ открывает задачу", !(await dialogOpen(page)));
    await tap(page, 120, y2);
    const closed = (await stableRows(page)).every((x) => /translateX\(0px\)/.test(x.dx) || !x.dx);
    r.ok("тап при открытой шторке закрывает её, а не открывает задачу", closed && !(await dialogOpen(page)));

    // «Изменить» в шторке ведёт в ТО ЖЕ окно TaskModal, что и тап по строке (#600), а не в отдельную форму.
    await swipe(page, 320, y2, -130, 0);
    const editPoint = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Изменить" || x.innerText.trim() === "Изменить");
      if (!b || !b.getBoundingClientRect().width) return null;
      const bb = b.getBoundingClientRect();
      return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
    });
    if (editPoint) await tap(page, editPoint.x, editPoint.y);
    await wait(900);
    const editor = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((e) => e.getBoundingClientRect().width > 0);
      return { dialog: !!dlg, heading: dlg?.querySelector("h2")?.innerText, title: dlg?.querySelector("textarea#modal-title")?.value };
    });
    r.ok("«Изменить» в шторке открывает окно TaskModal, а не отдельную форму", !!editPoint && editor.dialog && editor.heading === "Изменить задачу" && !!editor.title, JSON.stringify(editor));
    await page.keyboard.press("Escape");
    await wait(700);
  } else {
    for (const label of ["вертикальный свайп скроллит и НЕ открывает задачу", "кнопка «+» не уезжает вверх при скролле списка", "тап по строке открывает карточку задачи", "горизонтальный свайп открывает шторку действий", "горизонтальный свайп НЕ открывает задачу", "тап при открытой шторке закрывает её, а не открывает задачу"]) r.ok(label, false, "нет доступной строки для жеста");
  }
  await browser.disconnect();
});

// ── 2. Каркас навигации ──────────────────────────────────────────────────────
await section("Блок 2", async () => {
  const { browser, page } = await connect(PHONE);
  await freshLoad(page);
  const tabs = await tabBar(page);
  r.ok("таб-бар: Задачи · Проекты · Встречи · Ещё",
    JSON.stringify((tabs ?? []).map((t) => t.replace(/^\d+\s*/, ""))) === JSON.stringify(["Задачи", "Проекты", "Встречи", "Ещё"]),
    JSON.stringify(tabs));
  r.ok("дом мобильного — задачи", (await visibleTitle(page)) === "Задачи");

  for (const tab of ["Задачи", "Проекты", "Встречи", "Ещё"]) {
    await clickText(page, tab);
    await wait(1100);
    const actions = await page.evaluate(() => {
      const visible = (b) => b.getBoundingClientRect().width > 0 && !b.closest("[hidden]");
      return { search: [...document.querySelectorAll('button[aria-label="Спросить или найти"]')].some(visible),
      // Колокольчик уведомлений жил в шапке «Поиска» — экрана, который перестал быть домом.
      // Проверяем, что он не уехал вглубь вместе с ним.
      bell: [...document.querySelectorAll("button[aria-label]")].some((b) => /уведомлен|notification/i.test(b.getAttribute("aria-label") ?? "") && visible(b)),
    }; });
    r.ok(`поиск и уведомления доступны с таба «${tab}»`, actions.search && actions.bell && (await visibleTitle(page)) === tab, JSON.stringify(actions));
  }

  await touchControl(page, { selector: 'button[aria-label="Спросить или найти"]' });
  await wait(1200);
  await page.evaluate(() => document.querySelector("input")?.focus());
  await page.keyboard.type("Сербия");
  await page.keyboard.press("Enter");
  await wait(2200);
  r.ok("поиск из шапки доходит до ответа", /Сербия: синтетический ответ/.test(await bodyText(page)) && [...fixtures].some((f) => f.requests.some((q) => q.method === "POST" && q.path === "/api/ask" && q.body.q === "Сербия")));
  await clickText(page, "Назад");
  await wait(800);
  await clickText(page, "Назад");
  await wait(800);

  await clickText(page, "Ещё");
  await wait(1200);
  const more = await bodyText(page);
  for (const row of ["База", "Команда", "Настройки", "Карта системы", "Оставить фидбек"]) {
    r.ok(`«Ещё» содержит «${row}»`, more.includes(row));
  }
  await clickText(page, "Настройки");
  await wait(1300);
  r.ok("настройки открываются из «Ещё»", /Профиль|Granola|Рекордер/.test(await bodyText(page)));

  // Миграция сохранённого таба: старые значения не должны давать экран без таб-бара.
  for (const [saved, expect] of [["search", "Задачи"], ["book", "Ещё"]]) {
    await page.evaluate((v) => { sessionStorage.setItem("roy_tab", v); sessionStorage.removeItem("roy_stack"); }, saved);
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await wait(1700);
    const h1 = await visibleTitle(page);
    r.ok(`старый сохранённый таб "${saved}" → «${expect}»`, h1 === expect, `h1=${h1}`);
  }
  await browser.disconnect();
});

// ── 3. Проекты ───────────────────────────────────────────────────────────────
await section("Блок 3", async () => {
  const { browser, page } = await connect(PHONE);
  await freshLoad(page);
  await clickText(page, "Проекты");
  await wait(1500);
  let t = await bodyText(page);
  r.ok("экран проектов показывает список", /\d\/\d/.test(t) && /Новый проект/.test(t), t.slice(0, 90));

  await clickText(page, "Swarm Brain");
  await wait(1600);
  t = await bodyText(page);
  r.ok("проект открывается со своими задачами", /задач готово/.test(t) && /Назад/.test(t), t.slice(0, 80));

  await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((x) => /Новая задача/.test(x.placeholder));
    i?.focus();
  });
  const name = "Смоук проекта";
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await wait(1700);
  r.ok("быстрое добавление создаёт задачу ВНУТРИ проекта", (await bodyText(page)).includes(name) && [...fixtures].some((f) => f.requests.some((q) => q.method === "POST" && q.path === "/api/tasks" && q.body.title === name && q.body.project_id === f.snapshot().projects[0].id)));
  await browser.disconnect();
});

// ── 4. Встречи ───────────────────────────────────────────────────────────────
await section("Блок 4", async () => {
  const { browser, page } = await connect(PHONE);
  await freshLoad(page);
  await clickText(page, "Встречи");
  await wait(1600);
  const t = await bodyText(page);
  const order = await page.evaluate(() => {
    const visible = (e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]");
    const heading = [...document.querySelectorAll("h1")].find(visible)?.getBoundingClientRect();
    const queue = [...document.querySelectorAll("button")].find((e) => visible(e) && e.innerText.includes("Синк по Болгарии"))?.getBoundingClientRect();
    return { headingBottom: heading?.bottom, queueTop: queue?.top };
  });
  r.ok("заголовок экрана выше очереди вычитки", order.headingBottom !== undefined && order.queueTop !== undefined && order.headingBottom <= order.queueTop, JSON.stringify(order));
  r.ok("даты без ISO-формата", t.includes("Q3 Kickoff") && !/\d{4}-\d{2}-\d{2}/.test(t));

  const exposed = await page.evaluate(() => {
    let n = 0;
    for (const b of document.querySelectorAll('button[aria-label="Удалить"]')) {
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.top < 0 || rect.top > globalThis.innerHeight) continue;
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (b === top || b.contains(top)) n++;
    }
    return n;
  });
  r.ok("ни одной открытой кнопки удаления в строках встреч (всё через свайп)", exposed === 0, `открытых: ${exposed}`);

  // Очередь черновиков: тап по строке должен открывать вычитку (карандаш убран как дубль тапа).
  const queueOpened = await clickText(page, "Синк по Болгарии") ? "clicked" : "нет строки черновика";
  await wait(1800);
  const inReview = /Тезисы|Транскрипт|Сохранить/.test(await bodyText(page));
  r.ok("тап по черновику открывает вычитку", queueOpened === "clicked" && inReview, queueOpened);
  r.ok("дата вычитки без ISO", queueOpened === "clicked" && !/\d{4}-\d{2}-\d{2}/.test(await bodyText(page)));
  // Выход из вычитки — иконка без подписи, поэтому ищем по aria-label, а не по тексту.
  if (queueOpened === "clicked") {
    await clickText(page, "Назад") || await touchControl(page, { selector: 'button[aria-label="Назад"]' });
    // Ждём именно возврата в список, а не «немного»: иначе следующие проверки читают ещё
    // экран вычитки и падают на исправном продукте.
    const back = await waitFor(page, () => /Ожидают|Подтверждены/.test(document.body.innerText) && !/Транскрипт \(/.test(document.body.innerText));
    r.ok("из вычитки есть выход назад", back);
  } else r.ok("из вычитки есть выход назад", false, "черновик не открылся");

  const rows = await swipeRows(page);
  if (rows.length) {
    const y = rows[0].y + rows[0].h / 2;
    await swipe(page, 195, y, 0, -140);
    r.ok("вертикальный свайп по карточке встречи её не открывает", !/Тезисы|Транскрипт/.test(await bodyText(page)));
  } else r.ok("вертикальный свайп по карточке встречи её не открывает", false, "нет доступной строки встречи");
  await clickText(page, "Q3 Kickoff");
  await wait(2000);
  const detail = await bodyText(page);
  r.ok("встреча открывается тапом", /Q3 Kickoff/.test(detail) && /Назад/.test(detail));
  const titleEdit = await touchControl(page, { selector: 'button[aria-label="Изменить название"]' });
  const titleField = titleEdit && await waitFor(page, () => [...document.querySelectorAll("input")].some((e) => e.getBoundingClientRect().width > 0 && e.value === "Q3 Kickoff"));
  if (titleEdit) await clickText(page, "Отмена");
  const summaryEdit = await touchControl(page, { selector: 'button[aria-label="Править тезисы"]' });
  const summaryField = summaryEdit && await waitFor(page, () => [...document.querySelectorAll('textarea,[contenteditable="true"]')].some((e) => e.getBoundingClientRect().width > 0));
  if (summaryEdit) await clickText(page, "Отмена");
  r.ok("правка названия и тезисов на месте", titleField && summaryField);
  r.ok("у несогласованной встречи есть выбор «Общее/Личное» и сохранение",
    /Общее/.test(detail) && /Личное/.test(detail) && /Сохранить в/.test(detail));
  await browser.disconnect();
});

// ── 5. Компактные фильтры, тач-цели, хвосты ──────────────────────────────────
await section("Блок 5", async () => {
  const { browser, page } = await connect(PHONE);
  await freshLoad(page);
  // Вид задаём явно: моки перешли на относительные даты (mockDay), и в «Сегодня» законно может
  // не быть ни одной строки — тогда мерить плотность и тач-цели нечем, а проверка молча
  // «зеленела» бы на пустом экране. «Все/Все» гарантирует непустой список.
  await page.evaluate(() => localStorage.setItem("roy_tasks_view", JSON.stringify({ activeList: "all", lens: "all" })));
  await page.reload({ waitUntil: "networkidle2" });
  await wait(1700);
  const geom = await page.evaluate(() => {
    const visible = (e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]");
    const first = [...document.querySelectorAll("[data-swipe-content]")].find(visible)?.parentElement?.getBoundingClientRect();
    const status = [...document.querySelectorAll('[role="group"][aria-label="Фильтр по статусу"]')].find(visible);
    const statusRowHeight = status?.parentElement.getBoundingClientRect().height ?? 0;
    const statusCount = status?.querySelectorAll('[role="switch"]').length ?? 0;
    const cb = [...document.querySelectorAll('button[role="checkbox"]')].find(visible);
    const px = (v) => Math.abs(parseFloat(v) || 0);
    let hit = null;
    if (cb) {
      const b = cb.getBoundingClientRect();
      const a = getComputedStyle(cb, "::after");
      hit = { w: Math.round(b.width + px(a.left) + px(a.right)), h: Math.round(b.height + px(a.top) + px(a.bottom)) };
    }
    const fabs = [...document.querySelectorAll("button")]
      .filter((b) => {
        const bb = b.getBoundingClientRect();
        return bb.width >= 44 && bb.height >= 44 && bb.bottom > globalThis.innerHeight - 220 && bb.right > globalThis.innerWidth - 110;
      })
      .filter((b) => !/Задачи|Проекты|Встречи|Ещё/.test(b.innerText))
      .map((b) => b.getAttribute("aria-label") ?? "FAB");
    return { firstRowTop: first ? Math.round(first.top) : null, statusRowHeight, statusCount, viewport: globalThis.innerHeight, hit, fabs };
  });
  r.ok("управление не съедает четверть экрана", geom.firstRowTop !== null && geom.statusCount === 3 && geom.firstRowTop - geom.statusRowHeight <= 165 && geom.firstRowTop <= geom.viewport / 4, `строка@${geom.firstRowTop}px, отдельная ось статуса ${geom.statusRowHeight}px (#216), исходное управление ${geom.firstRowTop - geom.statusRowHeight}px≤165`);
  r.ok("тач-цель чекбокса не меньше 38x44", !!geom.hit && geom.hit.w >= 38 && geom.hit.h >= 44, JSON.stringify(geom.hit));
  r.ok("на экране один FAB", geom.fabs.length === 1, JSON.stringify(geom.fabs));

  await touchControl(page, { selector: 'button[aria-label="Чьи задачи и группировка"]' });
  await wait(700);
  const menu = await page.evaluate(() => document.querySelector('[role="menu"]')?.innerText.replace(/\n+/g, " | "));
  r.ok("меню охвата содержит линзу, группировку и админ-тумблер",
    /Мои/.test(menu ?? "") && /По рынкам/.test(menu ?? "") && /Все сотрудники/.test(menu ?? ""), menu);
  await page.keyboard.press("Escape");
  await wait(500);

  // Сохраняем проверку видимости созданной задачи. Решение 21.09: срок обязателен, дефолт завтра.
  await touchControl(page, { selector: 'button[aria-label="Создать"]' });
  await wait(1400);
  const name = "Смоук новой задачи";
  const titleInput = await page.$('textarea#modal-title');
  if (titleInput) { await titleInput.focus(); await page.keyboard.type(name); }
  await wait(500);
  const createClicked = await touchControl(page, { selector: '[role="dialog"] button', text: "Создать" });
  await waitFor(page, () => document.body.innerText.includes("Смоук новой задачи"));
  const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); });
  const createdRequest = [...fixtures].flatMap((f) => f.requests).find((q) => q.method === "POST" && q.path === "/api/tasks" && q.body.title === name);
  const afterCreate = await bodyText(page);
  r.ok("созданная задача с дефолтным сроком завтра видна сразу", afterCreate.includes(name) && createdRequest?.body.due_date === tomorrow, JSON.stringify({ createClicked, inputFound: !!titleInput, request: createdRequest?.body, tomorrow, screen: afterCreate.slice(0, 120) }));
  await browser.disconnect();
});

// ── 6. Десктоп не задет ──────────────────────────────────────────────────────
await section("Блок 6", async () => {
  const { browser, page } = await connect(DESKTOP);
  await freshLoad(page);
  const t = await bodyText(page);
  r.ok("десктопный дашборд на месте", (await visibleTitle(page)) === "Главная" && /Настроить главную/.test(t) && await page.evaluate(() => !!document.querySelector('button[title="Главная"][aria-current="page"]')), t.slice(0, 80));
  r.ok("мобильный таб-бар на десктопе скрыт", await page.evaluate(() => {
    const bars = [...document.querySelectorAll("div")].filter((d) => String(d.className).includes("lg:hidden") && String(d.className).includes("border-t"));
    return bars.length === 0 || bars.every((b) => getComputedStyle(b).display === "none");
  }));
  await browser.disconnect();
});

for (const fixture of fixtures) {
  r.ok("все API-запросы обслужены синтетическими фикстурами", fixture.unexpected.length === 0, fixture.unexpected.join(", "));
}
const green = r.finish(allErrors);
const directory = new URL("../../reports/", import.meta.url);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(new URL(process.env.SWARM_E2E_REPORT ?? "mobile-nav.json", directory), JSON.stringify({ green, complete: true, tailReached: results.some((r) => r.label === "мобильный таб-бар на десктопе скрыт"), results, errors: [...new Set(allErrors)], unexpected: [...fixtures].flatMap((f) => f.unexpected) }, null, 2));
await shutdown();
process.exit(green ? 0 : 1);
