// Поведение экранов второго уровня: правки реально сохраняются, а не «нажалось и ничего».
// Каркас проверяет mobile-nav.mjs; здесь — то, что живёт ВНУТРИ экранов: карточка задачи
// (название, статус, комментарии), встреча в базе (название, тезисы), вычитка (переименование,
// правка тезисов). Всё на DEV_MODE-моках, прод не задействован.
//
// Запуск: node e2e/deep-flows.mjs
import { connect, freshLoad, wait, waitFor, tap, clickText, bodyText, swipeRows, dialogOpen, reporter, shutdown, PHONE } from "./lib.mjs";

const r = reporter("deep-flows");
const { page, errors } = await connect(PHONE);

const stamp = () => String(process.hrtime.bigint() % 100000n);

/**
 * Ввод НАСТОЯЩЕЙ клавиатурой: фокус + Cmd+A + печать. Синтетический `input` обновляет состояние
 * React, но путь автосохранения карточки задачи на нём не срабатывал — правка молча терялась,
 * и это была бы ложная «зелёная» проверка.
 */
async function fill(page, selector, value) {
  const found = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus();
    return true;
  }, selector);
  if (!found) return false;
  await page.keyboard.down("Meta");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Meta");
  await page.keyboard.type(value, { delay: 12 });
  return true;
}

// ── 1. Карточка задачи: название, статус, комментарий ────────────────────────
{
  await freshLoad(page);
  // Вид задаём явно: моки перешли на относительные даты, и «Сегодня» законно бывает пустым —
  // тогда открывать нечего, а падение выглядело бы как поломка карточки.
  await page.evaluate(() => localStorage.setItem("roy_tasks_view", JSON.stringify({ activeList: "all", lens: "all" })));
  await page.reload({ waitUntil: "networkidle2" });
  await wait(1700);
  const rows = await swipeRows(page);
  r.ok("в списке есть задачи для правки", rows.length > 0, `строк: ${rows.length}`);
  if (rows.length === 0) {
    r.finish(errors);
    await shutdown();
    process.exit(1);
  }
  await tap(page, 195, rows[0].y + rows[0].h / 2);
  r.ok("карточка задачи открывается", await dialogOpen(page));

  // Список отдаёт задачу узкой проекцией (без description), полную догружает сама карточка.
  // Пока догрузки не было, форма молча блокировала запись: человек жал «Готово», кнопка
  // переключалась, PATCH не уходил (issue #145). Ждём с запасом и требуем рабочую форму.
  await wait(1500);
  const hydrate = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const fs = d ? d.querySelector("fieldset") : null;
    return { head: (d ? d.innerText : "").slice(0, 80), disabled: fs ? fs.disabled : null };
  });
  r.ok(
    "карточка догрузила полную задачу и не застряла в «Загружаем…»",
    !/Загружаем|Не загрузилось/.test(hydrate.head) && hydrate.disabled === false,
    JSON.stringify(hydrate),
  );

  const title = "Задача " + stamp();
  await fill(page, '[role="dialog"] input[placeholder*="Название"]', title);
  // Автосохранение с дебаунсом 550мс — ждём, пока новое имя доедет до списка под карточкой.
  await wait(1400);
  await page.keyboard.press("Escape");
  const savedTitle = await waitFor(page, () => !document.querySelector('[role="dialog"]'));
  await wait(900);
  r.ok("новое название задачи сохранилось и видно в списке", savedTitle && (await bodyText(page)).includes(title));

  // статус «В работе» через ту же карточку
  const rows2 = await swipeRows(page);
  const target = rows2.find((x) => x.title.includes(title.slice(0, 12))) ?? rows2[0];
  await tap(page, 195, target.y + target.h / 2);
  await wait(900);
  const statusSet = await page.evaluate(() => {
    // Статусы — пиктограммы: текста в кнопке нет, опознаём по aria-label.
    const b = document.querySelector('[role="dialog"] button[aria-label="В работе"]');
    if (!b) return "нет кнопки статуса";
    b.click();
    return "ok";
  });
  await wait(1500);
  const statusVisible = await page.evaluate(() => {
    const b = document.querySelector('[role="dialog"] button[aria-label="В работе"]');
    return b ? b.getAttribute("aria-pressed") ?? getComputedStyle(b).backgroundColor : null;
  });
  r.ok("статус «В работе» выставляется в карточке", statusSet === "ok" && statusVisible !== "rgba(0, 0, 0, 0)", `${statusSet}, фон=${statusVisible}`);

  // Вид кнопки — НЕ доказательство: до фикса она точно так же переключалась, а PATCH не уходил.
  // Доказательство — переоткрыть карточку и увидеть статус, пришедший с сервера.
  await page.keyboard.press("Escape");
  await waitFor(page, () => !document.querySelector('[role="dialog"]'));
  await wait(900);
  const rows3 = await swipeRows(page);
  const again = rows3.find((x) => x.title.includes(title.slice(0, 12))) ?? rows3[0];
  await tap(page, 195, again.y + again.h / 2);
  await wait(1600);
  const persisted = await page.evaluate(() => {
    const b = document.querySelector('[role="dialog"] button[aria-label="В работе"]');
    return b ? b.getAttribute("aria-pressed") : "нет кнопки";
  });
  r.ok("статус «В работе» ПЕРЕЖИЛ переоткрытие карточки", persisted === "true", `aria-pressed=${persisted}`);

  // комментарий
  const comment = "Комментарий " + stamp();
  const typed = await fill(page, '[role="dialog"] textarea[placeholder*="апдейт"]', comment);
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Отправить"]')?.click());
  await wait(1600);
  r.ok("комментарий добавляется", typed && (await bodyText(page)).includes(comment), typed ? "" : "поле комментария не найдено");

  const removed = await page.evaluate((text) => {
    // Ищем кнопку удаления В ТОЙ строке, где лежит наш комментарий: «последняя в списке» — не он.
    for (const b of document.querySelectorAll('[role="dialog"] button[aria-label="Удалить комментарий"]')) {
      let box = b.closest("div");
      for (let i = 0; i < 4 && box; i++) {
        if (box.innerText.includes(text)) { b.click(); return true; }
        box = box.parentElement;
      }
    }
    return false;
  }, comment);
  await wait(1500);
  r.ok("комментарий удаляется", removed && !(await bodyText(page)).includes(comment));
  await page.keyboard.press("Escape");
  await wait(800);
}

