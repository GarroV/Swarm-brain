import { assertEquals } from "@std/assert";
import { aliveAtYearEnd, unitsByYear } from "./marketStats.ts";

const locs = [
  { chain: "a", opened: null, status: "open", closed: null }, // без даты — до первого года
  { chain: "a", opened: "2023-11", status: "open", closed: null },
  { chain: "a", opened: "2022", status: "closed", closed: "2024-03" },
  { chain: "a", opened: "2027", status: "planned", closed: null }, // анонс не считается
];

Deno.test("aliveAtYearEnd handles partial dates, closures and announcements", () => {
  assertEquals(aliveAtYearEnd(locs, 2021), 1);
  assertEquals(aliveAtYearEnd(locs, 2022), 2);
  assertEquals(aliveAtYearEnd(locs, 2023), 3);
  assertEquals(aliveAtYearEnd(locs, 2024), 2);
});

Deno.test("a closure without a date: never counted, except a Dodo API point that is gone only now", () => {
  // Правило эталона: закрытую без даты точку реестра не считаем ни в одном году.
  const shut = [{ chain: "a", opened: "2019", status: "closed", closed: null }];
  assertEquals(aliveAtYearEnd(shut, 2025, 2026), 0);
  // API Dodo отдаёт закрытую пиццерию без даты закрытия: она есть в прошлом, но не сейчас.
  const api = [{ ...shut[0], source_kind: "dodo" }];
  assertEquals(aliveAtYearEnd(api, 2026, 2026), 0);
  assertEquals(aliveAtYearEnd(api, 2025, 2026), 1);
});

Deno.test("unitsByYear groups per chain", () => {
  assertEquals(unitsByYear(locs, ["a"], [2023, 2024]), { a: [3, 2] });
});
