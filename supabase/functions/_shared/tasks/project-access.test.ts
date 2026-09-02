import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canViewProject,
  isProjectPrivate,
  parentLookup,
  pickProjectByName,
  visibleProjectNames,
  type ProjectAccessRow,
  type ProjectNameRow,
} from "./project-access.ts";

const ANNA = 111;
const BOB = 222;
const ADMIN = 744230399;

// Дерево воркспейса: публичная группа с подпроектами и закрытая группа со своим подпроектом.
const publicTop: ProjectAccessRow = { parent_id: null, created_by: BOB, is_private: false };
const privateTop: ProjectAccessRow = { parent_id: null, created_by: BOB, is_private: true };
const openSub: ProjectAccessRow = { parent_id: "pub", created_by: BOB, is_private: false };
const closedSub: ProjectAccessRow = { parent_id: "pub", created_by: BOB, is_private: true };
const subOfClosed: ProjectAccessRow = { parent_id: "secret", created_by: BOB, is_private: false };
const legacy: ProjectAccessRow = { parent_id: null, created_by: null, is_private: true };

const tree = new Map<string, ProjectAccessRow>([
  ["pub", publicTop],
  ["secret", privateTop],
]);

Deno.test("isProjectPrivate: вложенность сама по себе больше не прячет (решение владельца 2026-08-24)", () => {
  assertEquals(isProjectPrivate(openSub, tree), false);
  assertEquals(isProjectPrivate(publicTop, tree), false);
});

Deno.test("isProjectPrivate: прячет собственный тумблер — и на верхнем уровне, и на подпроекте", () => {
  assertEquals(isProjectPrivate(privateTop, tree), true);
  assertEquals(isProjectPrivate(closedSub, tree), true);
});

Deno.test("isProjectPrivate: закрытый родитель закрывает и открытый подпроект (наследование вниз)", () => {
  assertEquals(isProjectPrivate(subOfClosed, tree), true);
});

Deno.test("canViewProject: открытый подпроект открытой группы видит весь воркспейс", () => {
  assertEquals(canViewProject(openSub, ANNA, tree), true);
  assertEquals(canViewProject(openSub, undefined, tree), true);
});

Deno.test("canViewProject: закрытый подпроект скрыт ото всех, кроме автора — админ не исключение", () => {
  assertEquals(canViewProject(closedSub, ANNA, tree), false);
  assertEquals(canViewProject(closedSub, ADMIN, tree), false);
  assertEquals(canViewProject(closedSub, BOB, tree), true);
});

Deno.test("canViewProject: закрытая группа скрывает свои подпроекты целиком", () => {
  assertEquals(canViewProject(subOfClosed, ANNA, tree), false);
  assertEquals(canViewProject(subOfClosed, BOB, tree), true); // автор группы видит
});

Deno.test("canViewProject: чужой открытый подпроект в закрытой группе не спасает собственное авторство", () => {
  // Подпроект Анны внутри закрытой группы Боба: группа закрыта → закрыто и её содержимое.
  const annaSubInClosed: ProjectAccessRow = { parent_id: "secret", created_by: ANNA, is_private: false };
  assertEquals(canViewProject(annaSubInClosed, ANNA, tree), false);
});

Deno.test("canViewProject: родителя нет в выборке — строка закрыта (fail-closed)", () => {
  const orphan: ProjectAccessRow = { parent_id: "gone", created_by: BOB, is_private: false };
  assertEquals(canViewProject(orphan, ANNA, new Map()), false);
  assertEquals(canViewProject(orphan, BOB, new Map()), false);
});

Deno.test("canViewProject: цикл в parent_id не вешает проверку", () => {
  const a: ProjectAccessRow = { parent_id: "b", created_by: BOB, is_private: false };
  const b: ProjectAccessRow = { parent_id: "a", created_by: BOB, is_private: false };
  const cyclic = new Map<string, ProjectAccessRow>([["a", a], ["b", b]]);
  assertEquals(canViewProject(a, ANNA, cyclic), false);
});

Deno.test("canViewProject: без личности зрителя приватное закрыто (fail-closed)", () => {
  assertEquals(canViewProject(privateTop, undefined, tree), false);
  assertEquals(canViewProject(closedSub, undefined, tree), false);
});

Deno.test("canViewProject: легаси-строка без created_by остаётся общей", () => {
  assertEquals(canViewProject(legacy, ANNA, tree), true);
});

