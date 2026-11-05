// MCP подбирает исполнителя по имени только среди людей воркспейса вызывающего (ядро прав).
import { assertEquals } from "jsr:@std/assert@1";
import { memoryDb } from "../../_shared/memory-db.fake.ts";
import { matchAssigneeInWorkspace } from "./assignee-match.ts";

const { client } = memoryDb({
  allowed_users: [
    { telegram_id: 1, group_id: "a", username: "anna_a" },
    { telegram_id: 2, group_id: "b", username: "boris_b" },
  ],
  user_profiles: [
    { telegram_id: 1, first_name: "Анна", last_name: "Свои", email: null, name_aliases: [] },
    { telegram_id: 2, first_name: "Борис", last_name: "Чужой", email: "boris@x.io", name_aliases: ["Боря"] },
  ],
});

Deno.test("исполнитель MCP: находится человек своего воркспейса", async () => {
  const m = await matchAssigneeInWorkspace(client, "Анна", "a");
  assertEquals(m?.telegram_id, 1);
});

Deno.test("исполнитель MCP: тёзка из другого воркспейса не находится ни по имени, ни по @username, ни по алиасу", async () => {
  assertEquals(await matchAssigneeInWorkspace(client, "Борис", "a"), null);
  assertEquals(await matchAssigneeInWorkspace(client, "boris_b", "a"), null);
  assertEquals(await matchAssigneeInWorkspace(client, "Боря", "a"), null);
});

Deno.test("исполнитель MCP: у вызывающего нет воркспейса — никто не находится", async () => {
  assertEquals(await matchAssigneeInWorkspace(client, "Анна", null), null);
});
