import { tap, wait } from "./lib.mjs";

/** Kept tabs have DOM too. Only an exposed control can receive the test's touch. */
export async function touchControl(
  page,
  { selector = "button,[role=button],a", text } = {},
) {
  const point = await page.evaluate(({ selector, text }) => {
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.closest("[hidden]");
    };
    const all = [...document.querySelectorAll(selector)].filter(visible);
    const el = text === undefined
      ? all[0]
      : all.find((e) => e.innerText.trim() === text) ??
        all.find((e) => e.innerText.includes(text));
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const top = document.elementFromPoint(point.x, point.y);
    return top && el.contains(top) ? point : null;
  }, { selector, text });
  if (!point) return false;
  await tap(page, point.x, point.y);
  return true;
}

export const clickText = (page, text) => touchControl(page, { text });

export const visibleTitle = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("h1")]
      .find((e) =>
        e.getBoundingClientRect().width > 0 && !e.closest("[hidden]")
      )?.innerText
  );

export const dialogOpen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')]
      .some((e) =>
        e.getBoundingClientRect().width > 0 && !e.closest("[hidden]")
      )
  );

export const swipeRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-swipe-content]")]
      .map((content) => {
        const row = content.parentElement, b = row.getBoundingClientRect();
        const x = Math.min(b.right - 10, Math.max(b.left + 10, 195)),
          y = b.y + b.height / 2;
        const top = document.elementFromPoint(x, y);
        if (
          row.closest("[hidden]") || !b.width || b.top < 0 ||
          b.bottom > innerHeight || !top || !row.contains(top)
        ) return null;
        return {
          y: Math.round(b.y),
          h: Math.round(b.height),
          dx: content.style.transform,
          title: row.innerText.split("\n")[0].slice(0, 30),
        };
      }).filter(Boolean)
  );

export async function stableRows(page) {
  let previous = JSON.stringify(await swipeRows(page));
  for (let i = 0; i < 15; i++) {
    await wait(200);
    const current = JSON.stringify(await swipeRows(page));
    if (current === previous) return JSON.parse(current);
    previous = current;
  }
  return JSON.parse(previous);
}
