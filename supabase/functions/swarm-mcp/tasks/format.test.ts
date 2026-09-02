import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  addTaskOutcome,
  formatProjectTree,
  formatTaskLine,
  projectNotFoundMessage,
  type ProjectTreeRow,
} from "./format.ts";

const row = (p: Partial<ProjectTreeRow> & { id: string; name: string }): ProjectTreeRow => ({
  parent_id: null, task_count: 0, backlog_count: 0, ...p,
});

// ── get_projects: дерево досок (issue #198) ───────────────────────────────────

Deno.test("formatProjectTree: подпроект печатается под своим проектом", () => {
  const out = formatProjectTree([
    row({ id: "p1", name: "Vibe Coding", task_count: 12, backlog_count: 5 }),
    row({ id: "p2", name: "Audit Management System", parent_id: "p1", task_count: 3, backlog_count: 1 }),
  ]);
  const lines = out.split("\n");
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0], "Vibe Coding");
  assertStringIncludes(lines[0], "p1");
  // Вложенность видна отступом, иначе агент не отличит проект от подпроекта.
  assert(lines[1].startsWith("  "), `подпроект без отступа: ${lines[1]}`);
  assertStringIncludes(lines[1], "Audit Management System");
});

Deno.test("formatProjectTree: id печатается у каждой строки — иначе имя придётся угадывать снова", () => {
  const out = formatProjectTree([row({ id: "abc-123", name: "P" })]);
  assertStringIncludes(out, "abc-123");
});

Deno.test("formatProjectTree: счётчики задач и бэклога в строке", () => {
  const out = formatProjectTree([row({ id: "p", name: "P", task_count: 7, backlog_count: 2 })]);
  assertStringIncludes(out, "7");
  assertStringIncludes(out, "2");
});

Deno.test("formatProjectTree: подпроект с недоступным родителем не теряется", () => {
  // Родитель отфильтрован приватностью (canViewProject) — ребёнок обязан остаться в выдаче
  // верхним уровнем, а не исчезнуть молча.
  const out = formatProjectTree([row({ id: "kid", name: "Сирота", parent_id: "gone" })]);
  assertStringIncludes(out, "Сирота");
});

Deno.test("formatProjectTree: пустой список — прямой текст, не пустая строка", () => {
  const out = formatProjectTree([]);
  assert(out.trim().length > 0);
  assertStringIncludes(out, "нет проектов");
});

Deno.test("formatProjectTree: порядок проектов сохраняется (created_at из listProjects)", () => {
  const out = formatProjectTree([
    row({ id: "a", name: "Первый" }),
    row({ id: "b", name: "Второй" }),
  ]);
  assert(out.indexOf("Первый") < out.indexOf("Второй"));
});

// ── get_tasks: неизвестный проект (issue #199) ────────────────────────────────

Deno.test("projectNotFoundMessage: говорит, что фильтр НЕ применён", () => {
  const msg = projectNotFoundMessage("аудит", ["Vibe Coding", "Audit Management System"]);
  assertStringIncludes(msg, "аудит");
  // Регистр не важен, важно что про неприменённый фильтр сказано.
  assertStringIncludes(msg.toLowerCase(), "не применён");
});

Deno.test("projectNotFoundMessage: перечисляет доступные проекты и указывает на get_projects", () => {
  const msg = projectNotFoundMessage("VC", ["Vibe Coding"]);
  assertStringIncludes(msg, "Vibe Coding");
  assertStringIncludes(msg, "get_projects");
});

Deno.test("projectNotFoundMessage: без доступных проектов не печатает пустой список", () => {
  const msg = projectNotFoundMessage("X", []);
  assert(!msg.includes("Доступные проекты:"), msg);
});

// ── get_tasks: видимость confirmed (issue #201) ───────────────────────────────

Deno.test("formatTaskLine: неподтверждённая задача помечена — агент не примет её за задачу на доске", () => {
  const line = formatTaskLine({ status: "open", title: "T", confirmed: false });
  assertStringIncludes(line, "на проверке");
});

Deno.test("formatTaskLine: подтверждённая задача без пометки", () => {
  const line = formatTaskLine({ status: "open", title: "T", confirmed: true });
  assert(!line.includes("на проверке"), line);
});

Deno.test("formatTaskLine: исполнитель, срок и рынок на месте (формат не сломан)", () => {
  const line = formatTaskLine({
    status: "in_progress", title: "Название", assignees: ["Вася"],
    due_date: "2026-09-10", country: "Bulgaria", confirmed: true,
  });
  assertStringIncludes(line, "[in_progress]");
  assertStringIncludes(line, "Название");
  assertStringIncludes(line, "Вася");
  assertStringIncludes(line, "2026-09-10");
  assertStringIncludes(line, "Bulgaria");
});

Deno.test("formatTaskLine: без исполнителя — прочерк, а не пустота", () => {
  assertStringIncludes(formatTaskLine({ status: "open", title: "T", confirmed: true }), "—");
});

// ── add_task: где оказалась задача (issue #201) ───────────────────────────────

Deno.test("addTaskOutcome: подтверждённая задача — сказано, что она на доске, и НЕ уводит в бота", () => {
  const msg = addTaskOutcome({ id: "t1", confirmed: true });
  assertStringIncludes(msg, "на доске");
  assert(!msg.toLowerCase().includes("бот"), msg);
  assert(!msg.includes("/tasks"), msg);
});

Deno.test("addTaskOutcome: неподтверждённая — прямо сказано, что ждёт подтверждения и не видна в вебе", () => {
  const msg = addTaskOutcome({ id: "t1", confirmed: false });
  assertStringIncludes(msg.toLowerCase(), "подтверждения");
  assertStringIncludes(msg, "вебе");
});

Deno.test("addTaskOutcome: id и предупреждение резолва не теряются", () => {
  const msg = addTaskOutcome({ id: "t42", confirmed: true, warning: " ⚠️ проект не найден" });
  assertStringIncludes(msg, "t42");
  assertStringIncludes(msg, "проект не найден");
});
