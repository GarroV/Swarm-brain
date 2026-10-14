// Ось «статус» на экране задач (issue #216) — независимый фильтр поверх оси времени.
// Решения владельца 03.09.2026:
//   • статусы «Открыто / В процессе / Готово» накладываются НА «Сегодня/Ближайшие/Все»;
//   • `backlog` был замьючен («спринты не используются, нет смысла туда смотреть») —
//     МЬЮТ СНЯТ 21.09.2026: «задачи все и всегда должны быть в разделе задач. он для этого
//     и нужен чтобы там отслеживать вообще все» (issue #440);
//   • `pending` убран из мьюта 05.09.2026 вместе с самим статусом — «пендинг вообще
//     убираем, не понимаю смысла» (#208, трубы, писавшие его, удалены);
//   • ось времени для ЗАКРЫТЫХ задач считается по дате закрытия («Сегодня + Готово» =
//     «что я закрыл сегодня»), для остальных — по сроку.
import { assertEquals } from "jsr:@std/assert";
import {
  statusBucket, filterTasks, countLists, matchesList, inPeriodOrOverdue, filterByLabel, countByLabel, DEFAULT_STATUSES,
  type StatusFilter, type SmartListId,
} from "./smartLists.ts";
import { presetRange, customRange } from "./dateRange.ts";
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
    meeting_id: null, created_by_name: null,
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

Deno.test("statusBucket: backlog виден как «Открыто» — мьют снят 21.09.2026", () => {
  // Карточка колонки «Бэклог задач» — обычная задача: «идея это тоже задача, не надо
  // плодить сущности». Замьюченная, она выпадала из списков, поиска и счётчиков (#440).
  assertEquals(statusBucket(task({ id: "b", status: "backlog" })), "open");
});

Deno.test("statusBucket: pending больше не мьютится — статус убран целиком 05.09.2026", () => {
  // Раз его никто не пишет, прятать нечего. А если появится — пусть будет виден, как любой
  // незнакомый статус: молча скрытая задача и была причиной #208.
  assertEquals(statusBucket(task({ id: "a", status: "pending" })), "open");
});

Deno.test("statusBucket: НЕЗНАКОМЫЙ статус попадает в «Открыто», а не пропадает", () => {
  // Страховка от второго #208: статус, появившийся в базе завтра, должен быть виден.
  assertEquals(statusBucket(task({ id: "a", status: "whatever" })), "open");
});

