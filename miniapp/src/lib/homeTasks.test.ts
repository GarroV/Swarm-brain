import { assertEquals } from "jsr:@std/assert";
import { groupHome, hiddenCount, homeDateReason, homeTeam } from "./homeTasks.ts";
import type { Task } from "../types.ts";

const NOW = new Date(2026, 8, 24, 12, 0, 0); // 24.09.2026, полдень

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: "T", assignees: [], assignee_telegram_ids: [],
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

const ru = (r: string) => r;
const ids = (ts: Task[]) => ts.map((t) => t.id);

Deno.test("groupHome: секции по стенду в порядке Просрочено → Сегодня → Дальше → Без срока", () => {
  const s = groupHome([
    task({ id: "n", due_date: null }),
    task({ id: "l", due_date: "2026-09-30" }),
    task({ id: "t", due_date: "2026-09-24" }),
    task({ id: "o", due_date: "2026-09-20" }),
  ], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [
    ["Просрочено", ["o"]], ["Сегодня", ["t"]], ["Дальше", ["l"]], ["Без срока", ["n"]],
  ]);
});

Deno.test("groupHome: «Дальше» — шесть ближайших по сроку, «Без срока» — четыре", () => {
  const later = ["2026-10-09", "2026-09-25", "2026-10-01", "2026-09-27", "2026-10-05", "2026-09-26", "2026-10-20"]
    .map((d, i) => task({ id: `l${i}`, due_date: d }));
  const nodue = [0, 1, 2, 3, 4].map((i) => task({ id: `n${i}` }));
  const s = groupHome([...later, ...nodue], NOW, 0);
  assertEquals(ids(s[0].tasks), ["l1", "l5", "l3", "l2", "l4", "l0"]);
  assertEquals(ids(s[1].tasks), ["n0", "n1", "n2", "n3"]);
  assertEquals(hiddenCount([...later, ...nodue], s, NOW), 2);
});

Deno.test("groupHome: закрытые не показываются и в «+ ещё» не считаются", () => {
  const mine = [task({ id: "d", status: "done", due_date: "2026-09-20" }), task({ id: "o", due_date: "2026-09-20" })];
  const s = groupHome(mine, NOW, 0);
  assertEquals(s.map((x) => ids(x.tasks)), [["o"]]);
  assertEquals(hiddenCount(mine, s, NOW), 0);
});

Deno.test("groupHome: пустой список — пустые секции не выводятся", () => {
  assertEquals(groupHome([], NOW, 1), []);
});

Deno.test("homeTeam: без закрытых, ближайший срок первым, без срока в конце", () => {
  const team = [task({ id: "n" }), task({ id: "d", status: "done" }), task({ id: "b", due_date: "2026-10-02" }), task({ id: "a", due_date: "2026-09-21" })];
  assertEquals(ids(homeTeam(team, NOW)), ["a", "b", "n"]);
});

// Пинг на главной (владелец 05.10.2026): «в списке дел показывались и те, у которых стоит пинг
// на сегодня… ранжирование идет по дате + по пингу. потому что дедлайн может быть хоть через год».
Deno.test("groupHome: пинг на сегодня поднимает задачу в «Сегодня», даже если срок через год", () => {
  const s = groupHome([
    task({ id: "far", due_date: "2027-09-24" }),
    task({ id: "ping", due_date: "2027-09-24", remind_date: "2026-09-24" }),
    task({ id: "pingNoDue", remind_date: "2026-09-24" }),
  ], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [["Сегодня", ["ping", "pingNoDue"]], ["Дальше", ["far"]]]);
});

Deno.test("groupHome: отзвонивший сегодня пинг задачу не убирает (reminded_at ставится в полночь)", () => {
  const s = groupHome([task({ id: "p", due_date: "2027-01-01", remind_date: "2026-09-24", reminded_at: "2026-09-23T22:00:00+00:00" })], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [["Сегодня", ["p"]]]);
});

Deno.test("groupHome: «Дальше» ранжируется по ближайшему из срока и будущего пинга", () => {
  const s = groupHome([
    task({ id: "due27", due_date: "2026-09-27" }),
    task({ id: "ping26", due_date: "2027-06-01", remind_date: "2026-09-26" }),
    task({ id: "ping30NoDue", remind_date: "2026-09-30" }),
    task({ id: "due25", due_date: "2026-09-25", remind_date: "2026-09-29" }),
  ], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [["Дальше", ["due25", "ping26", "due27", "ping30NoDue"]]]);
});

Deno.test("groupHome: прошедший пинг не делает задачу просроченной и не двигает её", () => {
  const s = groupHome([
    task({ id: "oldPing", due_date: "2026-10-10", remind_date: "2026-09-20" }),
    task({ id: "oldPingNoDue", remind_date: "2026-09-20" }),
  ], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [["Дальше", ["oldPing"]], ["Без срока", ["oldPingNoDue"]]]);
});

Deno.test("groupHome: просроченный срок остаётся в «Просрочено», даже если пинг сегодня", () => {
  const s = groupHome([task({ id: "o", due_date: "2026-09-20", remind_date: "2026-09-24" })], NOW, 0);
  assertEquals(s.map((x) => [x.label, ids(x.tasks)]), [["Просрочено", ["o"]]]);
});

Deno.test("homeDateReason: строка знает, что её подняло — пинг или срок", () => {
  assertEquals(homeDateReason(task({ id: "a", due_date: "2027-01-01", remind_date: "2026-09-24" }), NOW), { kind: "ping", date: "2026-09-24" });
  assertEquals(homeDateReason(task({ id: "b", due_date: "2026-09-25", remind_date: "2026-09-29" }), NOW), { kind: "due", date: "2026-09-25" });
  assertEquals(homeDateReason(task({ id: "c", remind_date: "2026-09-20" }), NOW), null);
});
