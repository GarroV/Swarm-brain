// Смоук мобильного каркаса: жесты списка, набор табов, поиск, проекты, встречи, хвосты.
// Проверяет ровно то, что ломалось живьём (2026-08-22): скролл открывал задачу, настройки были
// доступны с одного экрана из четырёх, проектов на телефоне не было, созданная задача «пропадала».
// Запуск: node e2e/mobile-nav.mjs (см. e2e/README.md — нужен dev-сервер и Chrome с CDP).
import {
  connect, freshLoad, wait, tap, swipe, clickText, bodyText, swipeRows, dialogOpen, tabBar,
  reporter, PHONE, PHONE_SHORT, DESKTOP,
} from "./lib.mjs";

const r = reporter("mobile-nav");
const allErrors = [];

// ── 1. Жесты строки задачи: скролл НЕ открывает задачу ───────────────────────
{
  const { browser, page, errors } = await connect(PHONE_SHORT);
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

    const fresh = (await swipeRows(page)).find((x) => x.y > 60) ?? (await swipeRows(page))[0];
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
    const closed = (await swipeRows(page)).every((x) => /translateX\(0px\)/.test(x.dx) || !x.dx);
    r.ok("тап при открытой шторке закрывает её, а не открывает задачу", closed && !(await dialogOpen(page)));
  }
  allErrors.push(...errors);
  await browser.disconnect();
}

// ── 2. Каркас навигации ──────────────────────────────────────────────────────
{
  const { browser, page, errors } = await connect(PHONE);
  await freshLoad(page);
  const tabs = await tabBar(page);
  r.ok("таб-бар: Задачи · Проекты · Встречи · Ещё",
    JSON.stringify((tabs ?? []).map((t) => t.replace(/^\d+\s*/, ""))) === JSON.stringify(["Задачи", "Проекты", "Встречи", "Ещё"]),
    JSON.stringify(tabs));
  r.ok("дом мобильного — задачи", (await page.evaluate(() => document.querySelector("h1")?.innerText)) === "Задачи");

  for (const tab of ["Задачи", "Проекты", "Встречи"]) {
    await clickText(page, tab);
    await wait(1100);
    r.ok(`поиск доступен с таба «${tab}»`, await page.evaluate(() => !!document.querySelector('button[aria-label="Спросить или найти"]')));
  }

  await page.evaluate(() => document.querySelector('button[aria-label="Спросить или найти"]').click());
  await wait(1200);
  await page.evaluate(() => document.querySelector("input")?.focus());
  await page.keyboard.type("Сербия");
  await page.keyboard.press("Enter");
  await wait(2200);
  r.ok("поиск из шапки доходит до ответа", /Сербия/i.test(await bodyText(page)));
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
    await page.reload({ waitUntil: "networkidle2" });
    await wait(1700);
    const h1 = await page.evaluate(() => document.querySelector("h1")?.innerText);
    r.ok(`старый сохранённый таб "${saved}" → «${expect}»`, h1 === expect, `h1=${h1}`);
  }
  allErrors.push(...errors);
  await browser.disconnect();
}

// ── 3. Проекты ───────────────────────────────────────────────────────────────
{
  const { browser, page, errors } = await connect(PHONE);
  await freshLoad(page);
  await clickText(page, "Проекты");
  await wait(1500);
  let t = await bodyText(page);
  r.ok("экран проектов показывает список", /\d\/\d/.test(t) && /Новый проект/.test(t), t.slice(0, 90));

  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /\d\/\d/.test(x.innerText))?.click());
  await wait(1600);
  t = await bodyText(page);
  r.ok("проект открывается со своими задачами", /задач готово/.test(t) && /Назад/.test(t), t.slice(0, 80));

  await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((x) => /Новая задача/.test(x.placeholder));
    i?.focus();
  });
  const name = "Смоук проекта " + Math.floor(Number(process.hrtime.bigint() % 100000n));
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await wait(1700);
  r.ok("быстрое добавление создаёт задачу ВНУТРИ проекта", (await bodyText(page)).includes(name));
  allErrors.push(...errors);
  await browser.disconnect();
}

