import { assertEquals } from "@std/assert";
import { dissolvePlan, parentForSprintGroup, withoutSprintGroups } from "./sprint-groups.ts";

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
