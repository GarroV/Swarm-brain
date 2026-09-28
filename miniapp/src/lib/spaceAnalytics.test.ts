// Аналитика пространства: семь таблиц эталона. Тесты вперёд — это ядро по всем признакам:
// человек читает эти числа как факт о работе команды, а ошибка здесь молчит. Неверный
// процент выглядит ровно так же, как верный, и спорить с ним никто не станет.
import { assertEquals } from "@std/assert";
import { buildSpaceReport, spaceReportMarkdown } from "./spaceAnalytics.ts";
import type {
  Project,
  SprintCycle,
  SprintCycleDetail,
  SprintCycleItem,
  Task,
} from "../types.ts";

const TODAY = new Date("2026-09-19T12:00:00");

function project(
  id: string,
  name: string,
  over: Partial<Project> = {},
): Project {
  return { id, name, parent_id: null, sprint_id: "tab1", ...over } as Project;
}

function item(over: Partial<SprintCycleItem> = {}): SprintCycleItem {
  return {
    id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    in_plan: true,
    added_at: "2026-09-01",
    title: "Задача",
    status: "open",
    assignees: [],
    project_id: null,
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

function cycle(over: Partial<SprintCycle> = {}): SprintCycle {
  return {
    id: "c1",
    group_id: "g",
    name: "Спринт 1",
    start_date: "2026-09-01",
    end_date: "2026-09-14",
    tab_id: "tab1",
    check_date: "2026-09-07",
    status: "accepted",
    created_by: null,
    started_at: null,
    accepted_at: "2026-09-14",
    accepted_by: null,
    summary: null,
    stats: null,
    created_at: "2026-09-01",
    ...over,
  };
}

function detail(
  items: SprintCycleItem[],
  over: Partial<SprintCycle> = {},
): SprintCycleDetail {
  return {
    ...cycle({ id: "cur", name: "Спринт 2", status: "active", ...over }),
    items,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Задача",
    status: "open",
    assignees: [],
    due_date: null,
    project_id: null,
    ...over,
  } as Task;
}

const EMPTY = {
  cycles: [],
  current: null,
  projects: [],
  tasks: [],
  today: TODAY,
};

Deno.test("пустое пространство: семь таблиц есть, все пустые", () => {
  const r = buildSpaceReport(EMPTY);
  assertEquals(r.history, []);
  assertEquals(r.risks, []);
  assertEquals(r.carries, []);
  assertEquals(r.initiatives, []);
  assertEquals(r.people, []);
  assertEquals(r.overdue, []);
  assertEquals(r.current, null);
});

Deno.test("история спринтов: свежие сверху, проценты из сохранённых итогов", () => {
  const stats = {
    plan: 4,
    planDone: 2,
    planPercent: 50,
    extra: 1,
    extraDone: 0,
    carried: 2,
    carried_manual: 1,
    carried_auto: 1,
    cancelled: 1,
    removed: 0,
    check_ok: 0,
    check_risk: 0,
    check_problem: 0,
    unassigned: 0,
    byPerson: [],
    byProject: [],
    byDay: [],
  };
  const r = buildSpaceReport({
    ...EMPTY,
    cycles: [
      cycle({ id: "old", name: "Спринт 1", start_date: "2026-09-01", stats }),
      cycle({ id: "new", name: "Спринт 2", start_date: "2026-09-15", stats }),
    ],
  });
  assertEquals(r.history.map((h) => h.name), ["Спринт 2", "Спринт 1"]);
  assertEquals(r.history[0].percent, 50);
  assertEquals(r.history[0].carried, 2);
  assertEquals(r.history[0].cancelled, 1);
  // Незакрытый спринт итогов ещё не имеет — его в историю не берём: там было бы враньё.
  const live = buildSpaceReport({
    ...EMPTY,
    cycles: [cycle({ status: "active", stats: null })],
  });
  assertEquals(live.history, []);
});

Deno.test("риски: только отметки риска и проблемы, с автором и комментарием", () => {
  const r = buildSpaceReport({
    ...EMPTY,
    current: detail([
      item({
        title: "А",
        check_status: "risk",
        check_note: "ждём партнёра",
        assignees: ["Вася"],
      }),
      item({ title: "Б", check_status: "problem", assignees: ["Петя"] }),
      item({ title: "В", check_status: "ok" }),
      item({ title: "Г" }),
    ]),
  });
  assertEquals(r.risks.map((x) => x.title), ["Б", "А"]);
  assertEquals(r.risks[1].note, "ждём партнёра");
  assertEquals(r.risks[1].person, "Вася");
  // Проблема выше риска: читают сверху вниз, и сначала должно идти то, что горит.
  assertEquals(r.risks[0].status, "problem");
});

Deno.test("причины переносов: сколько раз переносилась — колонка (D012)", () => {
  const r = buildSpaceReport({
    ...EMPTY,
    current: detail([
      item({ title: "Долгая", carry_count: 3, carry_reason: "нет данных" }),
      item({ title: "Свежая", carry_count: 1 }),
      item({ title: "Не переносилась", carry_count: 0 }),
    ]),
  });
  assertEquals(r.carries.map((c) => [c.title, c.count]), [["Долгая", 3], [
    "Свежая",
    1,
  ]]);
  assertEquals(r.carries[0].reason, "нет данных");
});

Deno.test("по людям: отменённые вне процента, у задачи несколько исполнителей — считаем каждому", () => {
  const r = buildSpaceReport({
    ...EMPTY,
    current: detail([
      item({ status: "done", assignees: ["Вася"] }),
      item({ status: "open", assignees: ["Вася"], check_status: "risk" }),
      item({ status: "cancelled", assignees: ["Вася"] }),
      item({ status: "open", assignees: ["Вася", "Петя"] }),
      item({ status: "open" }),
    ]),
  });
  const vasya = r.people.find((p) => p.person === "Вася")!;
  assertEquals([vasya.total, vasya.done, vasya.percent], [3, 1, 33]);
  assertEquals(vasya.risk, 1);
  assertEquals(r.people.find((p) => p.person === "Петя")!.total, 1);
  // «Без исполнителя» — строка есть, и она последняя: это дыра в планировании, а не человек.
  assertEquals(r.people[r.people.length - 1].person, null);
});

Deno.test("просрочка: незакрытые с прошедшим сроком, свежие сверху", () => {
  const r = buildSpaceReport({
    ...EMPTY,
    projects: [project("p1", "Направление")],
    tasks: [
      task({ title: "Вчера", due_date: "2026-09-18", project_id: "p1" }),
      task({ title: "Неделю назад", due_date: "2026-09-12", project_id: "p1" }),
      task({ title: "Завтра", due_date: "2026-09-20", project_id: "p1" }),
      task({
        title: "Сделана",
        due_date: "2026-09-01",
        status: "done",
        project_id: "p1",
      }),
      task({
        title: "Отменена",
        due_date: "2026-09-01",
        status: "cancelled",
        project_id: "p1",
      }),
    ],
  });
  assertEquals(r.overdue.map((o) => o.title), ["Неделю назад", "Вчера"]);
  assertEquals(r.overdue[0].daysLate, 7);
  assertEquals(r.overdue[0].project, "Направление");
});

Deno.test("по инициативам: процент и просрочка инициативы", () => {
  const r = buildSpaceReport({
    ...EMPTY,
    projects: [
      project("dir", "Направление"),
      project("ini", "Инициатива", {
        parent_id: "dir",
        sprint_id: null,
        end_date: "2026-09-10",
      }),
    ],
    tasks: [
      task({ status: "done", project_id: "ini" }),
      task({ status: "open", project_id: "ini" }),
      task({ status: "cancelled", project_id: "ini" }),
    ],
  });
  const row = r.initiatives.find((i) => i.initiative === "Инициатива")!;
  assertEquals([row.total, row.done, row.percent], [2, 1, 50]);
  assertEquals(row.direction, "Направление");
  // Срок прошёл, а работа не закрыта — инициатива просрочена.
  assertEquals(row.overdue, true);
});

Deno.test("markdown: заголовки таблиц на месте, пустые секции не печатаются", () => {
  const md = spaceReportMarkdown(
    buildSpaceReport({
      ...EMPTY,
      current: detail([
        item({ title: "А", check_status: "problem", assignees: ["Вася"] }),
      ]),
    }),
    "Пространство",
  );
  assertEquals(md.includes("# Пространство"), true);
  assertEquals(md.includes("## Риски"), true);
  assertEquals(md.includes("| А |"), true);
  // Пустых таблиц в выгрузке нет: их некуда читать, а место они занимают.
  assertEquals(md.includes("## Просрочка"), false);
});
