import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateParent } from "./projects.ts";

const A = { id: "a", parent_id: null };          // группа-кандидат (верхний уровень)
const B = { id: "b", parent_id: null };          // обычный проект (верхний уровень)
const C = { id: "c", parent_id: "a" };           // подпроект A
const all = [A, B, C];

Deno.test("validateParent: null родитель → ok (верхний уровень)", () => {
  assertEquals(validateParent({ projectId: "b", parentId: null, all }), { ok: true });
});

Deno.test("validateParent: вложить B под верхнеуровневый A → ok", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "a", all }), { ok: true });
});

Deno.test("validateParent: родитель не существует → ошибка", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "zzz", all }).ok, false);
});

Deno.test("validateParent: родитель сам подпроект (>2 уровня) → ошибка", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "c", all }).ok, false);
});

Deno.test("validateParent: сам себе родитель → ошибка", () => {
  assertEquals(validateParent({ projectId: "a", parentId: "a", all }).ok, false);
});

Deno.test("validateParent: у проекта есть дети — нельзя делать подпроектом → ошибка", () => {
  assertEquals(validateParent({ projectId: "a", parentId: "b", all }).ok, false);
});

Deno.test("validateParent: создание (projectId=null) под верхнеуровневым → ok", () => {
  assertEquals(validateParent({ projectId: null, parentId: "a", all }), { ok: true });
});
