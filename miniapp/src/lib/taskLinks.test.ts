import { assertEquals } from "@std/assert";
import { addLink, isSafeLinkUrl, linkLabel, LINKS_MAX } from "@/lib/taskLinks";
import type { TaskLink } from "@/types";

const none: TaskLink[] = [];

Deno.test("пустой ввод — не ошибка ввода, а «нечего добавлять»", () => {
  const r = addLink(none, "   ", null);
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.reason, "empty");
});

Deno.test("не адрес — отказ с причиной, а не молча", () => {
  const r = addLink(none, "просто текст", null);
  assertEquals(r.ok === false && r.reason, "not-url");
});

Deno.test("javascript: не ссылка, а выполнение чужого кода", () => {
  const r = addLink(none, "javascript:alert(1)", null);
  assertEquals(r.ok === false && r.reason, "protocol");
  assertEquals(isSafeLinkUrl("javascript:alert(1)"), false);
  assertEquals(isSafeLinkUrl("data:text/html,<script>"), false);
  assertEquals(isSafeLinkUrl("https://ok.example/x"), true);
});

Deno.test("http и https принимаются, края обрезаются", () => {
  const r = addLink(none, "  https://example.com/a  ", "  Дока  ");
  assertEquals(r.ok, true);
  assertEquals(r.ok && r.links, [{
    title: "Дока",
    url: "https://example.com/a",
  }]);
  assertEquals(addLink(none, "http://example.com", null).ok, true);
});

Deno.test("пустой заголовок хранится как null, а не как пустая строка", () => {
  const r = addLink(none, "https://example.com", "   ");
  assertEquals(r.ok && r.links[0].title, null);
});

Deno.test("тот же адрес второй раз не добавляется", () => {
  const have: TaskLink[] = [{ title: null, url: "https://example.com/a" }];
  const r = addLink(have, "https://example.com/a", "другое имя");
  assertEquals(r.ok === false && r.reason, "duplicate");
});

Deno.test("двадцать ссылок — потолок", () => {
  const have: TaskLink[] = Array.from({ length: LINKS_MAX }, (_, i) => ({
    title: null,
    url: `https://example.com/${i}`,
  }));
  const r = addLink(have, "https://example.com/new", null);
  assertEquals(r.ok === false && r.reason, "limit");
});

Deno.test("длинный заголовок режется, ссылка не теряется", () => {
  const r = addLink(none, "https://example.com", "я".repeat(500));
  assertEquals(r.ok && r.links[0].title?.length, 200);
  assertEquals(r.ok && r.links[0].url, "https://example.com");
});

Deno.test("подпись: заголовок, иначе адрес без схемы", () => {
  assertEquals(
    linkLabel({ title: "Дока", url: "https://example.com/a" }),
    "Дока",
  );
  assertEquals(
    linkLabel({ title: null, url: "https://example.com/a?b=1" }),
    "example.com/a",
  );
  assertEquals(
    linkLabel({ title: null, url: "https://example.com/" }),
    "example.com",
  );
  assertEquals(linkLabel({ title: null, url: "не адрес" }), "не адрес");
});
