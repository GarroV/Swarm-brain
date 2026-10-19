// auth-passkey — проверка ключа доступа для CF Pages (второй шаг входа, #955). Логика — handler.ts.
// Деплой: verify_jwt = false в supabase/config.toml (вызов подписан HMAC, не JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseStore } from "../_shared/passkeys/store.ts";
import { handlePasskeyRequest } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const store = supabaseStore(supabase);
const secret = Deno.env.get("WEB_JWT_SECRET") ?? "";

async function userNameOf(telegramId: number): Promise<string | null> {
  const { data, error } = await supabase.from("allowed_users").select("email, username").eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw new Error(`auth-passkey: allowed_users: ${error.message}`);
  if (!data) return null;
  const row = data as { email?: string | null; username?: string | null };
  return row.email ?? row.username ?? String(telegramId);
}

Deno.serve(async (req: Request) => {
  try {
    return await handlePasskeyRequest(req, { store, secret, userNameOf });
  } catch (e) {
    // Подробность — в лог, наружу — общий текст (как у остальных функций: ошибка базы не утекает).
    console.error("auth-passkey:", e);
    return new Response(JSON.stringify({ error: "server" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
