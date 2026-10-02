import { assertEquals } from "jsr:@std/assert@1";
import { cleanExtractedField, parseExtractorReply, toExtractedTask } from "./task-extract.ts";

Deno.test("cleanExtractedField: строковые пустоты модели — это null (issue #125)", () => {
  for (const v of ["null", "None", " n/a ", "—", ""]) assertEquals(cleanExtractedField(v), null);
  assertEquals(cleanExtractedField(42), null);
});

Deno.test("cleanExtractedField: настоящее значение тримится", () => {
  assertEquals(cleanExtractedField("  RS "), "RS");
});

Deno.test("toExtractedTask: без заголовка задачи нет", () => {
  assertEquals(toExtractedTask({ title: "null", assignee: "Анна" }, "2026-09-25"), null);
});

Deno.test("toExtractedTask: поля чистятся, заголовок сохраняется", () => {
  assertEquals(toExtractedTask({ title: "Созвониться", assignee: "null", country: "RS" }, "2026-09-25"), {
    title: "Созвониться",
    description: null,
    assignee: null,
    due_date: null,
    country: "RS",
  });
});

// ── Отказ модели ≠ «задач нет» (issue #374) ──────────────────────────────────
const reply = (content: unknown) => ({ choices: [{ message: { content } }] });

Deno.test("разбор: пустой список от модели — это «задач нет», а не отказ", () => {
  assertEquals(parseExtractorReply(reply("[]"), "2026-10-02"), { ok: true, tasks: [] });
});

Deno.test("разбор: задачи в ```json-обёртке разбираются", () => {
  const r = parseExtractorReply(reply('```json\n[{"title":"Отчёт"}]\n```'), "2026-10-02");
  assertEquals(r.ok && r.tasks.map((t) => t.title), ["Отчёт"]);
});

Deno.test("разбор: мусор, не-массив и ответ без текста — отказ, а не пустой список", () => {
  assertEquals(parseExtractorReply(reply("не json"), "2026-10-02"), { ok: false, reason: "malformed" });
  assertEquals(parseExtractorReply(reply('{"title":"x"}'), "2026-10-02"), { ok: false, reason: "malformed" });
  assertEquals(parseExtractorReply({ error: { message: "quota" } }, "2026-10-02"), { ok: false, reason: "malformed" });
  assertEquals(parseExtractorReply(null, "2026-10-02"), { ok: false, reason: "malformed" });
});
