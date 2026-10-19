// get_tasks на настоящей базе: задачи закрытого проекта не уходят тому, кто не видит проект
// (решение владельца 16.10.2026). Проверяет, что инструмент передаёт зрителя в выборку.
import { assert } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { toolGetTasks } from "./tools.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WS = "qa-get-tasks-pprivacy";
const AUTHOR = 990_021;
const MEMBER = 990_022;

async function wipe() {
  await sb.from("tasks").delete().eq("group_id", WS);
  await sb.from("projects").delete().eq("group_id", WS);
  await sb.from("allowed_users").delete().in("telegram_id", [AUTHOR, MEMBER]);
  await sb.from("workspaces").delete().eq("id", WS);
}

Deno.test("get_tasks: задача закрытого проекта видна автору проекта и не видна участнику", async () => {
  await wipe();
  try {
    await sb.from("workspaces").insert({ id: WS, name: "QA privacy" });
    for (const id of [AUTHOR, MEMBER]) {
      await sb.from("allowed_users").insert({ telegram_id: id, group_id: WS, added_by: AUTHOR, is_admin: false });
    }
    const { data: p, error } = await sb.from("projects")
      .insert({ group_id: WS, name: "QA закрытый", created_by: AUTHOR, is_private: true })
      .select("id").single();
    if (error) throw new Error(error.message);
    await sb.from("tasks").insert([
      {
        title: "QA секретная задача",
        status: "open",
        group_id: WS,
        project_id: p.id,
        created_by: "qa",
        confirmed: true,
      },
      { title: "QA общая задача", status: "open", group_id: WS, created_by: "qa", confirmed: true },
    ]);

    const member = await toolGetTasks({ requesting_user_id: MEMBER });
    assert(member.includes("QA общая задача"), member);
    assert(!member.includes("QA секретная задача"), member);

    const author = await toolGetTasks({ requesting_user_id: AUTHOR });
    assert(author.includes("QA секретная задача"), author);
  } finally {
    await wipe();
  }
});
