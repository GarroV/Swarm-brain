// Добавление в воркспейс: человека с аккаунтом из другого воркспейса не переводит (переезд с данными —
// move_member_to_workspace); ожидающую строку переводит и сбрасывает флаг админа; повторное
// добавление в тот же — флаг не трогает.
import { assertEquals } from "jsr:@std/assert@1";
import { memoryDb } from "../memory-db.fake.ts";
import { addUserToWorkspace, needsMemberMove, resetAdminOnMove } from "./membership.ts";

const fixtures = () => ({
  workspaces: [{ id: "a" }, { id: "b" }],
  allowed_users: [
    { id: "u1", telegram_id: 1, group_id: "a", is_admin: true, username: "ann", email: "ann@x.io" },
    { id: "u2", telegram_id: null, group_id: "a", is_admin: true, username: "pend", email: null },
    { id: "u3", telegram_id: null, group_id: "a", is_admin: true, username: null, email: "mail@x.io" },
  ],
});
const opts = { addedBy: 9 };

Deno.test("человек с аккаунтом из другого воркспейса: отказ move_required, строка не тронута", async () => {
  for (const ref of [{ telegramId: 1 }, { username: "@ANN" }, { email: "ann@x.io" }]) {
    const db = memoryDb(fixtures());
    const r = await addUserToWorkspace(db.client, { ...opts, ...ref, workspaceId: "b" });
    assertEquals(r.status, "move_required", JSON.stringify(ref));
    const row = db.tables.allowed_users.find((r) => r.telegram_id === 1)!;
    assertEquals([row.group_id, row.is_admin], ["a", true]);
    assertEquals(db.writes.length, 0, `записано при отказе: ${JSON.stringify(ref)}`);
  }
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

Deno.test("ожидающая строка по @username и по email переводится, is_admin снимается", async () => {
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

Deno.test("needsMemberMove: только аккаунт из другого воркспейса", () => {
  assertEquals(needsMemberMove(null, "a"), false);
  assertEquals(needsMemberMove({ telegram_id: 1, group_id: "a" }, "a"), false);
  assertEquals(needsMemberMove({ telegram_id: null, group_id: "a" }, "b"), false);
  assertEquals(needsMemberMove({ telegram_id: 1, group_id: null }, "b"), false);
  assertEquals(needsMemberMove({ telegram_id: 1, group_id: "a" }, "b"), true);
});
