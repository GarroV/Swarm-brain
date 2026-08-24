// Жесты таймлайна на тач-устройстве (issue #69): вертикальный жест по бару не должен ни
// открывать задачу, ни менять её даты; тап открывает; горизонтальный drag двигает срок.
//
// Вид «Таймлайн» СКРЫТ в продукте с 2026-08-19 (решение владельца, `TasksScreen.tsx` — пункт
// закомментирован). Набор это понимает и завершается со статусом «пропущено», а не падением:
// чтобы прогнать проверки, временно раскомментируй пункт в VIEWS.
//
// Запуск: node e2e/timeline-gestures.mjs
import { connect, freshLoad, clickText, wait, swipe, tap, bodyText, dialogOpen, reporter, shutdown } from "./lib.mjs";

// Тач-ноут/планшет в десктопной вёрстке — единственное место, где таймлайн встречается с пальцем.
const TOUCH_DESKTOP = { width: 1200, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: true };

const r = reporter("timeline-gestures");
const { page, errors } = await connect(TOUCH_DESKTOP);
await freshLoad(page);

// Разделы на десктопе открываются из шапок панелей дашборда.
await page.evaluate(() => [...document.querySelectorAll("button,a")].find((x) => /Мои задачи/.test(x.innerText))?.click());
await wait(2000);

if (!(await clickText(page, "Таймлайн"))) {
  console.log("⏭  вид «Таймлайн» скрыт в продукте (решение владельца 2026-08-19) — проверки пропущены");
  await shutdown();
  process.exit(0);
}
await wait(2000);

// В моках у задач одна дата → они рисуются вехами-ромбами; обработчики жестов те же, что у баров.
const el = await page.evaluate(() => {
  const d = [...document.querySelectorAll("button")].find((b) => String(b.className).includes("rotate-45"));
  if (!d) return null;
  const box = d.getBoundingClientRect();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), title: d.getAttribute("aria-label") };
});
r.ok("на таймлайне есть элемент задачи", !!el, JSON.stringify(el));
if (!el) {
  console.log(await bodyText(page));
  await shutdown();
  process.exit(1);
}

// Снимок «что где стоит»: и позиция, и форма (веха ↔ бар). Форма важна: оптимистичная перезапись
// дат превращала веху в бар, и это оставалось на экране как настоящее изменение срока.
const shape = () => page.evaluate(() => ({
  diamonds: [...document.querySelectorAll("button")].filter((b) => String(b.className).includes("rotate-45"))
    .map((b) => `${b.getAttribute("aria-label")}@${Math.round(b.getBoundingClientRect().x)}`).join("|"),
  bars: [...document.querySelectorAll("div[title]")].filter((d) => getComputedStyle(d).position === "absolute")
    .map((d) => `${d.getAttribute("title")}@${Math.round(d.getBoundingClientRect().x)}`).join("|"),
}));

const before = await shape();

await swipe(page, el.x, el.y, 0, -180);
r.ok("вертикальный жест НЕ открывает задачу", !(await dialogOpen(page)));
const afterVertical = await shape();
r.ok("вертикальный жест не трогает срок и форму элемента",
  JSON.stringify(afterVertical) === JSON.stringify(before),
  `до=${before.diamonds.slice(0, 60)} после=${afterVertical.diamonds.slice(0, 60)}`);

await tap(page, el.x, el.y);
r.ok("тап открывает карточку задачи", await dialogOpen(page));
await page.keyboard.press("Escape");
await wait(800);

await swipe(page, el.x, el.y, 120, 0);
await wait(1200);
r.ok("горизонтальный drag двигает срок", JSON.stringify(await shape()) !== JSON.stringify(before));

const green = r.finish(errors);
await shutdown();
process.exit(green ? 0 : 1);
