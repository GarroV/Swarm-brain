import { assertEquals } from "jsr:@std/assert@1";
import { DEMO_FALLBACK_ERROR, englishDemoResponse, englishError, englishErrorBody } from "./demo-english.ts";

Deno.test("демо: известный русский отказ → английский, русский в error_ru", () => {
  assertEquals(englishErrorBody({ error: "Задача не найдена" }), {
    error: "Task not found",
    error_ru: "Задача не найдена",
  });
});

Deno.test("демо: шаблонные отказы по полям", () => {
  assertEquals(englishError("project_id не найден в этом воркспейсе"), "project_id not found in this workspace");
  assertEquals(englishError("start_date и end_date обязательны"), "start_date and end_date are required");
  assertEquals(englishError("notify: ожидается true/false"), "notify: invalid value");
  assertEquals(englishError("Not found или спринт уже принят"), "Not found, or the sprint is already accepted");
});

Deno.test("демо: неизвестный русский текст не протекает — общий английский", () => {
  assertEquals(englishError("Совсем новая ошибка"), DEMO_FALLBACK_ERROR);
});

Deno.test("демо: английский и уже двуязычный ответ не трогаются", () => {
  assertEquals(englishErrorBody({ error: "Not found" }), { error: "Not found" });
  const both = { error: "Demo can't", error_ru: "Демо не может", code: "demo_not_allowed" };
  assertEquals(englishErrorBody(both), both);
  assertEquals(englishErrorBody([1, 2]), [1, 2]);
});

Deno.test("демо: ответ переводится с тем же статусом и заголовками, успех не трогается", async () => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const res = await englishDemoResponse(
    new Response(JSON.stringify({ error: "Метка не найдена" }), { status: 404, headers }),
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertEquals(await res.json(), { error: "Label not found", error_ru: "Метка не найдена" });
  const ok = new Response(JSON.stringify({ error: "Задача не найдена" }), { status: 200, headers });
  assertEquals(await englishDemoResponse(ok), ok);
});
