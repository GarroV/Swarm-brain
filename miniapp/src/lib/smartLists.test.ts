// Ось «статус» на экране задач (issue #216) — независимый фильтр поверх оси времени.
// Решения владельца 03.09.2026:
//   • статусы «Открыто / В процессе / Готово» накладываются НА «Сегодня/Ближайшие/Все»;
//   • `pending` и `backlog` замьючены («спринты не используются, нет смысла туда смотреть»);
//   • ось времени для ЗАКРЫТЫХ задач считается по дате закрытия («Сегодня + Готово» =
//     «что я закрыл сегодня»), для остальных — по сроку.
import { assertEquals } from "jsr:@std/assert";
import {
  statusBucket, filterTasks, countLists, matchesList, DEFAULT_STATUSES,
  type StatusFilter, type SmartListId,
} from "./smartLists.ts";
import type { Task, Me } from "../types.ts";

const ME: Me = { telegram_id: 1, name: "Me", username: "me", is_admin: false } as Me;
const NOW = new Date(2026, 8, 3, 12, 0, 0); // 03.09.2026, полдень

// Минимальная задача: назначена на меня (линза «mine»), без метки, статус и даты — параметром.
function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: "T", assignees: ["Me"], assignee_telegram_ids: [1],
    due_date: null, remind_date: null, reminded_at: null,
    country: null, priority: null, status: "open",
    created_at: "2026-09-01T10:00:00+00:00", updated_at: null,
    meeting_id: null, created_by_name: null, is_private: false,
    start_date: null, sprint_id: null, label_ids: [], project_id: null,
    project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    recur_freq: null, recur_anchor_dom: null,
    ...over,
  } as Task;
}

const set = (...ids: StatusFilter[]): ReadonlySet<StatusFilter> => new Set(ids);
const ids = (tasks: Task[]) => tasks.map((t) => t.id);
const filter = (tasks: Task[], list: SmartListId, statuses: ReadonlySet<StatusFilter>) =>
  ids(filterTasks(tasks, list, "mine", ME, NOW, null, statuses));

Deno.test("statusBucket: open, in_progress и легаси progress раскладываются по своим чипам", () => {
  assertEquals(statusBucket(task({ id: "a", status: "open" })), "open");
  assertEquals(statusBucket(task({ id: "b", status: "in_progress" })), "in_progress");
  assertEquals(statusBucket(task({ id: "c", status: "progress" })), "in_progress");
});

Deno.test("statusBucket: cancelled считается закрытой вместе с done", () => {
  assertEquals(statusBucket(task({ id: "a", status: "done" })), "done");
  // Иначе отменённые исчезли бы: в боте для них есть кнопка «Переоткрыть», значит они живые.
  assertEquals(statusBucket(task({ id: "b", status: "cancelled" })), "done");
});

Deno.test("statusBucket: pending и backlog замьючены (решение владельца 03.09.2026)", () => {
  assertEquals(statusBucket(task({ id: "a", status: "pending" })), null);
  assertEquals(statusBucket(task({ id: "b", status: "backlog" })), null);
});

Deno.test("statusBucket: НЕЗНАКОМЫЙ статус попадает в «Открыто», а не пропадает", () => {
  // Страховка от второго #208: статус, появившийся в базе завтра, должен быть виден.
  assertEquals(statusBucket(task({ id: "a", status: "whatever" })), "open");
});

Deno.test("замьюченные задачи не показываются даже в «Все» со всеми чипами", () => {
  const tasks = [
    task({ id: "open", status: "open" }),
    task({ id: "pend", status: "pending" }),
    task({ id: "back", status: "backlog" }),
  ];
  assertEquals(filter(tasks, "all", set("open", "in_progress", "done")), ["open"]);
});

Deno.test("чипы фильтруют внутри выбранного списка", () => {
  const tasks = [
    task({ id: "o", status: "open", due_date: "2026-09-03" }),
    task({ id: "p", status: "in_progress", due_date: "2026-09-03" }),
    task({ id: "d", status: "done", updated_at: "2026-09-03T09:00:00+00:00" }),
  ];
  assertEquals(filter(tasks, "all", set("open")), ["o"]);
  assertEquals(filter(tasks, "all", set("in_progress")), ["p"]);
  assertEquals(filter(tasks, "all", set("open", "in_progress")).sort(), ["o", "p"]);
});

Deno.test("пустой набор чипов = без фильтра по статусу (кроме замьюченных)", () => {
  const tasks = [
    task({ id: "o", status: "open" }),
    task({ id: "d", status: "done" }),
    task({ id: "pend", status: "pending" }),
  ];
  assertEquals(filter(tasks, "all", set()).sort(), ["d", "o"]);
});

