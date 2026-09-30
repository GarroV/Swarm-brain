import { assertEquals } from "jsr:@std/assert@1";
import { narrowByAssignee } from "./assignee-filter.ts";

// Воспроизведение #626: у исполнителя 12 задач, но первые по сроку 30 строк воркспейса
// содержат только 9 из них. Фильтр обязан видеть весь срез и резать до лимита ПОСЛЕ.
const rows = [
  ...Array.from({ length: 21 }, (_, i) => ({ id: `other-${i}`, assignees: ["Pasha Vasko"] })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `mine-${i}`, assignees: ["Vasiliy Garro"] })),
];

Deno.test("narrowByAssignee: лимит применяется после фильтра — задачи исполнителя не теряются", () => {
  const { tasks, total } = narrowByAssignee(rows, "vasiliy", 30);
  assertEquals(tasks.length, 12);
  assertEquals(total, 12);
});

Deno.test("narrowByAssignee: срез до лимита сообщает, сколько подошло всего", () => {
  const { tasks, total } = narrowByAssignee(rows, "Garro", 5);
  assertEquals(tasks.map((t) => t.id), ["mine-0", "mine-1", "mine-2", "mine-3", "mine-4"]);
  assertEquals(total, 12);
});

Deno.test("narrowByAssignee: подстрока без учёта регистра, пустые исполнители не падают", () => {
  const mixed = [{ assignees: null }, { assignees: [] }, { assignees: ["Ксения Федотова"] }];
  assertEquals(narrowByAssignee(mixed, "КСЕНИЯ", 30).total, 1);
});
