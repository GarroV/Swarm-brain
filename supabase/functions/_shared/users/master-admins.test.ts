import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeFakeDb } from "../workspace-keys.fake.ts";
import { SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";
import {
  addMasterAdmin,
  isMasterAdmin,
  listMasterAdmins,
  masterAdminFlag,
  removeMasterAdmin,
  targetIsMasterAdmin,
  withMasterFlag,
} from "./master-admins.ts";

const OTHER = 555;

Deno.test("isMasterAdmin: константа — да без базы; строка в master_admins — да; чужой — нет", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  assertEquals(await isMasterAdmin(db.client, SUPERADMIN_TELEGRAM_ID), true);
  assertEquals(await isMasterAdmin(db.client, OTHER), true);
  assertEquals(await isMasterAdmin(db.client, 999), false);
});

Deno.test("isMasterAdmin: без кэша — снятый мастер-админ теряет права сразу, а не через минуту", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }, { telegram_id: 777 }] });
  assertEquals(await isMasterAdmin(db.client, OTHER), true);
  // строку снимают где-то ещё (другой экземпляр функции) — следующая проверка видит это сразу
  db.tables.master_admins = db.tables.master_admins.filter((r) => r.telegram_id !== OTHER);
  assertEquals(await isMasterAdmin(db.client, OTHER), false);
  const before = db.reads.master_admins;
  await isMasterAdmin(db.client, 777);
  await isMasterAdmin(db.client, 777);
  assertEquals(db.reads.master_admins, before + 2); // каждый вызов — чтение таблицы
});

Deno.test("targetIsMasterAdmin: мастер — да, обычный и безучётный (null) — нет, константа — да", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  assertEquals(await targetIsMasterAdmin(db.client, OTHER), true);
  assertEquals(await targetIsMasterAdmin(db.client, 999), false);
  assertEquals(await targetIsMasterAdmin(db.client, null), false);
  assertEquals(await targetIsMasterAdmin(db.client, SUPERADMIN_TELEGRAM_ID), true);
});

Deno.test("targetIsMasterAdmin: сбой чтения списка — цель считается мастером (отказ, fail-closed)", async () => {
  const broken = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "42P01" } }) }) }),
    }),
  } as unknown as Parameters<typeof targetIsMasterAdmin>[0];
  const log = console.error;
  console.error = () => {};
  try {
    assertEquals(await targetIsMasterAdmin(broken, 999), true);
  } finally {
    console.error = log;
  }
});

Deno.test("withMasterFlag: проставляет is_master по telegram_id строки", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  assertEquals((await withMasterFlag(db.client, { telegram_id: OTHER, group_id: "cee" }))?.is_master, true);
  assertEquals((await withMasterFlag(db.client, { telegram_id: 999, group_id: "cee" }))?.is_master, false);
  assertEquals(await withMasterFlag(db.client, null), null);
});

Deno.test("removeMasterAdmin: константного снять нельзя", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: SUPERADMIN_TELEGRAM_ID }, { telegram_id: OTHER }] });
  const res = await removeMasterAdmin(db.client, SUPERADMIN_TELEGRAM_ID);
  assert(!res.ok && res.reason === "builtin");
  assertEquals(db.tables.master_admins.length, 2);
});

Deno.test("removeMasterAdmin: последнего в таблице снять нельзя, неизвестного — not_found", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  const last = await removeMasterAdmin(db.client, OTHER);
  assert(!last.ok && last.reason === "last");
  const missing = await removeMasterAdmin(db.client, 12345);
  assert(!missing.ok && missing.reason === "not_found");
  assertEquals(db.tables.master_admins.length, 1);
});

Deno.test("removeMasterAdmin: при двух строках снимает выбранного", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: SUPERADMIN_TELEGRAM_ID }, { telegram_id: OTHER }] });
  assertEquals((await removeMasterAdmin(db.client, OTHER)).ok, true);
  assertEquals(db.tables.master_admins.map((r) => r.telegram_id), [SUPERADMIN_TELEGRAM_ID]);
});

Deno.test("addMasterAdmin: мусорный id отбивается; повтор не дублирует", async () => {
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

Deno.test("masterAdminFlag: человек из master_admins — да, обычный — нет, константа — да без базы", async () => {
  const db = makeFakeDb({ master_admins: [{ telegram_id: OTHER }] });
  assertEquals(await masterAdminFlag(db.client, OTHER), true);
  assertEquals(await masterAdminFlag(db.client, 999), false);
  assertEquals(await masterAdminFlag(db.client, SUPERADMIN_TELEGRAM_ID), true);
});

Deno.test("masterAdminFlag: сбой чтения списка — «нет» для прав (не исключение); константа остаётся «да»", async () => {
  const broken = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "42P01" } }) }) }),
    }),
  } as unknown as Parameters<typeof masterAdminFlag>[0];
  const log = console.error;
  console.error = () => {};
  try {
    assertEquals(await masterAdminFlag(broken, OTHER), false);
    assertEquals(await masterAdminFlag(broken, SUPERADMIN_TELEGRAM_ID), true);
  } finally {
    console.error = log;
  }
});
