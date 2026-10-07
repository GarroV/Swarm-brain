// Кто может принимать решения рынка по токену: только админ своим действующим MCP-токеном.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../_shared/agent-auth.ts";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) {
    throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
  }
}
const { findAdminByMcpToken } = await import("./index.ts");
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MEMBER = 990_101, ADMIN = 990_102, EXPIRED = 990_103;
const WS = "demo";
const tok = (id: number) => `smcp_test${id}`;

Deno.test("only an admin's live MCP token decides; member, expired, recorder and unknown tokens do not", async () => {
  const ids = [MEMBER, ADMIN, EXPIRED];
  await sb.from("allowed_users").delete().in("telegram_id", ids);
  const past = new Date(Date.now() - 60_000).toISOString();
  const { error } = await sb.from("allowed_users").insert([
    {
      telegram_id: MEMBER,
      group_id: WS,
      added_by: ADMIN,
      is_admin: false,
      claude_mcp_token_hash: await sha256Hex(tok(MEMBER)),
    },
    {
      telegram_id: ADMIN,
      group_id: WS,
      added_by: ADMIN,
      is_admin: true,
      claude_mcp_token_hash: await sha256Hex(tok(ADMIN)),
      recorder_token_hash: await sha256Hex("smcp_rec"),
    },
    {
      telegram_id: EXPIRED,
      group_id: WS,
      added_by: ADMIN,
      is_admin: true,
      claude_mcp_token_hash: await sha256Hex(tok(EXPIRED)),
      claude_mcp_token_expires_at: past,
    },
  ]);
  if (error) throw new Error(error.message);
  try {
    assertEquals(await findAdminByMcpToken(tok(ADMIN)), ADMIN);
    assertEquals(await findAdminByMcpToken(tok(MEMBER)), null);
    assertEquals(await findAdminByMcpToken(tok(EXPIRED)), null);
    // токен рекордера админа — не MCP-токен, решений не даёт
    assertEquals(await findAdminByMcpToken("smcp_rec"), null);
    assertEquals(await findAdminByMcpToken("smcp_unknown"), null);
    assertEquals(await findAdminByMcpToken("not-a-token"), null);
  } finally {
    await sb.from("allowed_users").delete().in("telegram_id", ids);
  }
});
