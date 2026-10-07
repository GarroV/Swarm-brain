// План пространства спринтов (решение 07.10.2026): что входит, как считается, как фильтруется.
import { assertEquals } from "@std/assert";
import { buildPlan, canTake, planProjects } from "./sprintPlan.ts";
import { splitMine } from "./sprintMine.ts";
import type { Project, Task } from "../types.ts";

const SPACE = "space-q";

function group(
  id: string,
  name: string,
  extra: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    parent_id: null,
    sprint_group: true,
    sprint_id: SPACE,
    ...extra,
  } as Project;
}

let seq = 0;
function task(
  id: string,
  project_id: string | null,
  extra: Partial<Task> = {},
): Task {
  seq += 1;
  return {
    id,
    title: `Задача ${id}`,
    project_id,
    parent_id: null,
    status: "open",
    created_at: `2026-10-0${Math.min(seq, 9)}T00:00:00Z`,
    assignee_telegram_ids: [],
    ...extra,
  } as Task;
}

Deno.test("planProjects: только группы этого пространства верхнего уровня, «2.» раньше «14.»", () => {
  const projects = [
    group("g14", "14. Gemba"),
    group("g2", "2. Аудиты"),
    group("other", "Чужое", { sprint_id: "space-x" }),
    group("plain", "Обычный проект", { sprint_group: false }),
    group("child", "Подгруппа", { parent_id: "g2" }),
  ];
  assertEquals(planProjects(projects, SPACE).map((p) => p.id), ["g2", "g14"]);
  assertEquals(planProjects(projects, null), []);
});

Deno.test("buildPlan: считает закрытые и всего по группе и по плану, черновики не идут", () => {
  const projects = [group("g1", "1. Рейтинги"), group("g2", "2. Аудиты")];
  const tasks = [
    task("a", "g1", { status: "done" }),
    task("b", "g1"),
    task("c", "g2", { status: "cancelled" }),
    task("d", "g2", { status: "draft" }),
    task("e", null),
  ];
  const plan = buildPlan(tasks, projects, SPACE, new Set(["b"]));
  assertEquals(plan.groups.map((g) => [g.project.id, g.done, g.total]), [
    ["g1", 1, 2],
    ["g2", 1, 1],
  ]);
  assertEquals([plan.done, plan.total], [2, 3]);
  // b уже в спринте, a и c закрыты — брать нечего.
  assertEquals(plan.available, 0);
});

Deno.test("buildPlan: открытые выше закрытых, подзадача под родителем своей группы", () => {
  const projects = [group("g1", "1. Рейтинги")];
  const tasks = [
    task("closed", "g1", { status: "done" }),
    task("parent", "g1"),
    task("kid", "g1", { parent_id: "parent" }),
    task("orphan", "g1", { parent_id: "elsewhere" }),
  ];
  const [g] = buildPlan(tasks, projects, SPACE, new Set()).groups;
  assertEquals(g.tasks.map((t) => t.task.id), ["parent", "orphan", "closed"]);
  assertEquals(g.tasks[0].kids.map((t) => t.task.id), ["kid"]);
});

Deno.test("buildPlan: поиск прячет группы без совпадений и держит родителя найденной подзадачи", () => {
  const projects = [group("g1", "1. Рейтинги"), group("g2", "2. Аудиты")];
  const tasks = [
    task("parent", "g1", { title: "Собрать данные" }),
    task("kid", "g1", { parent_id: "parent", title: "Выгрузка рейтинга" }),
    task("other", "g2", { title: "Чек-лист" }),
  ];
  const plan = buildPlan(tasks, projects, SPACE, new Set(), {
    query: "РЕЙТИНГ",
  });
  assertEquals(plan.groups.map((g) => g.project.id), ["g1"]);
  assertEquals(plan.groups[0].tasks[0].task.id, "parent");
  assertEquals(plan.groups[0].tasks[0].kids.map((t) => t.task.id), ["kid"]);
  // Итог плана фильтром не меняется: это ответ на «сколько сделано всего».
  assertEquals(plan.total, 3);
});

Deno.test("buildPlan: «скрыть готовые» прячет закрытые, но пустая группа без поиска видна", () => {
  const projects = [group("g1", "1. Рейтинги"), group("g2", "2. Пустая")];
  const tasks = [task("a", "g1", { status: "done" }), task("b", "g1")];
  const plan = buildPlan(tasks, projects, SPACE, new Set(), { hideDone: true });
  assertEquals(plan.groups.map((g) => [g.project.id, g.tasks.length]), [
    ["g1", 1],
    ["g2", 0],
  ]);
});

Deno.test("canTake: только открытая и ещё не в спринте", () => {
  const projects = [group("g1", "1")];
  const tasks = [
    task("open", "g1"),
    task("in", "g1"),
    task("done", "g1", { status: "done" }),
  ];
  const [g] = buildPlan(tasks, projects, SPACE, new Set(["in"])).groups;
  const take = Object.fromEntries(g.tasks.map((t) => [t.task.id, canTake(t)]));
  assertEquals(take, { open: true, in: false, done: false });
});

Deno.test("splitMine: своя — по telegram_id в исполнителях живой задачи", () => {
  const items = [{ task_id: "a" }, { task_id: "b" }, { task_id: null }];
  const tasks = [
    { id: "a", assignee_telegram_ids: [7, 8] },
    { id: "b", assignee_telegram_ids: [9] },
  ];
  const { mine, others } = splitMine(items, tasks, 7);
  assertEquals(mine.map((i) => i.task_id), ["a"]);
  assertEquals(others.map((i) => i.task_id), ["b", null]);
  assertEquals(splitMine(items, tasks, null).mine, []);
});
