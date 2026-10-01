// Отрицательные тесты доступа к записи — в форме, которая МОЖЕТ упасть (issue #60):
// чужая личная запись реально существует в данных, посторонний получает отказ, и отказ
// неотличим от «нет такой записи».
//
// Почему именно так: до этого в `swarm-mcp` правка и переиндексация записи шли по одному id,
// без владельца и воркспейса. Тест, который проверяет только «свой доступ работает», такую
// дыру не ловит — падать должно на ЧУЖОМ.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { canMutateEntry, canViewEntry, entryAccessError, entryVisibilityOr } from "./access.ts";

const OWNER = 111;
const OTHER = 222;

const личная = { is_private: true, owner_id: OWNER, group_id: "cee" };
const общая = { is_private: false, owner_id: OWNER, group_id: "cee" };
const ничья = { is_private: false, owner_id: null, group_id: "cee" };

Deno.test("чужая личная запись: отказ дословно равен «не найдена»", () => {
  const denied = entryAccessError("e-1", личная, OTHER);
  const missing = entryAccessError("e-1", null, OTHER);
  assertEquals(denied, missing);
  assertNotEquals(denied, null);
});

Deno.test("чужой воркспейс: отказ тоже равен «не найдена»", () => {
  const denied = entryAccessError("e-2", { ...общая, group_id: "other" }, OTHER, "cee");
  assertEquals(denied, entryAccessError("e-2", null, OTHER, "cee"));
});

Deno.test("своя личная запись доступна автору", () => {
  assertEquals(entryAccessError("e-3", личная, OWNER, "cee"), null);
});

Deno.test("общую запись видит любой в воркспейсе", () => {
  assertEquals(entryAccessError("e-4", общая, OTHER, "cee"), null);
});

Deno.test("но править общую чужую нельзя — и отказ назван прямо, не «не найдена»", () => {
  const denied = entryAccessError("e-5", общая, OTHER, "cee", { requireOwner: true });
  assertNotEquals(denied, null);
  assertNotEquals(denied, entryAccessError("e-5", null, OTHER, "cee"));
});

Deno.test("автор правит свою общую запись", () => {
  assertEquals(entryAccessError("e-6", общая, OWNER, "cee", { requireOwner: true }), null);
});

Deno.test("запись без автора не правит никто — fail-closed", () => {
  assertNotEquals(entryAccessError("e-7", ничья, OTHER, "cee", { requireOwner: true }), null);
  assertNotEquals(entryAccessError("e-7", ничья, OWNER, "cee", { requireOwner: true }), null);
  assertEquals(canMutateEntry(ничья, OWNER), false);
});

Deno.test("без личности вызывающего личная запись закрыта, мутации запрещены", () => {
  assertEquals(canViewEntry(личная, null), false);
  assertEquals(canViewEntry(личная, undefined), false);
  assertEquals(canMutateEntry(общая, null), false);
  assertNotEquals(entryAccessError("e-8", личная, null), null);
  assertNotEquals(entryAccessError("e-9", общая, null, "cee", { requireOwner: true }), null);
});

Deno.test("админского обхода у записей НЕТ: параметра isAdmin в гарде не существует", async () => {
  // Решение владельца (docs/decisions/2026-08-21-admin-visibility.md, issue #15): у задач
  // оверсайт руководителя есть, у записей — нет. Однажды его уже сняли у задач, приняв за
  // забытую дыру; здесь фиксируем обратное — чтобы «для симметрии» не добавили.
  // Комментарии срезаем: в них слово isAdmin стоит намеренно — как запрет для читателя.
  // Проверяем именно КОД, иначе тест падает на собственном предупреждении (так и случилось).
  const src = await Deno.readTextFile(new URL("./access.ts", import.meta.url));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
  assertEquals(/isAdmin/.test(code), false);
});

// ── Личная запись на двоих: встреча 1-1 (#641) ──────────────────────────────────────────────
// Одна запись, владелец — опубликовавший, второй участник — в shared_with. Видят оба, третий нет.
const PARTNER = -37; // веб-пользователь без Telegram: отрицательный id — живой человек
const наДвоих = { is_private: true, owner_id: OWNER, group_id: "cee", shared_with: [PARTNER] };

Deno.test("запись на двоих: видит владелец и второй участник", () => {
  assertEquals(canViewEntry(наДвоих, OWNER), true);
  assertEquals(canViewEntry(наДвоих, PARTNER), true);
});

Deno.test("запись на двоих: третий участник воркспейса НЕ видит, отказ = «не найдена»", () => {
  assertEquals(canViewEntry(наДвоих, OTHER), false);
  assertEquals(entryAccessError("e1", наДвоих, OTHER, "cee"), "Запись e1 не найдена.");
});

Deno.test("запись на двоих: без зрителя не видна никому", () => {
  assertEquals(canViewEntry(наДвоих, null), false);
  assertEquals(canViewEntry(наДвоих, undefined), false);
});

Deno.test("запись на двоих: id строкой из базы (bigint) всё равно совпадает", () => {
  const row = { ...наДвоих, shared_with: [String(PARTNER)] as unknown as number[] };
  assertEquals(canViewEntry(row, PARTNER), true);
});

Deno.test("запись на двоих: править и удалять как ЗАПИСЬ может только владелец", () => {
  // Правка встречи участником — по правилу встреч (meeting-rights), не по общему правилу записей.
  assertEquals(canMutateEntry(наДвоих, OWNER), true);
  assertEquals(canMutateEntry(наДвоих, PARTNER), false);
});

Deno.test("фильтр видимости для запроса: общая, своя и разделённая со мной", () => {
  assertEquals(entryVisibilityOr(OWNER), "is_private.eq.false,owner_id.eq.111,shared_with.cs.{111}");
  assertEquals(entryVisibilityOr(PARTNER), "is_private.eq.false,owner_id.eq.-37,shared_with.cs.{-37}");
});

Deno.test("фильтр видимости: мусор вместо id даёт только общие записи", () => {
  // В строку PostgREST не должно попасть ничего, кроме целого числа.
  assertEquals(entryVisibilityOr(Number.NaN), "is_private.eq.false");
  assertEquals(entryVisibilityOr("1),or(is_private.eq.true" as unknown as number), "is_private.eq.false");
  assertEquals(entryVisibilityOr(12.7), "is_private.eq.false,owner_id.eq.12,shared_with.cs.{12}");
});
