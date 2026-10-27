// Согласование встречи: владелец — только при первом согласовании безвладельной встречи;
// видимость — только владельцу и только по просьбе вызывающего; shared_with не трогается.
// Ядро прав — тесты до кода.
import { assertEquals } from "jsr:@std/assert@1";
import { claimOwnerIfFree, meetingConfirmPatch } from "./meeting-confirm.ts";
import { escapeLike } from "../users/membership.ts";

const owned = { group_id: "cee", is_private: false, owner_id: 10, metadata: { confirmed: false } };
const ownerless = { ...owned, owner_id: null };
const caller = { id: 20 };

Deno.test("согласование пишет metadata.confirmed и сохраняет остальную metadata", () => {
  const { metadata } = meetingConfirmPatch({ ...owned, metadata: { title: "T", confirmed: false } }, caller);
  assertEquals({ title: metadata.title, confirmed: metadata.confirmed }, { title: "T", confirmed: true });
});

Deno.test("первое согласование безвладельной встречи: владелец — согласовавший", () => {
  assertEquals(meetingConfirmPatch(ownerless, caller).owner_id, 20);
});

Deno.test("безвладельная, metadata без confirmed (Read.ai) — тоже первое согласование", () => {
  assertEquals(meetingConfirmPatch({ ...ownerless, metadata: {} }, caller).owner_id, 20);
});

Deno.test("повторное согласование уже согласованной встречи владельца не назначает", () => {
  assertEquals(meetingConfirmPatch({ ...ownerless, metadata: { confirmed: true } }, caller).owner_id, undefined);
});

Deno.test("у встречи с владельцем согласование владельца не меняет", () => {
  assertEquals(meetingConfirmPatch(owned, caller).owner_id, undefined);
});

Deno.test("видимость и shared_with без publishPrivate не трогаются", () => {
  const priv = { ...owned, is_private: true, owner_id: 20, shared_with: [30] };
  const keys = Object.keys(meetingConfirmPatch(priv, caller));
  assertEquals(keys, ["metadata"]);
});

Deno.test("publishPrivate: владелец личной встречи — согласование публикует", () => {
  const priv = { ...owned, is_private: true, owner_id: 20 };
  assertEquals(meetingConfirmPatch(priv, caller, { publishPrivate: true }).is_private, false);
});

Deno.test("publishPrivate: не владелец (участник, админ-без-прав на личную) — видимость не меняется", () => {
  const priv = { ...owned, is_private: true, owner_id: 10 };
  assertEquals(meetingConfirmPatch(priv, caller, { publishPrivate: true }).is_private, undefined);
  assertEquals(meetingConfirmPatch(priv, { id: 20, isAdmin: true }, { publishPrivate: true }).is_private, undefined);
});

Deno.test("publishPrivate: встреча 1-1 (shared_with) не публикуется согласованием", () => {
  const oneOnOne = { ...owned, is_private: true, owner_id: 20, shared_with: [30] };
  assertEquals(meetingConfirmPatch(oneOnOne, caller, { publishPrivate: true }).is_private, undefined);
});

Deno.test("publishPrivate: общая встреча остаётся как есть", () => {
  assertEquals(meetingConfirmPatch({ ...owned, owner_id: 20 }, caller, { publishPrivate: true }).is_private, undefined);
});

// «Первое согласование» не сбрасывается клиентом: отметка confirmed_at пишется только патчем
// и переживает confirmed:false.
Deno.test("согласование пишет серверную отметку confirmed_at", () => {
  const at = meetingConfirmPatch(ownerless, caller).metadata.confirmed_at;
  assertEquals(typeof at, "string");
});

Deno.test("снять и поставить согласование заново: владельца второй раз не назначает", () => {
  const unconfirmedAfterFirst = { ...ownerless, metadata: { confirmed: false, confirmed_at: "2026-10-01T00:00:00Z" } };
  const patch = meetingConfirmPatch(unconfirmedAfterFirst, caller);
  assertEquals(patch.owner_id, undefined);
  assertEquals(patch.metadata.confirmed_at, "2026-10-01T00:00:00Z");
});

Deno.test("claimOwnerIfFree: запись условная — owner_id IS NULL", async () => {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = {};
  for (const m of ["update", "eq", "is"]) b[m] = (...a: unknown[]) => (calls.push([m, a]), b);
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
  await claimOwnerIfFree({ from: () => b } as never, "e1", 20);
  assertEquals(calls.some(([m, a]) => m === "is" && a[0] === "owner_id" && a[1] === null), true);
});

Deno.test("escapeLike: подстановочные символы имени теряют силу", () => {
  assertEquals(escapeLike("a_b%c\\d"), "a\\_b\\%c\\\\d");
});
