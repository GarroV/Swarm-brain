// Пул «Задачи» экрана спринтов: фильтр по проекту иерархический (решение владельца 09.09.2026),
// поэтому выбор группы обязан приносить задачи её подпроектов, а выбор подпроекта — только свои.
import { assertEquals } from "jsr:@std/assert";
import {
  POOL_ALL, filterPoolTasks, poolCandidates, projectOptions, projectScope,
} from "./sprintPool.ts";
import type { Project, Task } from "../types.ts";

function project(id: string, name: string, parent_id: string | null = null): Project {
  return { id, name, parent_id } as Project;
}

function task(id: string, project_id: string | null, over: Partial<Task> = {}): Task {
  return { id, title: id, project_id, assignees: [], status: "open", ...over } as Task;
}

// Группа «Продукт» с двумя подпроектами, отдельный обычный проект и задача без проекта.
const PROJECTS: Project[] = [
  project("gr", "Продукт"),
  project("kid1", "Поиск", "gr"),
  project("kid2", "Рекордер", "gr"),
  project("solo", "Операционка"),
];
const TASKS: Task[] = [
  task("t_group", "gr"),                              // прямо в группе («Общее»)
  task("t_kid1", "kid1"),
  task("t_kid2", "kid2"),
  task("t_solo", "solo"),
  task("t_none", null),
];
const ALL: { query: string; projectId: string; assignee: string } = {
  query: "", projectId: POOL_ALL, assignee: POOL_ALL,
};

Deno.test("выбор группы приносит её собственные задачи И задачи подпроектов", () => {
  const ids = filterPoolTasks(TASKS, PROJECTS, { ...ALL, projectId: "gr" }).map((t) => t.id);
  assertEquals(ids, ["t_group", "t_kid1", "t_kid2"]);
});

Deno.test("выбор подпроекта приносит только его задачи", () => {
  const ids = filterPoolTasks(TASKS, PROJECTS, { ...ALL, projectId: "kid1" }).map((t) => t.id);
  assertEquals(ids, ["t_kid1"]);
});

Deno.test("проект без подпроектов ведёт себя как раньше — точное совпадение", () => {
  const ids = filterPoolTasks(TASKS, PROJECTS, { ...ALL, projectId: "solo" }).map((t) => t.id);
  assertEquals(ids, ["t_solo"]);
});

Deno.test("«Все проекты» сам по себе ничего не отсекает — отбор делает poolCandidates", () => {
  assertEquals(filterPoolTasks(TASKS, PROJECTS, ALL).length, TASKS.length);
});

Deno.test("фильтры складываются: проект + исполнитель + поиск", () => {
  const tasks = [
    task("a", "kid1", { title: "Починить поиск", assignees: ["Аня"] }),
    task("b", "kid1", { title: "Починить поиск", assignees: ["Петя"] }),
    task("c", "kid2", { title: "Починить поиск", assignees: ["Аня"] }),
    task("d", "kid1", { title: "Другое", assignees: ["Аня"] }),
  ];
  const ids = filterPoolTasks(tasks, PROJECTS, { query: "поиск", projectId: "gr", assignee: "Аня" })
    .map((t) => t.id);
  assertEquals(ids, ["a", "c"]);
});

Deno.test("поиск не зависит от регистра", () => {
  const tasks = [task("a", null, { title: "Провести Финализацию" })];
  assertEquals(filterPoolTasks(tasks, PROJECTS, { ...ALL, query: "финализацию" }).length, 1);
  assertEquals(filterPoolTasks(tasks, PROJECTS, { ...ALL, query: "ФИНАЛ" }).length, 1);
});

Deno.test("задача без проекта не попадает под выбор любого проекта", () => {
  assertEquals(filterPoolTasks(TASKS, PROJECTS, { ...ALL, projectId: "gr" }).some((t) => t.id === "t_none"), false);
});

Deno.test("projectScope: группа тянет подпроекты, подпроект — только себя", () => {
  assertEquals([...projectScope("gr", PROJECTS)].sort(), ["gr", "kid1", "kid2"]);
  assertEquals([...projectScope("kid1", PROJECTS)], ["kid1"]);
});

Deno.test("projectScope не зацикливается на битой ссылке самого на себя", () => {
  const broken = [project("x", "X", "x")];
  assertEquals([...projectScope("x", broken)], ["x"]);
});

Deno.test("опции идут деревом: родитель, под ним его подпроекты", () => {
  assertEquals(
    projectOptions(PROJECTS).map((o) => `${o.child ? "› " : ""}${o.label}`),
    ["Операционка", "Продукт", "› Поиск", "› Рекордер"],
  );
});

Deno.test("подпроект без видимого родителя не исчезает из списка", () => {
  const partial = [project("kid1", "Поиск", "gr_hidden")];
  assertEquals(projectOptions(partial).map((o) => o.label), ["Поиск"]);
});

Deno.test("в пул не попадают взятые в спринт, закрытые и приватные", () => {
  const tasks = [
    task("свободная", "kid1"),
    task("взятая", "kid1"),
    task("закрытая", "kid1", { status: "done" }),
    task("отменённая", "kid1", { status: "cancelled" }),
    task("приватная", "kid1", { is_private: true }),
  ];
  const ids = poolCandidates(tasks, new Set(["взятая"])).map((t) => t.id);
  assertEquals(ids, ["свободная"]);
});

Deno.test("своя приватная задача тоже не попадает — сервер её в спринт не возьмёт", () => {
  const mine = [task("моя личная", "kid1", { is_private: true, owner_id: 1 })];
  assertEquals(poolCandidates(mine, new Set()).length, 0);
});

// Решение владельца 10.09.2026: «только то что в пространстве проектов!»
Deno.test("задача без проекта в пул не попадает вовсе", () => {
  const tasks = [task("в проекте", "kid1"), task("сама по себе", null)];
  assertEquals(poolCandidates(tasks, new Set()).map((t) => t.id), ["в проекте"]);
});

Deno.test("«Все проекты» — это все задачи ПРОЕКТОВ, задача без проекта не всплывает", () => {
  const pool = poolCandidates(TASKS, new Set());
  const ids = filterPoolTasks(pool, PROJECTS, ALL).map((t) => t.id);
  assertEquals(ids, ["t_group", "t_kid1", "t_kid2", "t_solo"]);
});
