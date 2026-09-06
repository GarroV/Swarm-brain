// Раннер тот же, что у meetingsFilters.test.ts и edge-функций: deno test -A --no-check src/lib/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProjectOptions } from "./projectPicker.ts";
import type { Project } from "../types.ts";

const ME = 744230399, COLLEAGUE = 507931827;

function proj(p: Partial<Project> & { id: string; name: string }): Project {
  return {
    group_id: "cee", color: null, emoji: null, parent_id: null, sprint_id: null,
    created_by: ME, created_at: "2026-08-01T00:00:00Z", is_private: false, ...p,
  };
}

// Реальная выборка прода 2026-09-06 в миниатюре: две мои группы, чужая группа с подпроектом.
const ALL: Project[] = [
  proj({ id: "vibe", name: "Vibe Coding" }),
  proj({ id: "pl", name: "P&L", parent_id: "vibe" }),
  proj({ id: "imf", name: "IMF & HQ IT" }),
  proj({ id: "karpov", name: "Дмитрий Карпов", parent_id: "imf" }),
  proj({ id: "revizii", name: "Анализ ревизий", created_by: COLLEAGUE }),
  proj({ id: "romania", name: "Румыния июнь-август", parent_id: "revizii", created_by: COLLEAGUE }),
];

Deno.test("чужие проекты и их подпроекты в список не попадают", () => {
  const { tops, subs } = buildProjectOptions(ALL, { viewerId: ME, selectedId: null });
  assertEquals(tops.map((o) => o.id), ["imf", "vibe"]);
  assertEquals(subs.map((o) => o.id), ["karpov", "pl"]);
});

Deno.test("проекты и подпроекты разведены по секциям — верхние отдельно от вложенных", () => {
  const { tops, subs } = buildProjectOptions(ALL, { viewerId: ME, selectedId: null });
  assertEquals(tops.every((o) => o.parentName === null), true);
  assertEquals(subs.every((o) => o.parentName !== null), true);
});

Deno.test("у подпроекта подписана его группа — иначе два «Маркетинга» неразличимы", () => {
  const dubli: Project[] = [
    proj({ id: "es", name: "Испания" }),
    proj({ id: "me", name: "Черногория" }),
    proj({ id: "mk1", name: "Маркетинг", parent_id: "es" }),
    proj({ id: "mk2", name: "Маркетинг", parent_id: "me" }),
  ];
  const { subs } = buildProjectOptions(dubli, { viewerId: ME, selectedId: null });
  assertEquals(subs.map((o) => `${o.parentName} › ${o.name}`), ["Испания › Маркетинг", "Черногория › Маркетинг"]);
});

Deno.test("внутри секции сортировка по алфавиту, а не по времени создания", () => {
  const shuffled: Project[] = [
    proj({ id: "b", name: "Обучение", created_at: "2026-08-01T00:00:00Z" }),
    proj({ id: "a", name: "Качество", created_at: "2026-08-30T00:00:00Z" }),
  ];
  const { tops } = buildProjectOptions(shuffled, { viewerId: ME, selectedId: null });
  assertEquals(tops.map((o) => o.name), ["Качество", "Обучение"]);
});

Deno.test("подпроекты сортируются группами: сначала по имени группы, потом по своему", () => {
  const many: Project[] = [
    proj({ id: "imf", name: "IMF & HQ IT" }),
    proj({ id: "vibe", name: "Vibe Coding" }),
    proj({ id: "s2", name: "Юля Емельянова", parent_id: "imf" }),
    proj({ id: "s1", name: "Алексей Канаев", parent_id: "imf" }),
    proj({ id: "s3", name: "P&L", parent_id: "vibe" }),
  ];
  const { subs } = buildProjectOptions(many, { viewerId: ME, selectedId: null });
  assertEquals(subs.map((o) => `${o.parentName}/${o.name}`), [
    "IMF & HQ IT/Алексей Канаев", "IMF & HQ IT/Юля Емельянова", "Vibe Coding/P&L",
  ]);
});

Deno.test("уже привязанный чужой проект остаётся в списке — иначе сохранение молча оторвёт задачу", () => {
  const { tops } = buildProjectOptions(ALL, { viewerId: ME, selectedId: "revizii" });
  assertEquals(tops.map((o) => o.id), ["revizii", "imf", "vibe"]);
});

Deno.test("уже привязанный чужой ПОДпроект тоже остаётся, с подписью своей группы", () => {
  const { subs } = buildProjectOptions(ALL, { viewerId: ME, selectedId: "romania" });
  assertEquals(subs.map((o) => o.id), ["romania", "karpov", "pl"]);
  assertEquals(subs[0].parentName, "Анализ ревизий");
});

Deno.test("подпроект внутри моей группы виден, даже если завёл его коллега", () => {
  const list = [...ALL, proj({ id: "chuzhoy", name: "Испания", parent_id: "imf", created_by: COLLEAGUE })];
  const { subs } = buildProjectOptions(list, { viewerId: ME, selectedId: null });
  assertEquals(subs.map((o) => o.id).includes("chuzhoy"), true);
});

Deno.test("строка без автора (легаси/бот) видна всем — иначе она стала бы недостижимой", () => {
  const list = [proj({ id: "nobody", name: "Дайджест", created_by: null })];
  const { tops } = buildProjectOptions(list, { viewerId: ME, selectedId: null });
  assertEquals(tops.map((o) => o.id), ["nobody"]);
});

Deno.test("личность зрителя ещё не известна — показываем всё, это витрина, а не замок", () => {
  // Отбор по автору — удобство выбора; доступ стережёт сервер (canViewProject в swarm-api).
  // Пустой список при неизвестном зрителе означал бы «не к чему привязать задачу».
  const { tops, subs } = buildProjectOptions(ALL, { viewerId: null, selectedId: null });
  assertEquals(tops.length + subs.length, ALL.length);
});
