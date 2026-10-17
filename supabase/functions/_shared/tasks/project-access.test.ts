import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canToggleProjectPrivacy,
  canViewProject,
  hiddenProjectIds,
  isProjectPrivate,
  parentLookup,
  pickProjectByName,
  privacyChangeVerdict,
  type ProjectAccessRow,
  type ProjectNameRow,
  visibleProjectNames,
} from "./project-access.ts";

const ANNA = 111;
const BOB = 222;
const ADMIN = 744230399;

// Дерево воркспейса: публичная группа с подпроектами и закрытая группа со своим подпроектом.
const publicTop: ProjectAccessRow = {
  parent_id: null,
  created_by: BOB,
  is_private: false,
};
const privateTop: ProjectAccessRow = {
  parent_id: null,
  created_by: BOB,
  is_private: true,
};
const openSub: ProjectAccessRow = {
  parent_id: "pub",
  created_by: BOB,
  is_private: false,
};
const closedSub: ProjectAccessRow = {
  parent_id: "pub",
  created_by: BOB,
  is_private: true,
};
const subOfClosed: ProjectAccessRow = {
  parent_id: "secret",
  created_by: BOB,
  is_private: false,
};
const legacy: ProjectAccessRow = {
  parent_id: null,
  created_by: null,
  is_private: true,
};

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
  const annaSubInClosed: ProjectAccessRow = {
    parent_id: "secret",
    created_by: ANNA,
    is_private: false,
  };
  assertEquals(canViewProject(annaSubInClosed, ANNA, tree), false);
});

Deno.test("canViewProject: родителя нет в выборке — строка закрыта (fail-closed)", () => {
  const orphan: ProjectAccessRow = {
    parent_id: "gone",
    created_by: BOB,
    is_private: false,
  };
  assertEquals(canViewProject(orphan, ANNA, new Map()), false);
  assertEquals(canViewProject(orphan, BOB, new Map()), false);
});

