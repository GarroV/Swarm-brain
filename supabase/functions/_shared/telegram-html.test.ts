// Тесты экранирования HTML для сообщений Telegram.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml, sanitizeModelHtml } from "./telegram-html.ts";

Deno.test("escapeHtml — экранирует & < > и кавычки", () => {
  assertEquals(escapeHtml(`a & <b> "c"`), "a &amp; &lt;b&gt; &quot;c&quot;");
});

Deno.test("escapeHtml — обычный текст не меняется", () => {
  assertEquals(escapeHtml("Встреча 12.10, рынок PL"), "Встреча 12.10, рынок PL");
});

Deno.test("sanitizeModelHtml — ссылка остаётся видимым текстом", () => {
  const out = sanitizeModelHtml(`<a href="https://evil.example">x</a>`);
  assertEquals(out, `&lt;a href="https://evil.example"&gt;x&lt;/a&gt;`);
});

Deno.test("sanitizeModelHtml — тег с атрибутом экранируется", () => {
  assertEquals(sanitizeModelHtml(`<b onclick=alert(1)>x</b>`), "&lt;b onclick=alert(1)&gt;x&lt;/b&gt;");
});

Deno.test("sanitizeModelHtml — вложенные разрешённые теги сохраняются", () => {
  assertEquals(
    sanitizeModelHtml("<b>жирный <i>и курсив</i></b> <code>x</code>"),
    "<b>жирный <i>и курсив</i></b> <code>x</code>",
  );
});

Deno.test("sanitizeModelHtml — регистр тегов нормализуется, теги без пары экранируются", () => {
  assertEquals(sanitizeModelHtml("<B>да</B>"), "<b>да</b>");
  assertEquals(sanitizeModelHtml("<b>без закрытия"), "&lt;b&gt;без закрытия");
  assertEquals(sanitizeModelHtml("лишний</i> закрывающий"), "лишний&lt;/i&gt; закрывающий");
  assertEquals(sanitizeModelHtml("<b><i>x</b></i>"), "&lt;b&gt;<i>x&lt;/b&gt;</i>");
});

Deno.test("sanitizeModelHtml — неизвестные теги экранируются", () => {
  assertEquals(
    sanitizeModelHtml("<script>x</script><tg-spoiler>y</tg-spoiler>"),
    "&lt;script&gt;x&lt;/script&gt;&lt;tg-spoiler&gt;y&lt;/tg-spoiler&gt;",
  );
});

Deno.test("sanitizeModelHtml — & внутри разрешённых тегов экранируется один раз", () => {
  assertEquals(sanitizeModelHtml("<b>A & B</b> <i>1 < 2</i>"), "<b>A &amp; B</b> <i>1 &lt; 2</i>");
});

Deno.test("sanitizeModelHtml — кавычки в тексте остаются как есть", () => {
  assertEquals(sanitizeModelHtml(`он сказал "да"`), `он сказал "да"`);
});

Deno.test("sanitizeModelHtml — тег ссылки не разрешён даже без атрибутов", () => {
  assertEquals(sanitizeModelHtml("<a>x</a>"), "&lt;a&gt;x&lt;/a&gt;");
});
