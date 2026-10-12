// Журнал событий доступа (#797): выпуск и отзыв токенов пишутся сами, вход — один раз на сессию,
// а сбой журнала не роняет выпуск токена.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) {
    throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
  }
}
const { logAccess } = await import("./access-events.ts");
const { mintMcpToken } = await import("./mcp-token.ts");
const { mintRecorderToken, revokeRecorderToken } = await import("./recorder-token.ts");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const USER = 990_201;

async function events(kind?: string) {
  let q = sb.from("access_events").select("kind, via, ip, country, session_auth_time").eq("telegram_id", USER);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q.order("id");
  if (error) throw error;
  return data ?? [];
}

async function reset() {
  await sb.from("access_events").delete().eq("telegram_id", USER);
  await sb.from("allowed_users").delete().eq("telegram_id", USER);
  const { error } = await sb.from("allowed_users").insert({ telegram_id: USER, group_id: "demo", added_by: USER });
  if (error) throw error;
}

Deno.test("выпуск и отзыв токенов попадают в журнал с каналом и адресом запроса", async () => {
  await reset();
  const req = new Request("https://x/", {
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "cf-ipcountry": "RS" },
  });
  assertEquals((await mintMcpToken(sb, USER, { via: "web", req })) !== null, true);
  assertEquals((await mintRecorderToken(sb, USER, 365, { via: "bot" })) !== null, true);
  assertEquals(await revokeRecorderToken(sb, USER, { via: "bot" }), true);

  assertEquals(await events(), [
    { kind: "mcp_token_issued", via: "web", ip: "203.0.113.7, 10.0.0.1", country: "RS", session_auth_time: null },
    { kind: "recorder_token_issued", via: "bot", ip: null, country: null, session_auth_time: null },
    { kind: "recorder_token_revoked", via: "bot", ip: null, country: null, session_auth_time: null },
  ]);
});

Deno.test("вход пишется один раз на сессию, новая сессия — новая запись", async () => {
  await reset();
  await logAccess(sb, USER, "web_login", { via: "web" }, 1_700_000_000);
  await logAccess(sb, USER, "web_login", { via: "web" }, 1_700_000_000);
  await logAccess(sb, USER, "web_login", { via: "web" }, 1_700_000_500);
  assertEquals((await events("web_login")).map((e) => e.session_auth_time), [1_700_000_000, 1_700_000_500]);
});

Deno.test("сбой журнала не роняет вызывающего", async () => {
  // Неизвестный вид события отбивает CHECK — logAccess обязан проглотить ошибку, а не бросить.
  // deno-lint-ignore no-explicit-any
  await logAccess(sb, USER, "no_such_kind" as any, { via: "web" });
});
