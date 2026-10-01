// read-ai-auth — точка входа. Логика и выключатель — в handler.ts.
// Включение: READ_AI_AUTH_ENABLED=true (по умолчанию функция отвечает 403 на всё).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleReadAiAuth, type ReadAiAuthStore } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/read-ai-auth`;

const store: ReadAiAuthStore = {
  async getClientId() {
    const { data } = await supabase.from("oauth_tokens").select("client_id").eq("service", "read_ai").maybeSingle();
    return data?.client_id ?? null;
  },
  async saveClientId(clientId) {
    const { error } = await supabase.from("oauth_tokens").upsert({ service: "read_ai", client_id: clientId });
    if (error) throw new Error(`oauth_tokens upsert: ${error.message}`);
  },
  async saveState(row) {
    const { error } = await supabase.from("oauth_state").insert(row);
    if (error) throw new Error(`oauth_state insert: ${error.message}`);
  },
  async takeState(state) {
    const { data, error } = await supabase.from("oauth_state").delete().eq("state", state)
      .select("client_id, code_verifier, created_at").maybeSingle();
    if (error) throw new Error(`oauth_state take: ${error.message}`);
    return data ?? null;
  },
  async saveToken(row) {
    const { error } = await supabase.from("oauth_tokens").upsert(row);
    if (error) throw new Error(`oauth_tokens upsert: ${error.message}`);
  },
};

Deno.serve(async (req: Request) => {
  try {
    return await handleReadAiAuth(req, {
      enabled: Deno.env.get("READ_AI_AUTH_ENABLED") === "true",
      clientId: Deno.env.get("READ_AI_CLIENT_ID"),
      redirectUri: REDIRECT_URI,
      now: () => Date.now(),
      store,
      fetch,
    });
  } catch (e) {
    console.error("read-ai-auth:", e instanceof Error ? e.message : e);
    return new Response("Internal error", { status: 500 });
  }
});
