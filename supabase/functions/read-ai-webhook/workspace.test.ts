// Куда класть встречу из вебхука Read.ai — issue #56.
//
// Воркспейс был зашит строкой `group_id: "cee"` в двух местах. CLAUDE.md приводит ИМЕННО этот
// файл как пример запрещённого, то есть проблема считалась закрытой, а в коде оставалась.
// Опасность тихая: `workspaces.id` — опаковый слаг, оторванный от названия (в проде `id=cee`,
// `name="IMF BD"`), поэтому второй воркспейс или смена слага не уронят вебхук, а молча
// перемешают данные двух команд.
import { assertEquals } from "jsr:@std/assert@1";
import { resolveWebhookGroupId } from "./workspace.ts";

Deno.test("участники однозначно указывают на воркспейс — берём его", () => {
  const r = resolveWebhookGroupId(["cee", "cee"], null);
  assertEquals(r, { ok: true, groupId: "cee", via: "participants" });
});

Deno.test("участников не нашли — берём заданный конфигурацией, это не догадка", () => {
  const r = resolveWebhookGroupId([], "cee");
  assertEquals(r, { ok: true, groupId: "cee", via: "config" });
});

Deno.test("участники из РАЗНЫХ воркспейсов — отказ, а не выбор наугад", () => {
  const r = resolveWebhookGroupId(["cee", "emea"], "cee");
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.reason.includes("cee"), true);
    assertEquals(r.reason.includes("emea"), true);
  }
});

Deno.test("не нашли никого и конфигурации нет — отказ, а не молчаливый дефолт", () => {
  const r = resolveWebhookGroupId([], null);
  assertEquals(r.ok, false);
});

Deno.test("мусор в строках воркспейса не считается за участника", () => {
  // null/undefined/пустая строка приходят из select, где у строки нет group_id.
  assertEquals(resolveWebhookGroupId([null, undefined, ""], "cee"), { ok: true, groupId: "cee", via: "config" });
  // Пробелы в конфигурации не должны превращаться в «воркспейс задан».
  assertEquals(resolveWebhookGroupId([], "   ").ok, false);
});
