// Разбор полей инициативы. Проверка сроков молчит при ошибке: неверный интервал не падает,
// он просто рисует полоску не там, где надо, — поэтому тесты, а не «посмотрим на экране».
import { assertEquals } from "@std/assert";
import { parseProjectFields } from "./project-fields.ts";

Deno.test("не переданное поле не трогается, переданное пустым — снимается", () => {
  assertEquals(parseProjectFields({}).fields, {});
  assertEquals(
    parseProjectFields({ owner_telegram_id: null }).fields,
    { owner_telegram_id: null },
  );
  assertEquals(parseProjectFields({ end_date: null }).fields, {
    end_date: null,
  });
});

Deno.test("ответственный принимается числом и строкой цифр, но кладётся числом", () => {
  assertEquals(
    parseProjectFields({ owner_telegram_id: 744230399 }).fields
      .owner_telegram_id,
    744230399,
  );
  // Веб шлёт значение <select> строкой; в колонке bigint строка оказалась бы только после
  // молчаливого приведения на стороне базы.
  assertEquals(
    parseProjectFields({ owner_telegram_id: "744230399" }).fields
      .owner_telegram_id,
    744230399,
  );
});

Deno.test("ответственный мусором — отказ, а не тихая запись", () => {
  const out = parseProjectFields({ owner_telegram_id: "Вася" });
  assertEquals(out.fields, {});
  assertEquals(out.error?.includes("owner_telegram_id"), true);
});

Deno.test("дата принимается только в виде ГГГГ-ММ-ДД", () => {
  assertEquals(
    parseProjectFields({ start_date: "2026-09-18" }).fields.start_date,
    "2026-09-18",
  );
  for (const bad of ["18.09.2026", "2026-9-18", "завтра", 20260918]) {
    const out = parseProjectFields({ start_date: bad });
    assertEquals(out.error?.includes("start_date"), true, `принял ${bad}`);
  }
});

Deno.test("конец раньше старта — отказ", () => {
  const out = parseProjectFields({
    start_date: "2026-09-18",
    end_date: "2026-09-01",
  });
  assertEquals(out.fields, {});
  assertEquals(out.error, "start_date не может быть позже end_date");
});

Deno.test("правка одного конца сверяется с тем, что уже стоит у инициативы", () => {
  // Без этого «перенести конец на раньше старта» прошло бы: в теле запроса старта нет.
  const out = parseProjectFields({ end_date: "2026-08-01" }, {
    start_date: "2026-09-01",
  });
  assertEquals(out.error, "start_date не может быть позже end_date");

  const ok = parseProjectFields({ end_date: "2026-10-01" }, {
    start_date: "2026-09-01",
  });
  assertEquals(ok.error, null);
  assertEquals(ok.fields.end_date, "2026-10-01");
});

Deno.test("снятый старт не мешает поставить конец", () => {
  const out = parseProjectFields({ start_date: null, end_date: "2026-08-01" }, {
    start_date: "2026-09-01",
  });
  assertEquals(out.error, null);
  assertEquals(out.fields, { start_date: null, end_date: "2026-08-01" });
});

Deno.test("одинаковые даты — это один день, а не ошибка", () => {
  const out = parseProjectFields({
    start_date: "2026-09-18",
    end_date: "2026-09-18",
  });
  assertEquals(out.error, null);
});

// ── позиция в списке (перестановка на доске, issue #433) ─────────────────────
// Мусор в позиции ломается молча: строка уедет в непредсказуемое место списка или порядок
// схлопнется в дубли — на экране это выглядит как «карточки сами прыгают», а не как ошибка.

Deno.test("позиция принимается числом, в том числе дробным и отрицательным", () => {
  assertEquals(parseProjectFields({ position: 2500 }).fields.position, 2500);
  assertEquals(
    parseProjectFields({ position: 1500.5 }).fields.position,
    1500.5,
  );
  assertEquals(parseProjectFields({ position: -1000 }).fields.position, -1000);
});

Deno.test("позиция снимается только явным null", () => {
  assertEquals(parseProjectFields({ position: null }).fields, {
    position: null,
  });
  assertEquals(parseProjectFields({}).fields.position, undefined);
});

Deno.test("нечисло и не-конечное число в позиции — отказ, а не молчаливая запись", () => {
  for (
    const bad of [
      "вверх",
      "",
      true,
      {},
      [],
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]
  ) {
    const out = parseProjectFields({ position: bad });
    assertEquals(out.fields, {}, `принято мусорное значение: ${String(bad)}`);
    assertEquals(typeof out.error, "string");
  }
});
