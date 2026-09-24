import { assertEquals } from "jsr:@std/assert";
import { closedThisWeek, groupHome, hiddenCount, homeNews, homeTeam } from "./homeTasks.ts";
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

Deno.test("closedThisWeek: только done с completed_at за последние 7 дней", () => {
  const ts = [
    task({ id: "in", status: "done", completed_at: "2026-09-20T10:00:00Z" }),
    task({ id: "old", status: "done", completed_at: "2026-09-10T10:00:00Z" }),
    task({ id: "noat", status: "done", completed_at: null }),
    task({ id: "open", status: "open", completed_at: "2026-09-23T10:00:00Z" }),
  ];
  assertEquals(closedThisWeek(ts, NOW), 1);
});

Deno.test("homeNews: пять строк, у каждой число; цвет — требует ли действия", () => {
  const n = homeNews({ overdue: 2, pendingReview: 0, meetingsToday: 3, agentProposals: 1, closedWeek: 4 }, ru);
  assertEquals(n.map((x) => [x.text, x.kind]), [
    ["Просрочено задач: 2", "bad"],
    ["Ждут вычитки встреч: 0", "ok"],
    ["Встреч сегодня: 3", "ok"],
    ["Предложений агента: 1", "warn"],
    ["Закрыто задач за неделю: 4", "ok"],
  ]);
});

Deno.test("homeNews: нет просрочки — «Просроченного нет»; календарь не ответил — строки про встречи нет", () => {
  const n = homeNews({ overdue: 0, pendingReview: 1, meetingsToday: null, agentProposals: 0, closedWeek: 0 }, ru);
  assertEquals(n[0], { text: "Просроченного нет", kind: "ok", target: "tasks" });
  assertEquals(n.some((x) => x.text.startsWith("Встреч сегодня")), false);
  assertEquals(n.length, 4);
});
