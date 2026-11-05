// Исполнитель задачи из веба — только член воркспейса задачи (ядро прав, testing.md).
import { assertEquals } from "jsr:@std/assert@1";
import { memoryDb } from "../_shared/memory-db.fake.ts";
import { resolveAssigneeInWorkspace } from "./assignee.ts";

const names = (ids: number[]) => Promise.resolve(new Map(ids.map((i) => [i, `Имя ${i}`])));
const { client } = memoryDb({
  allowed_users: [{ telegram_id: 1, group_id: "a" }, { telegram_id: 2, group_id: "b" }],
});

Deno.test("исполнитель: член своего воркспейса назначается, имя берётся из профиля", async () => {
  assertEquals(await resolveAssigneeInWorkspace(client, names, 1, "a"), { telegram_id: 1, name: "Имя 1" });
});

Deno.test("исполнитель: член другого воркспейса не назначается", async () => {
  assertEquals(await resolveAssigneeInWorkspace(client, names, 2, "a"), null);
});

Deno.test("исполнитель: неизвестный telegram_id не назначается", async () => {
  assertEquals(await resolveAssigneeInWorkspace(client, names, 404, "a"), null);
});
