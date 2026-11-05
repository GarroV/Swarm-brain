// Круг получателей уведомлений о задаче ограничен её воркспейсом (ядро прав, testing.md).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { memoryDb } from "../memory-db.fake.ts";
import { loadMembershipIndex, onlyWorkspaceMembers } from "./recipients-scope.ts";

const users = () => ({
  allowed_users: [
    { telegram_id: 1, group_id: "a" },
    { telegram_id: 2, group_id: "a" },
    { telegram_id: 3, group_id: "b" }, // переехал в другой воркспейс
  ],
});

Deno.test("получатели: член воркспейса остаётся, человек из другого воркспейса отбрасывается", async () => {
  const { client } = memoryDb(users());
  assertEquals(await onlyWorkspaceMembers(client, "a", [1, 3, 2]), [1, 2]);
});

Deno.test("получатели: пустой список — пустой ответ без обращения к базе", async () => {
  const { client } = memoryDb({}); // таблицы нет: обращение к ней упало бы
  assertEquals(await onlyWorkspaceMembers(client, "a", []), []);
  assertEquals(await onlyWorkspaceMembers(client, "a", [null, undefined, 0]), []);
});

Deno.test("получатели: человека нет в воркспейсе вовсе — отбрасывается", async () => {
  const { client } = memoryDb(users());
  assertEquals(await onlyWorkspaceMembers(client, "a", [999]), []);
});

Deno.test("получатели: задача без воркспейса границы не имеет", async () => {
  const { client } = memoryDb(users());
  assertEquals(await onlyWorkspaceMembers(client, null, [1, 3]), [1, 3]);
});

Deno.test("получатели: сбой чтения выбрасывается, а не превращается в «никого» или «всех»", async () => {
  const failing = {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(ok);
      return b;
    },
  };
  await assertRejects(() => onlyWorkspaceMembers(failing as never, "a", [1]), Error, "boom");
});

Deno.test("индекс членства: отвечает по воркспейсу каждой задачи", async () => {
  const { client } = memoryDb(users());
  const isMember = await loadMembershipIndex(client, [
    { groupId: "a", ids: [1, 3] },
    { groupId: "b", ids: [3] },
    { groupId: null, ids: [7] },
  ]);
  assertEquals(isMember("a", 1), true);
  assertEquals(isMember("a", 3), false);
  assertEquals(isMember("b", 3), true);
  assertEquals(isMember(null, 7), true);
});
