import { assertEquals } from "jsr:@std/assert@1";
import { cleanExtractedField, toExtractedTask } from "./task-extract.ts";

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