Deno.test("дефолт — «Открыто» + «В процессе»: закрытые не показываются", () => {
  const tasks = [task({ id: "o", status: "open" }), task({ id: "d", status: "done" })];
  assertEquals(ids(filterTasks(tasks, "all", "mine", ME, NOW, null, DEFAULT_STATUSES)), ["o"]);
});

Deno.test("«Сегодня» + «Готово» = закрытые СЕГОДНЯ (ось времени по дате закрытия)", () => {
  const tasks = [
    task({ id: "today", status: "done", updated_at: "2026-09-03T08:30:00+00:00" }),
    task({ id: "yesterday", status: "done", updated_at: "2026-09-02T18:00:00+00:00" }),
  ];
  assertEquals(filter(tasks, "today", set("done")), ["today"]);
});

Deno.test("«Ближайшие» + только «Готово» — пусто: закрытых в будущем не бывает", () => {
  const tasks = [
    task({ id: "d", status: "done", due_date: "2026-09-10", updated_at: "2026-09-03T08:00:00+00:00" }),
  ];
  assertEquals(filter(tasks, "upcoming", set("done")), []);
});

Deno.test("«Сегодня» + «Открыто» — просроченное остаётся видимым", () => {
  const tasks = [
    task({ id: "overdue", status: "open", due_date: "2026-08-28" }),
    task({ id: "today", status: "open", due_date: "2026-09-03" }),
    task({ id: "later", status: "open", due_date: "2026-09-10" }),
  ];
  assertEquals(filter(tasks, "today", set("open")), ["overdue", "today"]);
});

Deno.test("только «Готово» сортируется по дате закрытия, свежие сверху", () => {
  const tasks = [
    task({ id: "old", status: "done", updated_at: "2026-09-03T08:00:00+00:00" }),
    task({ id: "fresh", status: "done", updated_at: "2026-09-03T11:00:00+00:00" }),
  ];
  assertEquals(filter(tasks, "all", set("done")), ["fresh", "old"]);
});

Deno.test("период для закрытых считается по дате закрытия, для открытых — по сроку", () => {
  const range = { preset: "custom" as const, from: "2026-09-03", to: "2026-09-03" };
  const tasks = [
    task({ id: "closed-today", status: "done", due_date: "2026-07-01", updated_at: "2026-09-03T09:00:00+00:00" }),
    task({ id: "due-today", status: "open", due_date: "2026-09-03" }),
    task({ id: "due-later", status: "open", due_date: "2026-09-20" }),
  ];
  const got = ids(filterTasks(tasks, "all", "mine", ME, NOW, range, set("open", "done")));
  assertEquals(got.sort(), ["closed-today", "due-today"]);
});

Deno.test("счётчики списков считаются с учётом включённых чипов", () => {
  const tasks = [
    task({ id: "o", status: "open", due_date: "2026-09-03" }),
    task({ id: "p", status: "in_progress", due_date: "2026-09-03" }),
    task({ id: "d", status: "done", updated_at: "2026-09-03T09:00:00+00:00" }),
    task({ id: "pend", status: "pending", due_date: "2026-09-03" }),
  ];
  const onlyOpen = countLists(tasks, "mine", ME, NOW, null, set("open"));
  assertEquals(onlyOpen.today, 1);
  assertEquals(onlyOpen.all, 1);
  const openAndProgress = countLists(tasks, "mine", ME, NOW, null, set("open", "in_progress"));
  assertEquals(openAndProgress.today, 2);
  // Замьюченная не попадает ни в один счётчик — иначе цифра обещает задачу, которой не видно.
  const everything = countLists(tasks, "mine", ME, NOW, null, set("open", "in_progress", "done"));
  assertEquals(everything.all, 3);
});

Deno.test("«Готовые» больше НЕ смарт-список: в оси времени остались Сегодня/Ближайшие/Все/Регулярные", async () => {
  const { SMART_LISTS } = await import("./smartLists.ts");
  assertEquals(SMART_LISTS.map((l) => l.id), ["today", "upcoming", "all", "recurring"]);
});

Deno.test("matchesList учитывает статус: задача «в работе» при выключенном чипе не считается видимой", () => {
  const t = task({ id: "p", status: "in_progress", due_date: "2026-09-03" });
  assertEquals(matchesList(t, "today", NOW, null, set("open")), false);
  assertEquals(matchesList(t, "today", NOW, null, set("open", "in_progress")), true);
});
