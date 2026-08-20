import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canViewProject, isProjectPrivate, pickProjectByName, type ProjectNameRow } from "./project-access.ts";

const ANNA = 111;
const BOB = 222;
const ADMIN = 744230399;

const publicTop = { parent_id: null, created_by: BOB, is_private: false };
const privateTop = { parent_id: null, created_by: BOB, is_private: true };
const subproject = { parent_id: "top", created_by: BOB, is_private: false };
const legacy = { parent_id: null, created_by: null, is_private: true };

Deno.test("isProjectPrivate: приватность даёт и подпроект, и тумблер", () => {
  assertEquals(isProjectPrivate(publicTop), false);
  assertEquals(isProjectPrivate(privateTop), true);
  assertEquals(isProjectPrivate(subproject), true);
});

Deno.test("canViewProject: публичный проект верхнего уровня видит весь воркспейс", () => {
  assertEquals(canViewProject(publicTop, ANNA), true);
  assertEquals(canViewProject(publicTop, undefined), true);
});

Deno.test("canViewProject: чужой приватный проект не видит никто, кроме автора и админа", () => {
  assertEquals(canViewProject(privateTop, ANNA), false);
  assertEquals(canViewProject(privateTop, BOB), true);
  assertEquals(canViewProject(privateTop, ANNA, true), true);
});

Deno.test("canViewProject: чужой подпроект скрыт так же, как приватный проект", () => {
  assertEquals(canViewProject(subproject, ANNA), false);
  assertEquals(canViewProject(subproject, BOB), true);
});

Deno.test("canViewProject: без личности зрителя приватное закрыто (fail-closed)", () => {
  assertEquals(canViewProject(privateTop, undefined), false);
  assertEquals(canViewProject(subproject, undefined), false);
});

Deno.test("canViewProject: легаси-строка без created_by остаётся общей", () => {
  assertEquals(canViewProject(legacy, ANNA), true);
});

// ── Резолв имени в id через MCP (issue #37) ────────────────────────────────────
// Чужое приватное РЕАЛЬНО лежит в данных — отказ сверяем с «как будто его нет».

const rows: ProjectNameRow[] = [
  { id: "pub", name: "Launch RS", parent_id: null, created_by: BOB, is_private: false },
  { id: "secret", name: "Salary review", parent_id: null, created_by: BOB, is_private: true },
  { id: "sub", name: "Vibe Coding", parent_id: "pub", created_by: BOB, is_private: false },
  { id: "mine", name: "My private thing", parent_id: null, created_by: ANNA, is_private: true },
];

Deno.test("pickProjectByName: публичный проект резолвится по точному имени", () => {
  assertEquals(pickProjectByName(rows, "Launch RS", ANNA, false), { id: "pub", ambiguous: false });
});

Deno.test("pickProjectByName: чужой приватный проект не резолвится — как будто его нет", () => {
  assertEquals(pickProjectByName(rows, "Salary review", ANNA, false), null);
  assertEquals(pickProjectByName([], "Salary review", ANNA, false), null); // тот же ответ на пустых данных
});

Deno.test("pickProjectByName: чужой подпроект не резолвится", () => {
  assertEquals(pickProjectByName(rows, "Vibe Coding", ANNA, false), null);
});

Deno.test("pickProjectByName: свой приватный проект резолвится", () => {
  assertEquals(pickProjectByName(rows, "My private thing", ANNA, false), { id: "mine", ambiguous: false });
});

Deno.test("pickProjectByName: админ резолвит чужое приватное (оверсайт)", () => {
  assertEquals(pickProjectByName(rows, "Salary review", ADMIN, true), { id: "secret", ambiguous: false });
});

Deno.test("pickProjectByName: невидимая строка не создаёт ложную неоднозначность", () => {
  // Два проекта с одинаковым именем: один публичный, второй — чужой приватный.
  const dup: ProjectNameRow[] = [
    { id: "pub", name: "Ops", parent_id: null, created_by: BOB, is_private: false },
    { id: "hidden", name: "Ops", parent_id: null, created_by: BOB, is_private: true },
  ];
  assertEquals(pickProjectByName(dup, "Ops", ANNA, false), { id: "pub", ambiguous: false });
  // Автору видны оба — вот тут неоднозначность настоящая.
  assertEquals(pickProjectByName(dup, "Ops", BOB, false)?.ambiguous, true);
});

Deno.test("pickProjectByName: частичное совпадение тоже не достаёт чужое приватное", () => {
  assertEquals(pickProjectByName(rows, "Salary", ANNA, false), null);
});
