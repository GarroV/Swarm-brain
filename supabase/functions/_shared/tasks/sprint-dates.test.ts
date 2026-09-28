// Тесты до реализации. Даты спринта — ядро: ошибка молчит (спринт откроется не тем числом,
// и это заметят через две недели), а сама арифметика дат в JS полна ловушек с часовым поясом.
import { assertEquals, assertThrows } from "@std/assert";
import { addDays, nextCycleDates, sprintNumber } from "./sprint-dates.ts";

Deno.test("следующий спринт встык: старт на следующий день после конца прошлого", () => {
  const next = nextCycleDates({
    name: "Спринт 1 · 08.09 — 21.09",
    start_date: "2026-09-08",
    end_date: "2026-09-21",
  });
  assertEquals(next.start_date, "2026-09-22");
});

Deno.test("спринт длится 14 дней: конец — старт плюс 13", () => {
  const next = nextCycleDates({
    name: "Спринт 1",
    start_date: "2026-09-08",
    end_date: "2026-09-21",
  });
  assertEquals(next.end_date, "2026-10-05");
});

Deno.test("сверка — на шестой день от старта", () => {
  const next = nextCycleDates({
    name: "Спринт 1",
    start_date: "2026-09-08",
    end_date: "2026-09-21",
  });
  assertEquals(next.check_date, "2026-09-28");
});

Deno.test("номер спринта растёт на единицу, имя несёт даты", () => {
  const next = nextCycleDates({
    name: "Спринт 7 · 01.09 — 14.09",
    start_date: "2026-09-01",
    end_date: "2026-09-14",
  });
  assertEquals(next.name, "Спринт 8 · 15.09 — 28.09");
});

Deno.test("имя без номера — следующий считается вторым, а не падает", () => {
  // Спринт мог быть назван руками («Разбор долгов»). Терять из-за этого приёмку нельзя.
  const next = nextCycleDates({
    name: "Разбор долгов",
    start_date: "2026-09-01",
    end_date: "2026-09-14",
  });
  assertEquals(next.name, "Спринт 2 · 15.09 — 28.09");
});

Deno.test("переход через конец месяца считается верно", () => {
  const next = nextCycleDates({
    name: "Спринт 1",
    start_date: "2026-09-18",
    end_date: "2026-10-01",
  });
  assertEquals(next.start_date, "2026-10-02");
  assertEquals(next.end_date, "2026-10-15");
});

Deno.test("переход через конец года считается верно", () => {
  const next = nextCycleDates({
    name: "Спринт 26",
    start_date: "2026-12-15",
    end_date: "2026-12-28",
  });
  assertEquals(next.start_date, "2026-12-29");
  assertEquals(next.end_date, "2027-01-11");
  assertEquals(next.name, "Спринт 27 · 29.12 — 11.01");
});

Deno.test("29 февраля високосного года не теряется", () => {
  assertEquals(addDays("2028-02-28", 1), "2028-02-29");
  assertEquals(addDays("2028-02-28", 2), "2028-03-01");
});

Deno.test("день не съезжает от часового пояса: считаем календарь, а не время", () => {
  // Ловушка `new Date('2026-09-18')` — это полночь UTC, и в паре с локальным форматированием
  // даёт минус день у пользователя западнее Гринвича. Здесь дата — три числа, а не момент.
  const before = Deno.env.get("TZ");
  try {
    for (
      const tz of [
        "UTC",
        "Europe/Belgrade",
        "America/Los_Angeles",
        "Pacific/Kiritimati",
      ]
    ) {
      Deno.env.set("TZ", tz);
      assertEquals(
        addDays("2026-09-18", 13),
        "2026-10-01",
        `часовой пояс ${tz}`,
      );
    }
  } finally {
    if (before === undefined) Deno.env.delete("TZ");
    else Deno.env.set("TZ", before);
  }
});

Deno.test("номер спринта берётся из имени, а не угадывается", () => {
  assertEquals(sprintNumber("Спринт 12 · 01.09 — 14.09"), 12);
  assertEquals(sprintNumber("Sprint 3"), 3);
  assertEquals(sprintNumber("Разбор долгов"), null);
});

Deno.test("негодная дата — отказ с внятной причиной, а не тихий сдвиг", () => {
  assertThrows(
    () =>
      nextCycleDates({
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "31.09.2026",
      }),
    Error,
    "дата",
  );
});
