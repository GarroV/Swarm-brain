import { assertEquals } from "@std/assert";
import {
  dissolvePlan,
  dissolveTargets,
  parentForSprintGroup,
  type ProjectMove,
  withoutSprintGroups,
} from "./sprint-groups.ts";

// Группа спринта — запись в projects, которая не должна всплывать ни на доске «Проекты», ни в
// селекторе карточки, ни в хабе, пока её не пробросили. Ошибка здесь не падает: чужая (или
// просто временная) группа молча появляется у всей команды на доске проектов.

type Row = { id: string; parent_id: string | null; sprint_group: boolean };
const P: Row = { id: "p", parent_id: null, sprint_group: false }; // обычный проект
const S: Row = { id: "s", parent_id: "p", sprint_group: false }; // обычный подпроект
const G: Row = { id: "g", parent_id: "p", sprint_group: true }; // группа спринта в P
const T: Row = { id: "t", parent_id: null, sprint_group: true }; // группа спринта без проекта
const K: Row = { id: "k", parent_id: "t", sprint_group: false }; // ребёнок группы (легаси/руками)

Deno.test("withoutSprintGroups: обычные проекты и подпроекты остаются", () => {
  assertEquals(withoutSprintGroups([P, S]).map((r) => r.id), ["p", "s"]);
});

Deno.test("withoutSprintGroups: группы спринта не попадают в выборку доски", () => {
  assertEquals(withoutSprintGroups([P, S, G, T]).map((r) => r.id), ["p", "s"]);
});

Deno.test("withoutSprintGroups: ребёнок скрытой группы тоже скрыт — иначе сирота на доске", () => {
  assertEquals(withoutSprintGroups([P, T, K]).map((r) => r.id), ["p"]);
});

Deno.test("withoutSprintGroups: после «В проекты» (флаг снят) группа видна", () => {
  const promoted = { ...G, sprint_group: false };
  assertEquals(withoutSprintGroups([P, promoted]).map((r) => r.id), [
    "p",
    "g",
  ]);
});

Deno.test("withoutSprintGroups: строки без флага (старый ответ) считаются обычными", () => {
  const legacy = { id: "l", parent_id: null } as unknown as Row;
  assertEquals(withoutSprintGroups([legacy]).map((r) => r.id), ["l"]);
});

Deno.test("parentForSprintGroup: без родителя — можно", () => {
  assertEquals(parentForSprintGroup(null, [P]), null);
});

Deno.test("parentForSprintGroup: обычный проект верхнего уровня — можно", () => {
  assertEquals(parentForSprintGroup("p", [P, S]), null);
});

Deno.test("parentForSprintGroup: группа спринта родителем быть не может", () => {
  assertEquals(typeof parentForSprintGroup("t", [P, T]), "string");
});

Deno.test("parentForSprintGroup: неизвестный родитель — отказ", () => {
  assertEquals(typeof parentForSprintGroup("zzz", [P]), "string");
});

Deno.test("dissolvePlan: группа спринта распускается в своего родителя", () => {
  assertEquals(dissolvePlan(G), { ok: true, moveTasksTo: "p" });
  assertEquals(dissolvePlan(T), { ok: true, moveTasksTo: null });
});

Deno.test("dissolvePlan: обычный проект так не распускается", () => {
  assertEquals(dissolvePlan(P).ok, false);
  assertEquals(dissolvePlan(S).ok, false);
});

// «Распустить» — «задачи возвращаются, куда были». Ошибка здесь тоже молчит: задача оказывается
// в соседнем проекте, и никто не замечает, откуда она туда переехала.
const move = (task_id: string, old_value: string | null, new_value: string | null, at: string): ProjectMove => ({
  task_id,
  old_value,
  new_value,
  created_at: `2026-10-01T10:00:${at}Z`,
});

Deno.test("dissolveTargets: задача возвращается в проект, из которого пришла", () => {
  const out = dissolveTargets({
    groupId: "g",
    fallback: "p",
    tasks: [{ id: "a", parent_id: null }, { id: "b", parent_id: null }],
    moves: [move("a", "x", "g", "01"), move("b", null, "g", "02")],
    liveProjectIds: new Set(["p", "x"]),
  });
  assertEquals(out.get("a"), "x");
  assertEquals(out.get("b"), null);
});

Deno.test("dissolveTargets: важен последний переход в группу, а не первый", () => {
  const out = dissolveTargets({
    groupId: "g",
    fallback: "p",
    tasks: [{ id: "a", parent_id: null }],
    moves: [move("a", "x", "g", "01"), move("a", "g", "y", "02"), move("a", "y", "g", "03")],
    liveProjectIds: new Set(["p", "x", "y"]),
  });
  assertEquals(out.get("a"), "y");
});

Deno.test("dissolveTargets: без журнала или в архивный проект — туда, где висела группа", () => {
  const out = dissolveTargets({
    groupId: "g",
    fallback: "p",
    tasks: [{ id: "a", parent_id: null }, { id: "b", parent_id: null }],
    moves: [move("b", "dead", "g", "01"), move("a", "x", "other", "02")],
    liveProjectIds: new Set(["p", "x"]),
  });
  assertEquals(out.get("a"), "p");
  assertEquals(out.get("b"), "p");
});

Deno.test("dissolveTargets: подзадача едет за родителем, если он распускается с ней", () => {
  const out = dissolveTargets({
    groupId: "g",
    fallback: null,
    tasks: [{ id: "parent", parent_id: null }, { id: "kid", parent_id: "parent" }, {
      id: "lone",
      parent_id: "elsewhere",
    }],
    moves: [move("parent", "x", "g", "01"), move("kid", "y", "g", "02"), move("lone", "y", "g", "03")],
    liveProjectIds: new Set(["x", "y"]),
  });
  assertEquals(out.get("kid"), "x");
  assertEquals(out.get("lone"), "y");
});
