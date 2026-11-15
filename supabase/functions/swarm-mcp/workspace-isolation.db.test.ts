// Сквозная изоляция пространств в MCP. Изоляция держится ручными `.eq("group_id")` под
// service_role (RLS не защищает), поэтому одной проверки «в этом инструменте фильтр есть» мало:
// этот тест гонит через настоящий обработчик tools/call КАЖДЫЙ читающий инструмент из tools/list
// (список берётся из реестра, а не руками — новый читающий инструмент без фильтра попадает под
// тест сам) токеном человека из пространства А и ищет в ответах метку данных пространства Б.
// Контроль: тот же прогон токеном человека из Б метку находит (иначе «чисто» ничего не значит).
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
}
// index.ts сам вызывает Deno.serve — перехватываем обработчик вместо запуска сервера.
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any -- подмена перегруженной сигнатуры на время импорта
(Deno as any).serve = (h: Handler) => {
  handler = h;
  return { shutdown: () => Promise.resolve(), finished: Promise.resolve() };
};
await import("./index.ts");
Deno.serve = realServe;
const { mintMcpToken } = await import("../_shared/mcp-token.ts");

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WS_A = "qa-mcp-iso-a";
const WS_B = "qa-mcp-iso-b";
const USER_A = 990_311;
const USER_B = 990_312;
// Метка лежит ТОЛЬКО в данных Б; значения, которые подставляются в аргументы, её не содержат —
// иначе инструмент, повторивший запрос в ответе, дал бы ложное срабатывание.
const MARK = "QAISO-B-DATA";
const PROBE = "QAISO-B";

async function wipe() {
  for (const ws of [WS_A, WS_B]) {
    const { data: tasks } = await sb.from("tasks").select("id").eq("group_id", ws);
    const ids = (tasks ?? []).map((t) => t.id);
    if (ids.length) await sb.from("task_comments").delete().in("task_id", ids);
    await sb.from("tasks").delete().eq("group_id", ws);
    await sb.from("entries").delete().eq("group_id", ws);
    await sb.from("task_labels").delete().eq("group_id", ws);
    await sb.from("sprints").delete().eq("group_id", ws);
    await sb.from("projects").delete().eq("group_id", ws);
  }
  await sb.from("feedback").delete().in("telegram_id", [USER_A, USER_B]);
  await sb.from("allowed_users").delete().in("telegram_id", [USER_A, USER_B]);
  await sb.from("workspaces").delete().in("id", [WS_A, WS_B]);
}

function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error || r.data === null || r.data === undefined) throw new Error(`${what}: ${r.error?.message}`);
  return r.data as NonNullable<T>;
}

async function seed() {
  await wipe();
  must(
    await sb.from("workspaces").insert([{ id: WS_A, name: "QA iso A" }, { id: WS_B, name: "QA iso B" }]).select(),
    "ws",
  );
  must(
    await sb.from("allowed_users").insert([
      { telegram_id: USER_A, group_id: WS_A, added_by: USER_A, username: "qa_iso_a" },
      { telegram_id: USER_B, group_id: WS_B, added_by: USER_B, username: `qa_iso_${MARK.toLowerCase()}` },
    ]).select(),
    "users",
  );
  const today = new Date().toISOString().slice(0, 10);
  const entries = must(
    await sb.from("entries").insert([
      {
        content: `${MARK} заметка пространства Б`,
        group_id: WS_B,
        owner_id: USER_B,
        is_private: false,
        entry_date: today,
      },
      {
        content: `${MARK} встреча пространства Б`,
        source: "desktop-agent",
        entry_type: "meeting",
        group_id: WS_B,
        owner_id: USER_B,
        is_private: false,
        entry_date: today,
        summary: MARK,
      },
    ]).select("id"),
    "entries",
  );
  const task = must(
    await sb.from("tasks").insert({ title: `${MARK} задача`, group_id: WS_B, confirmed: true, status: "open" }).select(
      "id",
    ).single(),
    "task",
  );
  must(
    await sb.from("task_comments").insert({ task_id: task.id, content: `${MARK} комментарий`, added_by: "qa" })
      .select(),
    "comment",
  );
  must(await sb.from("task_labels").insert({ group_id: WS_B, owner_id: USER_B, name: MARK }).select(), "label");
  must(await sb.from("projects").insert({ group_id: WS_B, name: MARK, created_by: USER_B }).select(), "project");
  const sprint = must(
    await sb.from("sprints").insert({ group_id: WS_B, name: MARK, start_date: today, end_date: today }).select("id")
      .single(),
    "sprint",
  );
  must(await sb.from("feedback").insert({ telegram_id: USER_B, text: `${MARK} отзыв` }).select(), "feedback");
  return {
    entryId: entries[0].id as string,
    meetingId: entries[1].id as string,
    taskId: task.id as string,
    sprintId: sprint.id as string,
  };
}

