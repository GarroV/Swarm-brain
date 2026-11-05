// Словарь экрана «Пространства»: обе локали заведены целиком, подстановки совпадают, слаг не просачивается.
// Раннер: deno test -A --no-check src/lib/ (bare specifier из deno.json).
import { assert, assertEquals } from "@std/assert";
import { SPACES_TEXT, spacesText } from "./spacesDict.ts";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

Deno.test("у каждой записи обе локали непустые", () => {
  for (const [key, e] of Object.entries(SPACES_TEXT)) {
    assert(e.ru.trim() !== "", `${key}: пустой ru`);
    assert(e.en.trim() !== "", `${key}: пустой en`);
  }
});

Deno.test("подстановки в ru и en совпадают (иначе на одном языке появится «{n}» или пропадёт число)", () => {
  for (const [key, e] of Object.entries(SPACES_TEXT)) assertEquals(vars(e.ru), vars(e.en), key);
});

Deno.test("подстановка заменяет все вхождения, неизвестное оставляет как есть", () => {
  assertEquals(spacesText("en", "moveTitle", { name: "Alice", to: "World" }), "Move Alice to “World”?");
  assertEquals(spacesText("ru", "moveTitle", { name: "Алиса", to: "World" }), "Перенести Алиса в «World»?");
  assertEquals(spacesText("en", "moveTitle", { name: "A" }), "Move A to “{to}”?");
});

Deno.test("в тексте нигде не просят и не показывают слаг пространства", () => {
  for (const [key, e] of Object.entries(SPACES_TEXT)) {
    assert(!/\bslug\b|\bID\b|слаг|\bid\b/i.test(`${e.ru} ${e.en}`.replace(/Telegram ID/g, "")), key);
  }
});
