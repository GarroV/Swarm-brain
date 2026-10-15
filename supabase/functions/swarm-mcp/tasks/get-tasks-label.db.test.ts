// get_tasks с неизвестным списком (личной меткой) на настоящей базе: отказ со списком своих
// списков, а не молча снятый фильтр и вся доска (issue #886).
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { toolGetTasks } from "./tools.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WS = "qa-get-tasks-label";
const USER = 990_011;
const LABEL = "QA Список 2025";

async function wipe() {
  await sb.from("task_labels").delete().eq("owner_id", USER);
  await sb.from("allowed_users").delete().eq("telegram_id", USER);
  await sb.from("workspaces").delete().eq("id", WS);
}

Deno.test("get_tasks: неизвестный список — отказ со списком своих, известный — выдача", async () => {
  await wipe();
  try {
    await sb.from("workspaces").insert({ id: WS, name: "QA get_tasks label" });
    await sb.from("allowed_users").insert({ telegram_id: USER, group_id: WS, added_by: USER, is_admin: false });
    await sb.from("task_labels").insert({ owner_id: USER, group_id: WS, name: LABEL, icon: "tag" });

    const refused = await toolGetTasks({ label: "QA Список", requesting_user_id: USER });
    assert(refused.includes("не найден"), refused);
    assert(refused.includes("НЕ применён"), refused);
    assert(refused.includes(LABEL), refused);

    const ok = await toolGetTasks({ label: LABEL.toUpperCase(), requesting_user_id: USER });
    assert(!ok.includes("НЕ применён"), ok);
  } finally {
    await wipe();
  }
});