// Обязательные аргументы: идентификаторы — объекты пространства Б (чужие id тоже не должны открываться),
// остальное — нейтральная строка без метки.
function fillArgs(
  required: string[],
  ids: { entryId: string; meetingId: string; taskId: string; sprintId: string },
): Record<string, unknown> {
  const byName: Record<string, string> = {
    query: PROBE,
    id: ids.entryId,
    task_id: ids.taskId,
    meeting_id: ids.meetingId,
    sprint_id: ids.sprintId,
    space: PROBE,
    country: "RS",
    section: "overview",
  };
  return Object.fromEntries(required.map((name) => [name, byName[name] ?? PROBE]));
}

async function rpc(token: string, method: string, params?: Record<string, unknown>) {
  const res = await handler!(
    new Request("http://mcp.test/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return await res.json() as {
    result?: {
      tools?: { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { required?: string[] } }[];
      content?: { text: string }[];
    };
    error?: { code: number; message: string };
  };
}

async function sweep(token: string, ids: Awaited<ReturnType<typeof seed>>) {
  const listed = await rpc(token, "tools/list");
  const readTools = (listed.result?.tools ?? []).filter((t) => t.annotations.readOnlyHint);
  const seen: Record<string, string> = {};
  for (const tool of readTools) {
    const answer = await rpc(token, "tools/call", {
      name: tool.name,
      arguments: fillArgs(tool.inputSchema.required ?? [], ids),
    });
    seen[tool.name] = JSON.stringify(answer);
  }
  return { readTools: readTools.map((t) => t.name), seen };
}

Deno.test("MCP: читающие инструменты не отдают данные чужого пространства", async () => {
  assert(handler, "обработчик MCP не перехвачен");
  try {
    const ids = await seed();
    const tokenA = (await mintMcpToken(sb, USER_A, { via: "web" }))!.token;
    const tokenB = (await mintMcpToken(sb, USER_B, { via: "web" }))!.token;

    // Контроль: свои данные человек из Б видит — метка в ответах находима.
    const own = await sweep(tokenB, ids);
    const ownHits = Object.entries(own.seen).filter(([, text]) => text.includes(MARK)).map(([name]) => name);
    assert(ownHits.length >= 5, `контроль: метка Б должна находиться в ответах Б, нашлась в: ${ownHits.join(", ")}`);

    // Опыт: человек из А.
    const foreign = await sweep(tokenA, ids);
    assert(
      foreign.readTools.length >= 20,
      `реестр дал слишком мало читающих инструментов: ${foreign.readTools.length}`,
    );
    assertEquals(foreign.readTools.sort(), own.readTools.sort());
    const leaks = Object.entries(foreign.seen).filter(([, text]) => text.includes(MARK)).map(([name]) => name);
    assertEquals(leaks, [], `данные пространства Б видны человеку из А через: ${leaks.join(", ")}`);
  } finally {
    await wipe();
  }
});