Deno.test("canViewProject: цикл в parent_id не вешает проверку", () => {
  const a: ProjectAccessRow = {
    parent_id: "b",
    created_by: BOB,
    is_private: false,
  };
  const b: ProjectAccessRow = {
    parent_id: "a",
    created_by: BOB,
    is_private: false,
  };
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
  {
    id: "pub",
    name: "Launch RS",
    parent_id: null,
    created_by: BOB,
    is_private: false,
  },
  {
    id: "secret",
    name: "Salary review",
    parent_id: null,
    created_by: BOB,
    is_private: true,
  },
  {
    id: "sub",
    name: "Vibe Coding",
    parent_id: "pub",
    created_by: BOB,
    is_private: false,
  },
  {
    id: "subsecret",
    name: "Payroll detail",
    parent_id: "secret",
    created_by: BOB,
    is_private: false,
  },
  {
    id: "closedsub",
    name: "Личное",
    parent_id: "pub",
    created_by: BOB,
    is_private: true,
  },
  {
    id: "mine",
    name: "My private thing",
    parent_id: null,
    created_by: ANNA,
    is_private: true,
  },
];

Deno.test("pickProjectByName: публичный проект резолвится по точному имени", () => {
  assertEquals(pickProjectByName(rows, "Launch RS", ANNA), {
    id: "pub",
    ambiguous: false,
  });
});

Deno.test("pickProjectByName: открытый подпроект теперь резолвится — доска общая", () => {
  assertEquals(pickProjectByName(rows, "Vibe Coding", ANNA), {
    id: "sub",
    ambiguous: false,
  });
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
  assertEquals(pickProjectByName(rows, "Личное", BOB), {
    id: "closedsub",
    ambiguous: false,
  });
});

Deno.test("pickProjectByName: свой приватный проект резолвится", () => {
  assertEquals(pickProjectByName(rows, "My private thing", ANNA), {
    id: "mine",
    ambiguous: false,
  });
});

Deno.test("pickProjectByName: админ НЕ резолвит чужое приватное (обход снят 2026-08-21)", () => {
  assertEquals(pickProjectByName(rows, "Salary review", ADMIN), null);
});

Deno.test("pickProjectByName: невидимая строка не создаёт ложную неоднозначность", () => {
  // Два проекта с одинаковым именем: один публичный, второй — чужой приватный.
  const dup: ProjectNameRow[] = [
    {
      id: "pub",
      name: "Ops",
      parent_id: null,
      created_by: BOB,
      is_private: false,
    },
    {
      id: "hidden",
      name: "Ops",
      parent_id: null,
      created_by: BOB,
      is_private: true,
    },
  ];
  assertEquals(pickProjectByName(dup, "Ops", ANNA), {
    id: "pub",
    ambiguous: false,
  });
  // Автору видны оба — вот тут неоднозначность настоящая.
  assertEquals(pickProjectByName(dup, "Ops", BOB)?.ambiguous, true);
});

Deno.test("pickProjectByName: частичное совпадение тоже не достаёт чужое приватное", () => {
  assertEquals(pickProjectByName(rows, "Salary", ANNA), null);
});

// ── visibleProjectNames: подсказка в отказе не должна раскрывать закрытые проекты (issue #199) ──

Deno.test("visibleProjectNames: чужой закрытый проект в список не попадает", () => {
  const rows = [
    {
      id: "open",
      name: "Открытый",
      parent_id: null,
      created_by: 1,
      is_private: false,
    },
    {
      id: "mine",
      name: "Мой закрытый",
      parent_id: null,
      created_by: 7,
      is_private: true,
    },
    {
      id: "alien",
      name: "Чужой закрытый",
      parent_id: null,
      created_by: 1,
      is_private: true,
    },
  ];
  assertEquals(visibleProjectNames(rows, 7), ["Открытый", "Мой закрытый"]);
});

Deno.test("visibleProjectNames: подпроект закрытой группы не всплывает в подсказке", () => {
  const rows = [
    {
      id: "grp",
      name: "Закрытая группа",
      parent_id: null,
      created_by: 1,
      is_private: true,
    },
    {
      id: "kid",
      name: "Подпроект",
      parent_id: "grp",
      created_by: 1,
      is_private: false,
    },
  ];
  assertEquals(visibleProjectNames(rows, 7), []);
});

Deno.test("hiddenProjectIds: чужие закрытые строки и всё под чужой закрытой группой", () => {
  const rows = [
    { id: "pub", ...publicTop },
    { id: "priv", ...privateTop },
    { id: "kid", parent_id: "priv", created_by: ANNA, is_private: false },
  ];
  assertEquals(hiddenProjectIds(rows, ANNA).sort(), ["kid", "priv"]);
  assertEquals(hiddenProjectIds(rows, BOB), []);
  assertEquals(hiddenProjectIds(rows, undefined).sort(), ["kid", "priv"]);
});

Deno.test("canToggleProjectPrivacy: автор и админ — да, остальные и строка без автора — нет", () => {
  assertEquals(canToggleProjectPrivacy({ created_by: BOB }, BOB, false), true);
  assertEquals(canToggleProjectPrivacy({ created_by: BOB }, ANNA, false), false);
  assertEquals(canToggleProjectPrivacy({ created_by: BOB }, ANNA, true), true);
  assertEquals(canToggleProjectPrivacy({ created_by: null }, ANNA, false), false);
  assertEquals(canToggleProjectPrivacy({ created_by: null }, undefined, false), false);
  assertEquals(canToggleProjectPrivacy({ created_by: BOB }, undefined, false), false);
});

Deno.test("privacyChangeVerdict: перенос под закрытую группу — закрытие, нужен автор или админ", () => {
  const rows = [
    { id: "pub", ...publicTop }, // автор BOB
    { id: "annaPriv", parent_id: null, created_by: ANNA, is_private: true },
    { id: "bobPriv", parent_id: null, created_by: BOB, is_private: true },
  ];
  const row = publicTop;
  const v = (next: { parent_id: string | null; is_private: boolean }, viewer: number, admin = false) =>
    privacyChangeVerdict({ row, rows, next, viewerId: viewer, isAdmin: admin });
  // Анна прячет проект Боба, перенося его в свою закрытую группу.
  assertEquals(v({ parent_id: "annaPriv", is_private: false }, ANNA), "forbidden");
  // Под группу, которую Анна не видит, — как «нет такой».
  assertEquals(v({ parent_id: "bobPriv", is_private: false }, ANNA), "parent-hidden");
  // Автор — можно; админ — можно, если видит группу.
  assertEquals(v({ parent_id: "bobPriv", is_private: false }, BOB), "ok");
  assertEquals(v({ parent_id: "annaPriv", is_private: false }, ANNA, true), "ok");
  // Правка без смены видимости — любому участнику.
  assertEquals(v({ parent_id: null, is_private: false }, ANNA), "ok");
  assertEquals(v({ parent_id: null, is_private: true }, ANNA), "forbidden");
});

Deno.test("privacyChangeVerdict: перенос между закрытыми ветками меняет круг видящих — нужен автор", () => {
  // P — открытый проект Боба внутри закрытой группы Анны (видит только Анна).
  const rows = [
    { id: "annaPriv", parent_id: null, created_by: ANNA, is_private: true },
    // Легаси-строка без автора: закрыта флагом, но видна всем (created_by = null не прячем).
    { id: "orphanPriv", parent_id: null, created_by: null, is_private: true },
  ];
  const p = { parent_id: "annaPriv", created_by: BOB, is_private: false };
  const verdict = privacyChangeVerdict({
    row: p,
    rows,
    next: { parent_id: "orphanPriv", is_private: false },
    viewerId: ANNA,
    isAdmin: false,
  });
  // Итоговая «закрытость» та же, а видеть проект стали все — это открытие чужого проекта.
  assertEquals(verdict, "forbidden");
});
