import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeFakeDb } from "../workspace-keys.fake.ts";
import { SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";
import {
  addMasterAdmin,
  isMasterAdmin,
  listMasterAdmins,
  removeMasterAdmin,
  resetMasterAdminsCache,
} from "./master-admins.ts";

const OTHER = 555;

Deno.test("isMasterAdmin: константа — да без базы; строка в master_admins — да; чужой — нет", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  assertEquals(await isMasterAdmin(db.client, SUPERADMIN_TELEGRAM_ID), true);
  assertEquals(await isMasterAdmin(db.client, OTHER), true);
  assertEquals(await isMasterAdmin(db.client, 999), false);
});

Deno.test("isMasterAdmin: кэш — второй вызов в базу не ходит, add его сбрасывает", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb();
  await isMasterAdmin(db.client, 1);
  await isMasterAdmin(db.client, 2);
  assertEquals(db.reads.master_admins, 1);
  await addMasterAdmin(db.client, 2, SUPERADMIN_TELEGRAM_ID);
  assertEquals(await isMasterAdmin(db.client, 2), true);
});

Deno.test("removeMasterAdmin: константного снять нельзя", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb({ master_admins: [{ telegram_id: SUPERADMIN_TELEGRAM_ID }, { telegram_id: OTHER }] });
  const res = await removeMasterAdmin(db.client, SUPERADMIN_TELEGRAM_ID);
  assert(!res.ok && res.reason === "builtin");
  assertEquals(db.tables.master_admins.length, 2);
});

Deno.test("removeMasterAdmin: последнего в таблице снять нельзя, неизвестного — not_found", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  const last = await removeMasterAdmin(db.client, OTHER);
  assert(!last.ok && last.reason === "last");
  const missing = await removeMasterAdmin(db.client, 12345);
  assert(!missing.ok && missing.reason === "not_found");
  assertEquals(db.tables.master_admins.length, 1);
});

Deno.test("removeMasterAdmin: при двух строках снимает выбранного", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb({ master_admins: [{ telegram_id: SUPERADMIN_TELEGRAM_ID }, { telegram_id: OTHER }] });
  assertEquals((await removeMasterAdmin(db.client, OTHER)).ok, true);
  assertEquals(db.tables.master_admins.map((r) => r.telegram_id), [SUPERADMIN_TELEGRAM_ID]);
});

Deno.test("addMasterAdmin: мусорный id отбивается; повтор не дублирует", async () => {
  resetMasterAdminsCache();
  const db = makeFakeDb();
  for (const bad of [NaN, 0, -5, 1.5]) {
    const r = await addMasterAdmin(db.client, bad, 1);
    assert(!r.ok && r.reason === "invalid_id");
  }
  await addMasterAdmin(db.client, OTHER, 1);
  await addMasterAdmin(db.client, OTHER, 2);
  assertEquals(db.tables.master_admins.length, 1);
  assertEquals(db.tables.master_admins[0].added_by, 1);
});

Deno.test("listMasterAdmins: константа показана и помечена builtin, даже если строки в таблице нет", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER, added_by: 1, created_at: "t" }] });
  const list = await listMasterAdmins(db.client);
  assertEquals(list.map((r) => [r.telegram_id, r.builtin]), [[SUPERADMIN_TELEGRAM_ID, true], [OTHER, false]]);
});
