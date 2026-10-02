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

Deno.test("unitsByYear groups per chain", () => {
  assertEquals(unitsByYear(locs, ["a"], [2023, 2024]), { a: [3, 2] });
});