Deno.test("«Все» показывает ВСЕ задачи, включая backlog (решение владельца 21.09.2026)", () => {
  const tasks = [
    task({ id: "open", status: "open" }),
    task({ id: "back", status: "backlog" }),
  ];
  assertEquals(filter(tasks, "all", set("open", "in_progress", "done")).sort(), ["back", "open"]);
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

Deno.test("пустой набор чипов = без фильтра по статусу", () => {
  const tasks = [
    task({ id: "o", status: "open" }),
    task({ id: "d", status: "done" }),
    task({ id: "back", status: "backlog" }),
  ];
  assertEquals(filter(tasks, "all", set()).sort(), ["back", "d", "o"]);
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
    task({ id: "back", status: "backlog", due_date: "2026-09-03" }),
  ];
  // `back` считается наравне с `o`: backlog — это «Открыто» с 21.09.2026.
  const onlyOpen = countLists(tasks, "mine", ME, NOW, null, set("open"));
  assertEquals(onlyOpen.today, 2);
  assertEquals(onlyOpen.all, 2);
  const openAndProgress = countLists(tasks, "mine", ME, NOW, null, set("open", "in_progress"));
  assertEquals(openAndProgress.today, 3);
  // Счётчик обязан совпадать со списком: скрытая задача, не попавшая в цифру, и была #440.
  const everything = countLists(tasks, "mine", ME, NOW, null, set("open", "in_progress", "done"));
  assertEquals(everything.all, 4);
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

// ── Дата закрытия: completed_at, а не updated_at (issue #268) ────────────────
// updated_at в списочном ответе не приходит вовсе (выброшен из TASK_LIST_COLUMNS), поэтому
// расчёт молча падал на created_at: «Сегодня + Готово» показывал СОЗДАННЫЕ сегодня. Кейса
// «создана давно, закрыта сегодня» в тестах не было — потому дефект и дожил до сентября.

Deno.test("«Сегодня + Готово»: задача, созданная давно и закрытая сегодня, попадает в список", () => {
  const t = task({
    id: "old-created-closed-today",
    status: "done",
    created_at: "2026-08-20T09:00:00+00:00",
    completed_at: "2026-09-03T09:30:00+00:00",
  });
  assertEquals(matchesList(t, "today", NOW, null, set("done")), true);
});

Deno.test("«Сегодня + Готово»: закрытая на прошлой неделе задача сегодня не показывается", () => {
  const t = task({
    id: "closed-last-week",
    status: "done",
    created_at: "2026-09-03T08:00:00+00:00", // создана сегодня — прежний расчёт втащил бы её
    completed_at: "2026-08-27T15:00:00+00:00",
  });
  assertEquals(matchesList(t, "today", NOW, null, set("done")), false);
});

// ── Период и просрочка (issue #902, владелец 12.10.2026) ────────────────────────────────────
// Период, содержащий сегодня, не прячет открытую просрочку со сроком ДО его начала.
const MONDAY = new Date(2026, 8, 7, 12, 0, 0); // понедельник 07.09.2026: «Эта неделя» = 07–13.09
const THIS_WEEK = presetRange("week", MONDAY);
const overdueOpen = task({ id: "od", due_date: "2026-09-03" });

Deno.test("период: в понедельник «Эта неделя» оставляет открытую просрочку (в «Сегодня»)", () => {
  assertEquals(inPeriodOrOverdue(overdueOpen, THIS_WEEK, MONDAY), true);
  assertEquals(ids(filterTasks([overdueOpen], "today", "mine", ME, MONDAY, THIS_WEEK, DEFAULT_STATUSES)), ["od"]);
  assertEquals(countLists([overdueOpen], "mine", ME, MONDAY, THIS_WEEK, DEFAULT_STATUSES).today, 1);
});

Deno.test("период: закрытая просрочка вне периода не показывается", () => {
  const done = task({ id: "d", status: "done", due_date: "2026-09-03", completed_at: "2026-09-04T10:00:00+00:00" });
  assertEquals(inPeriodOrOverdue(done, THIS_WEEK, MONDAY), false);
});

Deno.test("период: прошлая неделя НЕ добавляет просрочку со срока до неё", () => {
  const lastWeek = presetRange("prev_week", MONDAY); // 31.08–06.09
  const before = task({ id: "b", due_date: "2026-08-20" });
  assertEquals(inPeriodOrOverdue(before, lastWeek, MONDAY), false);
  // а своя дата внутри прошлой недели — по-прежнему в периоде
  assertEquals(inPeriodOrOverdue(overdueOpen, lastWeek, MONDAY), true);
});

Deno.test("период: будущий период не добавляет просрочку", () => {
  const future = customRange("2026-09-20", "2026-09-27");
  assertEquals(inPeriodOrOverdue(overdueOpen, future, MONDAY), false);
});

Deno.test("период: произвольный диапазон, содержащий сегодня, добавляет просрочку", () => {
  const custom = customRange("2026-09-05", "2026-09-20");
  assertEquals(inPeriodOrOverdue(overdueOpen, custom, MONDAY), true);
});

Deno.test("период: «Этот месяц» тоже добавляет просрочку из прошлого месяца", () => {
  const month = presetRange("month", MONDAY);
  assertEquals(inPeriodOrOverdue(task({ id: "m", due_date: "2026-08-15" }), month, MONDAY), true);
});

Deno.test("период: задача без срока в период не попадает (как раньше)", () => {
  assertEquals(inPeriodOrOverdue(task({ id: "nd" }), THIS_WEEK, MONDAY), false);
});

Deno.test("период: без периода всё видно; просрочка не нарушает ось «Ближайшие»", () => {
  assertEquals(inPeriodOrOverdue(overdueOpen, null, MONDAY), true);
  assertEquals(ids(filterTasks([overdueOpen], "upcoming", "mine", ME, MONDAY, THIS_WEEK, DEFAULT_STATUSES)), []);
});

Deno.test("период: смарт-метка тоже держит просрочку под «Эта неделя»", () => {
  const t = task({ id: "l", due_date: "2026-09-03", label_ids: ["L1"] });
  assertEquals(ids(filterByLabel([t], "L1", THIS_WEEK, MONDAY)), ["l"]);
  assertEquals(countByLabel([t], "L1", THIS_WEEK, MONDAY), 1);
  assertEquals(countByLabel([t], "L1", presetRange("prev_week", MONDAY), MONDAY), 1); // своя дата в прошлой неделе
  assertEquals(countByLabel([task({ id: "x", due_date: "2026-08-20", label_ids: ["L1"] })], "L1", presetRange("prev_week", MONDAY), MONDAY), 0);
});