// ── 2. Встреча в базе: правка названия и тезисов ─────────────────────────────
{
  await clickText(page, "Встречи");
  await wait(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Q3 Kickoff/.test(x.innerText))?.click());
  await wait(1800);
  r.ok("встреча открывается", /Назад/.test(await bodyText(page)));

  const newTitle = "Q3 Kickoff " + stamp();
  await clickText(page, "Название");
  await wait(700);
  await fill(page, 'input[class*="font-bold"]', newTitle);
  const savedT = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Сохранить|Готово/.test(x.innerText.trim()) || x.getAttribute("aria-label") === "Сохранить название");
    if (!b) return "нет кнопки сохранения";
    b.click();
    return "ok";
  });
  await wait(1600);
  r.ok("название встречи сохраняется", savedT === "ok" && (await bodyText(page)).includes(newTitle), savedT);

  const newNotes = "Тезисы обновлены " + stamp();
  await clickText(page, "Тезисы");
  await wait(800);
  const filledNotes = await fill(page, "textarea", newNotes);
  const savedN = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Сохранить/.test(x.innerText.trim()));
    if (!b) return "нет кнопки сохранения";
    b.click();
    return "ok";
  });
  await wait(1700);
  r.ok("тезисы встречи сохраняются", filledNotes && savedN === "ok" && (await bodyText(page)).includes(newNotes), `${savedN}`);
  await clickText(page, "Назад");
  await wait(1000);
}

// ── 3. Вычитка: переименование и правка тезисов ──────────────────────────────
{
  await clickText(page, "Встречи");
  await wait(1400);
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Синк по Болгарии|Встреча без названия/.test(x.innerText));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) {
    console.log("⏭  черновиков на вычитке нет — группа пропущена");
  } else {
    await wait(2000);
    r.ok("вычитка открывается", /Тезисы|Транскрипт/.test(await bodyText(page)));

    const draftTitle = "Синк " + stamp();
    await page.evaluate(() => document.querySelector('button[aria-label="Переименовать"]')?.click());
    await wait(700);
    await fill(page, 'input[placeholder="Название встречи"]', draftTitle);
    await page.evaluate(() => document.querySelector('button[aria-label="Сохранить название"]')?.click());
    await wait(1600);
    r.ok("переименование черновика сохраняется", (await bodyText(page)).includes(draftTitle));

    const reviewNotes = "Правка вычитки " + stamp();
    await clickText(page, "Редактировать");
    await wait(800);
    const filled = await fill(page, "textarea", reviewNotes);
    const saved = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Сохранить/.test(x.innerText.trim()));
      if (!b) return "нет кнопки сохранения";
      b.click();
      return "ok";
    });
    await wait(1700);
    r.ok("правка тезисов на вычитке сохраняется", filled && saved === "ok" && (await bodyText(page)).includes(reviewNotes), saved);
    r.ok("выбор хранилища у несогласованной встречи на месте", /В команду|В личное|Сохранить в базу/.test(await bodyText(page)));
  }
}

const green = r.finish(errors);
await shutdown();
process.exit(green ? 0 : 1);
