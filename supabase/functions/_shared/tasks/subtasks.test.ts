import { assertEquals, assertStringIncludes } from "@std/assert";
import { subtaskLinkError, type SubtaskNode } from "./subtasks.ts";

const node = (over: Partial<SubtaskNode> & { id: string }): SubtaskNode => ({
  group_id: "g",
  project_id: "p1",
  parent_id: null,
  title: over.id,
  ...over,
});
const ok = { groupId: "g", childHasKids: false };

Deno.test("subtaskLinkError: задача верхнего уровня того же проекта — можно", () => {
  assertEquals(
    subtaskLinkError(node({ id: "A" }), node({ id: "b" }), ok),
    null,
  );
  assertEquals(
    subtaskLinkError(node({ id: "A" }), null, ok),
    null,
    "новая подзадача",
  );
});

Deno.test("subtaskLinkError: вложенность одна — подзадача не родитель, родитель не подзадача", () => {
  const sub = node({ id: "a1", parent_id: "A" });
  assertStringIncludes(
    subtaskLinkError(sub, node({ id: "b" }), ok)!,
    "верхнего уровня",
  );
  assertStringIncludes(
    subtaskLinkError(sub, null, ok)!,
    "верхнего уровня",
    "и при создании",
  );
  assertStringIncludes(
    subtaskLinkError(node({ id: "A" }), node({ id: "B" }), {
      ...ok,
      childHasKids: true,
    })!,
    "уже есть подзадачи",
  );
});

Deno.test("subtaskLinkError: сама себе, другой проект, чужой воркспейс — отказ", () => {
  assertStringIncludes(
    subtaskLinkError(node({ id: "A" }), node({ id: "A" }), ok)!,
    "самой себя",
  );
  assertStringIncludes(
    subtaskLinkError(
      node({ id: "A" }),
      node({ id: "b", project_id: "p2" }),
      ok,
    )!,
    "проекте родителя",
  );
  // Чужой воркспейс отвечает как «не найдена» — существование чужой задачи не подтверждаем.
  assertEquals(
    subtaskLinkError(node({ id: "A", group_id: "other" }), null, ok),
    "Задача A не найдена.",
  );
});
