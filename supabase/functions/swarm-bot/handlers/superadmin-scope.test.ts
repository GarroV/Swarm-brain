// Границы админ-панели бота (`sa_*`): объём воркспейса, перенос и создание — только суперадмин,
// аккаунт суперадмина — только ему. Ядро прав доступа — тесты до кода.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type BotAdminAction,
  botAdminAllowed,
  parseSaCallback,
  parseSaSession,
  visibleWorkspaces,
} from "./superadmin-scope.ts";

const SUPER = { telegramId: 744230399, groupId: "cee" };
const ADMIN = { telegramId: 1001, groupId: "cee" };
const memberCee = { telegram_id: 2001, group_id: "cee" };
const memberOther = { telegram_id: 3001, group_id: "other" };
const superRow = { telegram_id: 744230399, group_id: "cee" };

const allow = (actor: typeof ADMIN, act: BotAdminAction, target = null as typeof memberCee | null) =>
  botAdminAllowed(actor, act, target);

// ── Разбор колбэков и шагов сессии ──────────────────────────────────────────

Deno.test("колбэки разбираются в действия", () => {
  assertEquals(parseSaCallback("sa_main"), { kind: "menu" });
  assertEquals(parseSaCallback("sa_spaces"), { kind: "list" });
  assertEquals(parseSaCallback("sa_create"), { kind: "create" });
  assertEquals(parseSaCallback("sa_sp_cee"), { kind: "workspace", wsId: "cee" });
  assertEquals(parseSaCallback("sa_su_cee"), { kind: "workspace", wsId: "cee" });
  assertEquals(parseSaCallback("sa_add_cee"), { kind: "workspace", wsId: "cee" });
  assertEquals(parseSaCallback("sa_ren_cee"), { kind: "workspace", wsId: "cee" });
  assertEquals(parseSaCallback("sa_u_2001_cee"), { kind: "user", tgId: 2001, wsId: "cee" });
  assertEquals(parseSaCallback("sa_mv_2001_cee"), { kind: "move", tgId: 2001, wsId: "cee" });
  assertEquals(parseSaCallback("sa_mvto_2001_other"), { kind: "move", tgId: 2001, wsId: "other" });
  assertEquals(parseSaCallback("sa_blk_2001_cee"), { kind: "remove", tgId: 2001, wsId: "cee" });
  // воркспейс с дефисом/подчёркиванием в id — делим по первому «_»
  assertEquals(parseSaCallback("sa_u_2001_my_ws"), { kind: "user", tgId: 2001, wsId: "my_ws" });
});

Deno.test("неизвестный или битый колбэк — unknown (закрыто по умолчанию)", () => {
  assertEquals(parseSaCallback("sa_zzz"), { kind: "unknown" });
  assertEquals(parseSaCallback("sa_u_abc_cee"), { kind: "unknown" });
  assertEquals(parseSaCallback("sa_blk_2001"), { kind: "unknown" });
  assertEquals(parseSaCallback("sa_sp_"), { kind: "unknown" });
});

Deno.test("шаги сессии разбираются в действия", () => {
  assertEquals(parseSaSession("sa_adduser_cee", " @Newbie "), { kind: "add", wsId: "cee", input: "@Newbie" });
  assertEquals(parseSaSession("sa_create_id", "x"), { kind: "create" });
  assertEquals(parseSaSession("sa_create_name_new", "x"), { kind: "create" });
  assertEquals(parseSaSession("sa_rename_cee", "x"), { kind: "workspace", wsId: "cee" });
  assertEquals(parseSaSession("sa_other", "x"), { kind: "unknown" });
});

