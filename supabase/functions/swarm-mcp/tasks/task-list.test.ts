import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { projectLabel, truncationNote, visibleProjectNameById } from "./task-list.ts";

const OWNER = 1;
const STRANGER = 2;
const rows = [
  { id: "p-open", name: "Vibe Coding", parent_id: null, created_by: OWNER, is_private: false },
  { id: "p-sub", name: "MAXIMUS", parent_id: "p-open", created_by: OWNER, is_private: false },
  { id: "p-closed", name: "Личное", parent_id: null, created_by: OWNER, is_private: true },
];

Deno.test("projectLabel: задача вне проекта подписана «без проекта»", () => {
  assertEquals(projectLabel(null, new Map()), "без проекта");
});

Deno.test("projectLabel: видимый проект и подпроект — по имени", () => {
  const names = visibleProjectNameById(rows, STRANGER);
  assertEquals(projectLabel("p-sub", names), "MAXIMUS");
});

Deno.test("projectLabel: чужой закрытый проект имени не выдаёт", () => {
  const names = visibleProjectNameById(rows, STRANGER);
  assertEquals(projectLabel("p-closed", names), null);
  assertEquals(projectLabel("p-closed", visibleProjectNameById(rows, OWNER)), "Личное");
});

Deno.test("truncationNote: полная выдача без пометки", () => {
  assertEquals(truncationNote(9, 9, 30), null);
});

Deno.test("truncationNote: усечённая выдача говорит «N из M»", () => {
  assertStringIncludes(truncationNote(30, 57, 30) ?? "", "30 из 57");
});

Deno.test("truncationNote: неизвестный итог при полной выдаче — предупреждение, при неполной — тишина", () => {
  assertStringIncludes(truncationNote(30, null, 30) ?? "", "неизвестно");
  assertEquals(truncationNote(4, null, 30), null);
});
