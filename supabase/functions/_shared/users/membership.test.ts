// Переезд человека в другой воркспейс сбрасывает флаг админа; повторное добавление в тот же — нет.
import { assertEquals } from "jsr:@std/assert@1";
import { memoryDb } from "../memory-db.fake.ts";
import { addUserToWorkspace, resetAdminOnMove } from "./membership.ts";

const fixtures = () => ({
  workspaces: [{ id: "a" }, { id: "b" }],
  allowed_users: [
    { id: "u1", telegram_id: 1, group_id: "a", is_admin: true, username: "ann", email: "ann@x.io" },
    { id: "u2", telegram_id: null, group_id: "a", is_admin: true, username: "pend", email: null },
    { id: "u3", telegram_id: null, group_id: "a", is_admin: true, username: null, email: "mail@x.io" },
  ],
});
const opts = { addedBy: 9 };

Deno.test("переезд по telegram_id: is_admin снимается", async () => {
  const db = memoryDb(fixtures());
  await addUserToWorkspace(db.client, { ...opts, telegramId: 1, workspaceId: "b" });
  const row = db.tables.allowed_users.find((r) => r.telegram_id === 1)!;
  assertEquals([row.group_id, row.is_admin], ["b", false]);
});

Deno.test("повторное добавление в тот же воркспейс: is_admin не трогается", async () => {
  const db = memoryDb(fixtures());
  await addUserToWorkspace(db.client, { ...opts, telegramId: 1, workspaceId: "a" });
  const row = db.tables.allowed_users.find((r) => r.telegram_id === 1)!;
  assertEquals([row.group_id, row.is_admin], ["a", true]);
  assertEquals("is_admin" in (db.writes[0].values as object), false);
});

Deno.test("новый человек по telegram_id: флаг не задаётся (остаётся значение по умолчанию)", async () => {
  const db = memoryDb(fixtures());
  await addUserToWorkspace(db.client, { ...opts, telegramId: 77, workspaceId: "b" });
  assertEquals("is_admin" in (db.writes[0].values as object), false);
});

Deno.test("переезд по @username и по email: is_admin снимается", async () => {
  const db = memoryDb(fixtures());
  await addUserToWorkspace(db.client, { ...opts, username: "@Pend", workspaceId: "b" });
  await addUserToWorkspace(db.client, { ...opts, email: "mail@x.io", workspaceId: "b" });
  for (const id of ["u2", "u3"]) {
    const row = db.tables.allowed_users.find((r) => r.id === id)!;
    assertEquals([row.group_id, row.is_admin], ["b", false]);
  }
});

Deno.test("resetAdminOnMove: только при смене воркспейса существующей строки", () => {
  assertEquals(resetAdminOnMove(null, "a"), {});
  assertEquals(resetAdminOnMove({ group_id: "a" }, "a"), {});
  assertEquals(resetAdminOnMove({ group_id: "a" }, "b"), { is_admin: false });
});