// ── 4. Встречи ───────────────────────────────────────────────────────────────
{
  const { browser, page, errors } = await connect(PHONE);
  await freshLoad(page);
  await clickText(page, "Встречи");
  await wait(1600);
  const t = await bodyText(page);
  const iTitle = t.indexOf("Встречи");
  const iQueue = t.indexOf("На вычитке");
  r.ok("заголовок экрана выше очереди вычитки", iTitle >= 0 && (iQueue === -1 || iQueue > iTitle), `title@${iTitle} queue@${iQueue}`);
  r.ok("даты без ISO-формата", !/\d{4}-\d{2}-\d{2}/.test(t));

  const exposed = await page.evaluate(() => {
    let n = 0;
    for (const b of document.querySelectorAll('button[aria-label="Удалить"]')) {
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.top < 0 || rect.top > window.innerHeight) continue;
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (b === top || b.contains(top)) n++;
    }
    return n;
  });
  r.ok("кнопки удаления встреч спрятаны под строкой (только свайпом)", exposed <= 1, `открытых: ${exposed} (1 — очередь черновиков)`);

  const rows = await swipeRows(page);
  if (rows.length) {
    const y = rows[0].y + rows[0].h / 2;
    await swipe(page, 195, y, 0, -140);
    r.ok("вертикальный свайп по карточке встречи её не открывает", !/Тезисы|Транскрипт/.test(await bodyText(page)));
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Q3 Kickoff/.test(x.innerText))?.click());
  await wait(2000);
  const detail = await bodyText(page);
  r.ok("встреча открывается тапом", /Q3 Kickoff/.test(detail) && /Назад/.test(detail));
  r.ok("правка названия и тезисов на месте", /Название/.test(detail) && /Тезисы/.test(detail));
  r.ok("у несогласованной встречи есть выбор «Общее/Личное» и сохранение",
    /Общее/.test(detail) && /Личное/.test(detail) && /Сохранить в/.test(detail));
  allErrors.push(...errors);
  await browser.disconnect();
}

// ── 5. Компактные фильтры, тач-цели, хвосты ──────────────────────────────────
{
  const { browser, page, errors } = await connect(PHONE);
  await freshLoad(page);
  await clickText(page, "Задачи");
  await wait(1200);
  const geom = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div.relative.overflow-hidden")]
      .filter((d) => /translateX/.test(d.children[1]?.style?.transform || ""));
    const first = rows[0]?.getBoundingClientRect();
    const cb = document.querySelector('button[role="checkbox"]');
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
        return bb.width >= 44 && bb.height >= 44 && bb.bottom > window.innerHeight - 220 && bb.right > window.innerWidth - 110;
      })
      .filter((b) => !/Задачи|Проекты|Встречи|Ещё/.test(b.innerText))
      .map((b) => b.getAttribute("aria-label") ?? "FAB");
    return { firstRowTop: first ? Math.round(first.top) : null, hit, fabs };
  });
  r.ok("управление не съедает четверть экрана", geom.firstRowTop !== null && geom.firstRowTop <= 165, `первая строка на ${geom.firstRowTop}px (было 199)`);
  r.ok("тач-цель чекбокса не меньше 38x44", !!geom.hit && geom.hit.w >= 38 && geom.hit.h >= 44, JSON.stringify(geom.hit));
  r.ok("на экране один FAB", geom.fabs.length === 1, JSON.stringify(geom.fabs));

  await page.evaluate(() => document.querySelector('button[aria-label="Чьи задачи и группировка"]').click());
  await wait(700);
  const menu = await page.evaluate(() => document.querySelector('[role="menu"]')?.innerText.replace(/\n+/g, " | "));
  r.ok("меню охвата содержит линзу, группировку и админ-тумблер",
    /Мои/.test(menu ?? "") && /По рынкам/.test(menu ?? "") && /Все сотрудники/.test(menu ?? ""), menu);
  await page.keyboard.press("Escape");
  await wait(500);

  // Созданная задача без срока обязана быть видна сразу.
  await page.evaluate(() => document.querySelector('button[aria-label="Создать"]')?.click());
  await wait(1400);
  const name = "Смоук без срока " + Math.floor(Number(process.hrtime.bigint() % 100000n));
  await page.evaluate((v) => {
    const i = document.querySelector('input[type="text"], input:not([type]), textarea');
    const set = Object.getOwnPropertyDescriptor(i.constructor.prototype, "value").set;
    set.call(i, v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Создать задачу/.test(x.innerText))?.click());
  await wait(2200);
  r.ok("созданная задача без срока видна сразу", (await bodyText(page)).includes(name));
  allErrors.push(...errors);
  await browser.disconnect();
}

// ── 6. Десктоп не задет ──────────────────────────────────────────────────────
{
  const { browser, page, errors } = await connect(DESKTOP);
  await freshLoad(page);
  const t = await bodyText(page);
  r.ok("десктопный дашборд на месте", /Мои задачи|Материал|дайджест/i.test(t), t.slice(0, 80));
  r.ok("мобильный таб-бар на десктопе скрыт", await page.evaluate(() => {
    const bars = [...document.querySelectorAll("div")].filter((d) => String(d.className).includes("lg:hidden") && String(d.className).includes("border-t"));
    return bars.length === 0 || bars.every((b) => getComputedStyle(b).display === "none");
  }));
  allErrors.push(...errors);
  await browser.disconnect();
}

process.exit(r.finish(allErrors) ? 0 : 1);