Deno.test("каждый префикс sa_, который разбирает обработчик, известен разборщику (детектор дрифта)", async () => {
  const src = await Deno.readTextFile(new URL("./superadmin.ts", import.meta.url));
  const prefixes = [...src.matchAll(/(?:startsWith\(|=== )"(sa_[a-z_]+)"/g)].map((m) => m[1])
    .filter((p) => p !== "sa_"); // общий префикс-вход, не ветка
  assert(prefixes.length >= 10, `нашлось слишком мало веток: ${prefixes.length}`);
  for (const p of prefixes) {
    // подставляем правдоподобный хвост в формате ветки
    const sample = p.endsWith("_") ? (/_(u|mv|mvto|blk)_$/.test(p) ? `${p}2001_cee` : `${p}cee`) : p;
    const cb = parseSaCallback(sample);
    const ss = parseSaSession(sample, "x");
    assert(cb.kind !== "unknown" || ss.kind !== "unknown", `ветка ${p} не проходит через границы`);
  }
});

// ── Решение ─────────────────────────────────────────────────────────────────

Deno.test("админ работает со своим воркспейсом", () => {
  assert(allow(ADMIN, { kind: "workspace", wsId: "cee" }));
  assert(allow(ADMIN, { kind: "user", tgId: 2001, wsId: "cee" }, memberCee));
  assert(allow(ADMIN, { kind: "remove", tgId: 2001, wsId: "cee" }, memberCee));
  assert(allow(ADMIN, { kind: "add", wsId: "cee", input: "newbie" }, null));
  assert(allow(ADMIN, { kind: "add", wsId: "cee", input: "2001" }, memberCee));
});

Deno.test("админ не трогает чужой воркспейс", () => {
  assert(!allow(ADMIN, { kind: "workspace", wsId: "other" }));
  assert(!allow(ADMIN, { kind: "user", tgId: 3001, wsId: "other" }, memberOther));
  assert(!allow(ADMIN, { kind: "remove", tgId: 3001, wsId: "other" }, memberOther));
  assert(!allow(ADMIN, { kind: "add", wsId: "other", input: "newbie" }, null));
});

Deno.test("админ не адресует человека чужого воркспейса через свой", () => {
  // подложенный колбэк: воркспейс свой, человек — чужой
  assert(!allow(ADMIN, { kind: "user", tgId: 3001, wsId: "cee" }, memberOther));
  assert(!allow(ADMIN, { kind: "remove", tgId: 3001, wsId: "cee" }, memberOther));
  // добавление существующего чужого = перенос к себе
  assert(!allow(ADMIN, { kind: "add", wsId: "cee", input: "3001" }, memberOther));
});

Deno.test("перенос между воркспейсами и создание воркспейса — только суперадмин", () => {
  assert(!allow(ADMIN, { kind: "move", tgId: 2001, wsId: "cee" }, memberCee));
  assert(!allow(ADMIN, { kind: "create" }));
  assert(allow(SUPER, { kind: "move", tgId: 3001, wsId: "cee" }, memberOther));
  assert(allow(SUPER, { kind: "create" }));
});

Deno.test("аккаунт суперадмина админу недоступен для удаления и добавления", () => {
  assert(!allow(ADMIN, { kind: "remove", tgId: SUPER.telegramId, wsId: "cee" }, superRow));
  assert(!allow(ADMIN, { kind: "add", wsId: "cee", input: String(SUPER.telegramId) }, superRow));
});

Deno.test("суперадмин — глобальный объём", () => {
  assert(allow(SUPER, { kind: "workspace", wsId: "other" }));
  assert(allow(SUPER, { kind: "user", tgId: 3001, wsId: "other" }, memberOther));
  assert(allow(SUPER, { kind: "remove", tgId: 3001, wsId: "other" }, memberOther));
  assert(allow(SUPER, { kind: "add", wsId: "other", input: "2001" }, memberCee));
});

Deno.test("удаление: человек должен быть в названном воркспейсе, несуществующий — отказ", () => {
  assert(!allow(SUPER, { kind: "remove", tgId: 3001, wsId: "cee" }, memberOther));
  assert(!allow(ADMIN, { kind: "remove", tgId: 9999, wsId: "cee" }, null));
});

Deno.test("меню и список открыты любому админу, unknown — никому", () => {
  assert(allow(ADMIN, { kind: "menu" }));
  assert(allow(ADMIN, { kind: "list" }));
  assert(!allow(ADMIN, { kind: "unknown" }));
  assert(!allow(SUPER, { kind: "unknown" }));
});

Deno.test("список воркспейсов: админу — только свой, суперадмину — все", () => {
  const all = [{ id: "cee", name: "CEE" }, { id: "other", name: "Other" }];
  assertEquals(visibleWorkspaces(ADMIN, all).map((w) => w.id), ["cee"]);
  assertEquals(visibleWorkspaces(SUPER, all).map((w) => w.id), ["cee", "other"]);
});
