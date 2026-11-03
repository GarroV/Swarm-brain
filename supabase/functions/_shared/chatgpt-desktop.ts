import { logAccess } from "./access-events.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildChatGptSetupOneLiner } from "./chatgpt-setup-script.ts";
import { sha256Hex } from "./mcp-setup-script.ts";
import { mcpTokenExpiry } from "./mcp-token.ts";
import { apiErr, json } from "../swarm-api/http.ts";

export async function handleChatGptDesktop(
  req: Request,
  path: string,
  ctx: { supabase: SupabaseClient; telegramId: number; isDemo: boolean; renewableSession: boolean; origin: string },
): Promise<Response | null> {
  if (path !== "/mcp/desktop/setup" && path !== "/mcp/desktop/token") return null;
  const { supabase, telegramId, isDemo, origin } = ctx;
  if (isDemo) return apiErr(403, "Connections cannot be created in the demo", origin);
  if (!ctx.renewableSession) return apiErr(403, "Sign in to Swarm with a full web session", origin);
  if (path.endsWith("/setup") && req.method === "GET") {
    const { data, error } = await supabase.from("allowed_users")
      .select("chatgpt_mcp_token_hash,chatgpt_mcp_token_expires_at,chatgpt_mcp_last_seen_at")
      .eq("telegram_id", telegramId).maybeSingle();
    if (error || !data) return apiErr(500, "Could not read connection status", origin);
    return json(
      {
        active: !!data.chatgpt_mcp_token_hash && Date.parse(data.chatgpt_mcp_token_expires_at ?? "") > Date.now(),
        expiresAt: data.chatgpt_mcp_token_expires_at,
        lastSeenAt: data.chatgpt_mcp_last_seen_at,
      },
      200,
      origin,
    );
  }
  if (path.endsWith("/token") && req.method === "POST") {
    const token = "smcp_gpt_" + crypto.randomUUID().replaceAll("-", "");
    const { data, error } = await supabase.from("allowed_users").update({
      chatgpt_mcp_token_hash: await sha256Hex(token),
      chatgpt_mcp_token_expires_at: mcpTokenExpiry(),
      chatgpt_mcp_last_seen_at: null,
    }).eq("telegram_id", telegramId).select("telegram_id").maybeSingle();
    if (error || !data) return apiErr(500, "Could not create connection", origin);
    await logAccess(supabase, telegramId, "mcp_token_issued", { via: "chatgpt-desktop", req });
    const response = json({ oneLiner: await buildChatGptSetupOneLiner(token) }, 200, origin);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (path.endsWith("/token") && req.method === "DELETE") {
    const { error } = await supabase.from("allowed_users").update({
      chatgpt_mcp_token_hash: null,
      chatgpt_mcp_token_expires_at: null,
      chatgpt_mcp_last_seen_at: null,
    }).eq("telegram_id", telegramId);
    if (error) return apiErr(500, "Could not disconnect", origin);
    await logAccess(supabase, telegramId, "mcp_token_revoked", { via: "chatgpt-desktop", req });
    return json({ ok: true }, 200, origin);
  }
  return apiErr(405, "Method not allowed", origin);
}
