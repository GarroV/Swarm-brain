import { assertEquals } from "@std/assert";
import {
  dropAction,
  type GroupingProject,
  hoverMode,
  resolveDrop,
  SUBTASK_HOLD_MS,
  subtaskBlock,
} from "./sprintGrouping.ts";

// Что случится, когда задачу бросили в списке спринта. Ошибка здесь не падает: задача молча
// переезжает не в тот проект или из чужого закрытого проекта — и это видно только на доске.

const P: GroupingProject = { id: "p", parent_id: null, sprint_group: false }; // направление
const S: GroupingProject = { id: "s", parent_id: "p", sprint_group: false }; // инициатива в P
const G: GroupingProject = { id: "g", parent_id: "p", sprint_group: true }; // группа спринта в P
const T: GroupingProject = { id: "t", parent_id: null, sprint_group: true }; // группа без проекта
const ALL = [P, S, G, T];

const task = (taskId: string, projectId: string | null, isSubtask = false) => ({
  kind: "task" as const,
  taskId,
  projectId,
  isSubtask,
});

Deno.test("dropAction: на себя — ничего", () => {
  assertEquals(dropAction("a", task("a", "p"), ALL), { kind: "none" });
});

Deno.test("dropAction: на подзадачу — ничего (группа из подзадачи не собирается)", () => {
  assertEquals(dropAction("a", task("b", "p", true), ALL), { kind: "none" });
});

Deno.test("dropAction: на задачу в направлении — новая группа подпроектом направления", () => {
  assertEquals(dropAction("a", task("b", "p"), ALL), {
    kind: "create",
    parentId: "p",
    targetTaskId: "b",
  });
});

Deno.test("dropAction: на задачу без проекта — группа верхнего уровня", () => {
  assertEquals(dropAction("a", task("b", null), ALL), {
    kind: "create",
    parentId: null,
    targetTaskId: "b",
  });
});

Deno.test("dropAction: на задачу в инициативе — группа рядом с ней, в том же направлении", () => {
  // Глубже двух уровней доска не бывает: группа под инициативой была бы третьим.
  assertEquals(dropAction("a", task("b", "s"), ALL), {
    kind: "create",
    parentId: "p",
    targetTaskId: "b",
  });
});

Deno.test("dropAction: на задачу, уже лежащую в группе, — присоединиться к группе", () => {
  assertEquals(dropAction("a", task("b", "g"), ALL), {
    kind: "move",
    projectId: "g",
  });
  assertEquals(dropAction("a", task("b", "t"), ALL), {
    kind: "move",
    projectId: "t",
  });
});

Deno.test("dropAction: обе задачи уже в одной группе — ничего", () => {
  assertEquals(
    dropAction("a", task("b", "g"), ALL, { draggedProjectId: "g" }),
    { kind: "none" },
  );
});

Deno.test("dropAction: проект цели неизвестен (закрыт или не загружен) — ничего", () => {
  // Иначе задачу из чужого закрытого проекта молча вынули бы в новую группу.
  assertEquals(dropAction("a", task("b", "zzz"), ALL), { kind: "none" });
});

Deno.test("dropAction: на заголовок группы — перенос в неё", () => {
  assertEquals(
    dropAction("a", { kind: "header", projectId: "g" }, ALL),
    { kind: "move", projectId: "g" },
  );
});

Deno.test("dropAction: на «Без направления» — снять проект", () => {
  assertEquals(
    dropAction("a", { kind: "header", projectId: null }, ALL, {
      draggedProjectId: "g",
    }),
    { kind: "move", projectId: null },
  );
});

Deno.test("dropAction: на заголовок своей же группы — ничего", () => {
  assertEquals(
    dropAction("a", { kind: "header", projectId: "g" }, ALL, {
      draggedProjectId: "g",
    }),
    { kind: "none" },
  );
  assertEquals(
    dropAction("a", { kind: "header", projectId: null }, ALL),
    { kind: "none" },
  );
});

// ── Режим «подзадача» (задержка над целью) ────────────────────────────────────
// Владелец: «может быть задержать, и при этом должно показать явно что это будет подзадача».
// Время передаётся снаружи — таймер браузера тут ни при чём.

Deno.test("hoverMode: сразу и до порога — группа, после задержки — подзадача", () => {
  assertEquals(hoverMode(1000, 1000), "group");
  assertEquals(hoverMode(1000, 1000 + SUBTASK_HOLD_MS - 1), "group");
  assertEquals(hoverMode(1000, 1000 + SUBTASK_HOLD_MS), "subtask");
});

Deno.test("hoverMode: цели нет (курсор ушёл) — группа, таймер сброшен", () => {
  assertEquals(hoverMode(null, 99999), "group");
});

const dragged = (o: Partial<Parameters<typeof subtaskBlock>[0]> = {}) => ({
  taskId: "a",
  projectId: "p" as string | null,
  parentId: null as string | null,
  hasKids: false,
  ...o,
});

Deno.test("subtaskBlock: обычная задача на обычную — можно", () => {
  assertEquals(subtaskBlock(dragged(), task("b", "s")), null);
});

Deno.test("subtaskBlock: на себя, на подзадачу, со своими подзадачами — нельзя", () => {
  assertEquals(subtaskBlock(dragged(), task("a", "p")), "self");
  assertEquals(subtaskBlock(dragged(), task("b", "p", true)), "target-subtask");
  assertEquals(
    subtaskBlock(dragged({ hasKids: true }), task("b", "p")),
    "has-kids",
  );
});

Deno.test("subtaskBlock: уже подзадача этой цели — ничего делать не надо", () => {
  assertEquals(
    subtaskBlock(dragged({ parentId: "b" }), task("b", "p")),
    "already",
  );
});

Deno.test("resolveDrop: режим подзадачи — родитель и его проект", () => {
  assertEquals(resolveDrop(dragged(), task("b", "s"), "subtask", ALL), {
    kind: "subtask",
    parentTaskId: "b",
    projectId: "s",
  });
});

Deno.test("resolveDrop: подзадача невозможна — бросок ничего не делает", () => {
  assertEquals(
    resolveDrop(dragged({ hasKids: true }), task("b", "s"), "subtask", ALL),
    { kind: "none" },
  );
});

Deno.test("resolveDrop: режим группы — как dropAction, проект тащимой учитывается", () => {
  assertEquals(resolveDrop(dragged(), task("b", "p"), "group", ALL), {
    kind: "create",
    parentId: "p",
    targetTaskId: "b",
  });
  assertEquals(
    resolveDrop(dragged({ projectId: "g" }), task("b", "g"), "group", ALL),
    { kind: "none" },
  );
});

Deno.test("resolveDrop: заголовок — всегда перенос, режим не важен", () => {
  assertEquals(
    resolveDrop(dragged(), { kind: "header", projectId: "g" }, "subtask", ALL),
    { kind: "move", projectId: "g" },
  );
});
