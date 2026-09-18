// Дерево доски инициатив и цифры её шапки. Тесты вперёд: это ядро — человек читает эти числа
// как факт о работе команды, и ошибка здесь молчит (процент просто окажется другим).
//
// Правила счёта зеркалят серверные (`_shared/tasks/sprint-stats.ts`), и это намеренно: если
// шапка экрана считает иначе, чем итог принятого спринта, человек увидит два разных факта об
// одном спринте и не узнает, какой из них верен.
import { assertEquals } from "@std/assert";
import {
  buildBoard,
  checksDue,
  computeProgress,
  sprintKpi,
} from "./initiatives.ts";
import type { Project, SprintCycleItem } from "../types.ts";

function project(
  id: string,
  name: string,
  parent_id: string | null = null,
): Project {
  return { id, name, parent_id } as Project;
}

function item(
  id: string,
  project_id: string | null,
  over: Partial<SprintCycleItem> = {},
): SprintCycleItem {
  return {
    id,
    task_id: id,
    in_plan: true,
    added_at: "2026-09-01T00:00:00.000Z",
    title: id,
    status: "open",
    assignees: [],
    project_id,
    project: null,
    completed_at: null,
    due_date: null,
    frozen: false,
    check_status: null,
    check_note: null,
    check_at: null,
    check_by: null,
    to_carry: false,
    carry_reason: null,
    carry_count: 0,
    carried_manual: null,
    removed: false,
    removed_at: null,
    hidden: false,
    ...over,
  };
}

// Направление «Продукт» с двумя инициативами, отдельное направление без инициатив и задача
// вообще без проекта — все четыре случая, которые экран обязан показать.
const PROJECTS: Project[] = [
  project("dir1", "Продукт"),
  project("ini1", "Поиск", "dir1"),
  project("ini2", "Дайджест", "dir1"),
  project("dir2", "Операции"),
];

Deno.test("прогресс: процент от закрываемых, пустой набор — ноль, а не деление на ноль", () => {
  assertEquals(computeProgress([]), { total: 0, done: 0, percent: 0 });
  assertEquals(
    computeProgress([item("a", null, { status: "done" }), item("b", null)]),
    { total: 2, done: 1, percent: 50 },
  );
});

Deno.test("отменённая задача вне процента и вне знаменателя", () => {
  // Решение владельца 18.09.2026. Иначе отмена задачи улучшает отчёт: знаменатель падает,
  // процент растёт — и спринт «выполнен лучше» ровно потому, что от работы отказались.
  const progress = computeProgress([
    item("a", null, { status: "done" }),
    item("b", null),
    item("c", null, { status: "cancelled" }),
  ]);
  assertEquals(progress, { total: 2, done: 1, percent: 50 });
});

Deno.test("упоминание удалённой задачи не считается нигде", () => {
  const progress = computeProgress([
    item("a", null, { status: "done" }),
    item("gone", null, {
      removed: true,
      removed_at: "2026-09-10T00:00:00.000Z",
    }),
  ]);
  assertEquals(progress, { total: 1, done: 1, percent: 100 });
});

Deno.test("приватная чужая задача остаётся в счёте", () => {
  // Содержимое скрыто, но строка есть: убрать её из счёта значит показать разным людям разный
  // процент одного спринта — и спор о цифрах вместо разговора о работе.
  const progress = computeProgress([
    item("a", null, { status: "done" }),
    item("secret", null, {
      hidden: true,
      title: "Приватная задача",
      task_id: null,
    }),
  ]);
  assertEquals(progress, { total: 2, done: 1, percent: 50 });
});

Deno.test("дерево: направление → инициатива → задачи", () => {
  const board = buildBoard(
    [
      item("t1", "ini1"),
      item("t2", "ini2", { status: "done" }),
      item("t3", "dir1"),
    ],
    PROJECTS,
  );
  assertEquals(board.length, 1);
  assertEquals(board[0].project?.id, "dir1");
  // Задачи, лежащие прямо на направлении, идут первой строкой без инициативы — как «Общее»
  // на доске проектов; иначе они проваливаются между инициативами и теряются.
  assertEquals(board[0].initiatives.map((i) => i.project?.id ?? null), [
    null,
    "ini2",
    "ini1",
  ]);
  assertEquals(board[0].progress, { total: 3, done: 1, percent: 33 });
});

Deno.test("инициативы по алфавиту, «Без направления» — последним", () => {
  const board = buildBoard([item("t1", "ini1"), item("t2", null)], PROJECTS);
  assertEquals(board.map((d) => d.project?.name ?? null), ["Продукт", null]);
});

Deno.test("направление без задач в спринте не показывается", () => {
  // Доска спринта — про то, что в работе сейчас. Пустое направление здесь только шум;
  // полный список живёт на экране «Все инициативы».
  const board = buildBoard([item("t1", "ini1")], PROJECTS);
  assertEquals(board.map((d) => d.project?.id), ["dir1"]);
});

Deno.test("задача в неизвестном проекте не теряется", () => {
  // Проект мог быть удалён или быть приватным и не приехать в список — задача всё равно
  // обязана попасть на экран, иначе состав спринта молча уменьшается.
  const board = buildBoard([item("t1", "нет-такого")], PROJECTS);
  assertEquals(board.length, 1);
  assertEquals(board[0].project, null);
  assertEquals(board[0].initiatives[0].items.map((i) => i.id), ["t1"]);
});

Deno.test("шапка: сделано, отменённые, отметки сверки и хвосты", () => {
  const kpi = sprintKpi([
    item("a", "ini1", { status: "done", check_status: "ok" }),
    item("b", "ini1", { status: "in_progress", check_status: "risk" }),
    item("c", "ini2", {
      status: "open",
      check_status: "problem",
      to_carry: true,
    }),
    item("d", "ini2", { status: "open" }),
    item("e", null, { status: "cancelled" }),
    item("gone", null, { removed: true }),
  ]);
  assertEquals(kpi, {
    total: 4,
    done: 1,
    percent: 25,
    cancelled: 1,
    removed: 1,
    checkOk: 1,
    checkRisk: 1,
    checkProblem: 1,
    unchecked: 1,
    toCarry: 1,
    unassigned: 4,
  });
});

Deno.test("шапка: отметка у отменённой задачи не идёт в счёт сверки", () => {
  // Отменённую не проверяют — её просто не делают. Считать её отметку значит завысить
  // «по плану» и спрятать, что живых задач никто не смотрел.
  const kpi = sprintKpi([
    item("a", null, { status: "cancelled", check_status: "ok" }),
  ]);
  assertEquals(kpi.checkOk, 0);
  assertEquals(kpi.unchecked, 0);
});

Deno.test("сверка: до дня сверки молчание — норма, с этого дня — сигнал", () => {
  const today = new Date("2026-09-19T12:00:00Z");
  // Ритуал не назначен — «не отмечено» не показываем вовсе, иначе вся доска в серых метках.
  assertEquals(checksDue(null, today), false);
  assertEquals(checksDue("2026-09-20", today), false);
  // День сверки наступил — считается с его начала, а не с конца.
  assertEquals(checksDue("2026-09-19", today), true);
  assertEquals(checksDue("2026-09-18", today), true);
});

Deno.test("сверка: негодная дата не включает сигнал молча", () => {
  assertEquals(checksDue("не дата", new Date("2026-09-19T12:00:00Z")), false);
});