Deno.test("parentLookup: собирает индекс родителей из плоского списка строк воркспейса", () => {
  const rows = [
    { id: "pub", ...publicTop },
    { id: "sub", ...openSub },
  ];
  const idx = parentLookup(rows);
  assertEquals(idx.get("pub"), publicTop);
  assertEquals(canViewProject(openSub, ANNA, idx), true);
});

// ── Резолв имени в id через MCP (issue #37) ────────────────────────────────────
// Чужое закрытое РЕАЛЬНО лежит в данных — отказ сверяем с «как будто его нет».

const rows: ProjectNameRow[] = [
  { id: "pub", name: "Launch RS", parent_id: null, created_by: BOB, is_private: false },
  { id: "secret", name: "Salary review", parent_id: null, created_by: BOB, is_private: true },
  { id: "sub", name: "Vibe Coding", parent_id: "pub", created_by: BOB, is_private: false },
  { id: "subsecret", name: "Payroll detail", parent_id: "secret", created_by: BOB, is_private: false },
  { id: "closedsub", name: "Личное", parent_id: "pub", created_by: BOB, is_private: true },
  { id: "mine", name: "My private thing", parent_id: null, created_by: ANNA, is_private: true },
];

Deno.test("pickProjectByName: публичный проект резолвится по точному имени", () => {
  assertEquals(pickProjectByName(rows, "Launch RS", ANNA), { id: "pub", ambiguous: false });
});

Deno.test("pickProjectByName: открытый подпроект теперь резолвится — доска общая", () => {
  assertEquals(pickProjectByName(rows, "Vibe Coding", ANNA), { id: "sub", ambiguous: false });
});

Deno.test("pickProjectByName: чужой приватный проект не резолвится — как будто его нет", () => {
  assertEquals(pickProjectByName(rows, "Salary review", ANNA), null);
  assertEquals(pickProjectByName([], "Salary review", ANNA), null); // тот же ответ на пустых данных
});

Deno.test("pickProjectByName: подпроект закрытой группы не резолвится", () => {
  assertEquals(pickProjectByName(rows, "Payroll detail", ANNA), null);
});

Deno.test("pickProjectByName: закрытый тумблером подпроект не резолвится у чужого", () => {
  assertEquals(pickProjectByName(rows, "Личное", ANNA), null);
  assertEquals(pickProjectByName(rows, "Личное", BOB), { id: "closedsub", ambiguous: false });
});

Deno.test("pickProjectByName: свой приватный проект резолвится", () => {
  assertEquals(pickProjectByName(rows, "My private thing", ANNA), { id: "mine", ambiguous: false });
});

Deno.test("pickProjectByName: админ НЕ резолвит чужое приватное (обход снят 2026-08-21)", () => {
  assertEquals(pickProjectByName(rows, "Salary review", ADMIN), null);
});

Deno.test("pickProjectByName: невидимая строка не создаёт ложную неоднозначность", () => {
  // Два проекта с одинаковым именем: один публичный, второй — чужой приватный.
  const dup: ProjectNameRow[] = [
    { id: "pub", name: "Ops", parent_id: null, created_by: BOB, is_private: false },
    { id: "hidden", name: "Ops", parent_id: null, created_by: BOB, is_private: true },
  ];
  assertEquals(pickProjectByName(dup, "Ops", ANNA), { id: "pub", ambiguous: false });
  // Автору видны оба — вот тут неоднозначность настоящая.
  assertEquals(pickProjectByName(dup, "Ops", BOB)?.ambiguous, true);
});

Deno.test("pickProjectByName: частичное совпадение тоже не достаёт чужое приватное", () => {
  assertEquals(pickProjectByName(rows, "Salary", ANNA), null);
});

// ── visibleProjectNames: подсказка в отказе не должна раскрывать закрытые проекты (issue #199) ──

Deno.test("visibleProjectNames: чужой закрытый проект в список не попадает", () => {
  const rows = [
    { id: "open", name: "Открытый", parent_id: null, created_by: 1, is_private: false },
    { id: "mine", name: "Мой закрытый", parent_id: null, created_by: 7, is_private: true },
    { id: "alien", name: "Чужой закрытый", parent_id: null, created_by: 1, is_private: true },
  ];
  assertEquals(visibleProjectNames(rows, 7), ["Открытый", "Мой закрытый"]);
});

Deno.test("visibleProjectNames: подпроект закрытой группы не всплывает в подсказке", () => {
  const rows = [
    { id: "grp", name: "Закрытая группа", parent_id: null, created_by: 1, is_private: true },
    { id: "kid", name: "Подпроект", parent_id: "grp", created_by: 1, is_private: false },
  ];
  assertEquals(visibleProjectNames(rows, 7), []);
});
