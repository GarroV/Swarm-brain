// Тесты до реализации. Ссылки — вход от пользователя, который потом рисуется как <a href>:
// пропущенный `javascript:` — это XSS, а молча выброшенная ссылка — потерянные материалы.
import { assertEquals, assertThrows } from "@std/assert";
import { LINKS_MAX, parseLinks } from "./links.ts";

Deno.test("пусто и не задано — пустой список, а не отказ", () => {
  assertEquals(parseLinks(undefined), []);
  assertEquals(parseLinks(null), []);
  assertEquals(parseLinks([]), []);
});

Deno.test("строка превращается в ссылку без названия", () => {
  assertEquals(parseLinks(["https://example.com/doc"]), [
    { title: null, url: "https://example.com/doc" },
  ]);
});

Deno.test("объект с названием сохраняется как есть", () => {
  assertEquals(
    parseLinks([{ url: "https://example.com", title: "Материалы" }]),
    [
      { title: "Материалы", url: "https://example.com" },
    ],
  );
});

Deno.test("http и https принимаются, остальные схемы — отказ", () => {
  assertEquals(parseLinks(["http://example.com"]).length, 1);
  for (
    const bad of ["ftp://example.com", "mailto:a@b.c", "file:///etc/passwd"]
  ) {
    assertThrows(() => parseLinks([bad]), Error, "http");
  }
});

Deno.test("адрес javascript: отбивается — это XSS, а не ссылка", () => {
  assertThrows(() => parseLinks(["javascript:alert(1)"]), Error, "http");
  // Регистр и пробелы не должны помогать обойти проверку.
  assertThrows(() => parseLinks([" JavaScript:alert(1)"]), Error, "http");
  assertThrows(() => parseLinks(["JAVASCRIPT:alert(1)"]), Error, "http");
});

Deno.test("данные-адреса тоже не ссылки", () => {
  assertThrows(() => parseLinks(["data:text/html,<script>"]), Error, "http");
});

Deno.test("пробелы по краям срезаются", () => {
  assertEquals(
    parseLinks(["  https://example.com  "])[0].url,
    "https://example.com",
  );
  assertEquals(
    parseLinks([{ url: "https://example.com", title: "  Дока  " }])[0].title,
    "Дока",
  );
});

Deno.test("пустое название — это отсутствие названия, а не пустая строка", () => {
  assertEquals(
    parseLinks([{ url: "https://example.com", title: "   " }])[0].title,
    null,
  );
});

Deno.test("повторный одинаковый адрес не добавляется", () => {
  const out = parseLinks([
    { url: "https://example.com", title: "Первый" },
    { url: "https://example.com", title: "Он же" },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Первый");
});

Deno.test(`больше ${LINKS_MAX} ссылок — отказ с понятной причиной`, () => {
  const many = Array.from(
    { length: LINKS_MAX + 1 },
    (_, i) => `https://example.com/${i}`,
  );
  assertThrows(() => parseLinks(many), Error, String(LINKS_MAX));
  assertEquals(parseLinks(many.slice(0, LINKS_MAX)).length, LINKS_MAX);
});

Deno.test("не массив — отказ, а не молчаливое превращение в пустой список", () => {
  assertThrows(() => parseLinks("https://example.com"), Error, "списком");
  assertThrows(
    () => parseLinks({ url: "https://example.com" }),
    Error,
    "списком",
  );
});

Deno.test("негодный элемент называется по номеру — чтобы человек понял, что чинить", () => {
  assertThrows(
    () => parseLinks(["https://example.com", 42]),
    Error,
    "2",
  );
});

Deno.test("слишком длинное название обрезается, а ссылка не теряется", () => {
  const out = parseLinks([{
    url: "https://example.com",
    title: "я".repeat(500),
  }]);
  assertEquals(out[0].title?.length, 200);
  assertEquals(out[0].url, "https://example.com");
});

Deno.test("адрес без схемы — отказ: «example.com» в href ведёт не туда, куда человек думает", () => {
  assertThrows(() => parseLinks(["example.com"]), Error, "http");
});
