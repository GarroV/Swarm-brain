// Согласование встречи: владелец — только при первом согласовании безвладельной встречи;
// видимость — только владельцу и только по просьбе вызывающего; shared_with не трогается.
// Ядро прав — тесты до кода.
import { assertEquals } from "jsr:@std/assert@1";
import { meetingConfirmPatch } from "./meeting-confirm.ts";

const owned = { group_id: "cee", is_private: false, owner_id: 10, metadata: { confirmed: false } };
const ownerless = { ...owned, owner_id: null };
const caller = { id: 20 };

Deno.test("согласование пишет metadata.confirmed и сохраняет остальную metadata", () => {
  const patch = meetingConfirmPatch({ ...owned, metadata: { title: "T", confirmed: false } }, caller);
  assertEquals(patch, { metadata: { title: "T", confirmed: true } });
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
