// Куда класть встречу из вебхука Read.ai — issue #56.
//
// Воркспейс был зашит строкой `group_id: "cee"` в двух местах. CLAUDE.md приводит ИМЕННО этот
// файл как пример запрещённого, то есть проблема считалась закрытой, а в коде оставалась.
// Опасность тихая: `workspaces.id` — опаковый слаг, оторванный от названия (в проде `id=cee`,
// `name="IMF BD"`), поэтому второй воркспейс или смена слага не уронят вебхук, а молча
// перемешают данные двух команд.
//
// С 05.11.2026 (этап 2 решения о втором пространстве) смешанный состав — не отказ: встреча
// получает домашнее пространство и видна обеим командам через признак принадлежности.
import { assertEquals } from "jsr:@std/assert@1";
import { resolveWebhookGroupId } from "./workspace.ts";

const m = (email: string, group_id: string | null | undefined) => ({ email, group_id });

Deno.test("участники однозначно указывают на воркспейс — берём его", () => {
  const r = resolveWebhookGroupId([m("a@x", "cee"), m("b@x", "cee")], null);
  assertEquals(r, { ok: true, groupId: "cee", visibleGroupIds: ["cee"], via: "participants" });
});

Deno.test("участников не нашли — берём заданный конфигурацией, это не догадка", () => {
  const r = resolveWebhookGroupId([], "cee");
  assertEquals(r, { ok: true, groupId: "cee", visibleGroupIds: ["cee"], via: "config" });
});

Deno.test("участники из РАЗНЫХ воркспейсов — встреча сохраняется и видна обеим командам", () => {
  const r = resolveWebhookGroupId([m("a@x", "cee"), m("b@x", "world"), m("c@x", "world")], "cee");
  assertEquals(r, { ok: true, groupId: "world", visibleGroupIds: ["cee", "world"], via: "majority" });
});

Deno.test("смешанный состав: домашнее — пространство владельца встречи, даже если он в меньшинстве", () => {
  const r = resolveWebhookGroupId(
    [m("Owner@X", "cee"), m("b@x", "world"), m("c@x", "world")],
    null,
    " owner@x ",
  );
  assertEquals(r, { ok: true, groupId: "cee", visibleGroupIds: ["cee", "world"], via: "owner" });
});

Deno.test("смешанный состав: владелец не найден — большинство; ничья — меньший id, детерминированно", () => {
  const tie = [m("a@x", "world"), m("b@x", "cee")];
  assertEquals(resolveWebhookGroupId(tie, null, "stranger@x"), {
    ok: true,
    groupId: "cee",
    visibleGroupIds: ["cee", "world"],
    via: "majority",
  });
  // Порядок участников ответ не меняет.
  assertEquals(resolveWebhookGroupId([...tie].reverse(), null), resolveWebhookGroupId(tie, null));
});

Deno.test("один человек голосует один раз: повтор e-mail не делает большинство", () => {
  const r = resolveWebhookGroupId([m("a@x", "world"), m("A@x", "world"), m("b@x", "cee"), m("c@x", "cee")], null);
  assertEquals(r.ok && r.groupId, "cee");
});

Deno.test("не нашли никого и конфигурации нет — отказ, а не молчаливый дефолт", () => {
  const r = resolveWebhookGroupId([], null);
  assertEquals(r.ok, false);
});

Deno.test("мусор в строках воркспейса не считается за участника", () => {
  // null/undefined/пустая строка приходят из select, где у строки нет group_id.
  assertEquals(resolveWebhookGroupId([m("a@x", null), m("b@x", undefined), m("c@x", "")], "cee"), {
    ok: true,
    groupId: "cee",
    visibleGroupIds: ["cee"],
    via: "config",
  });
  // Пробелы в конфигурации не должны превращаться в «воркспейс задан».
  assertEquals(resolveWebhookGroupId([], "   ").ok, false);
});
