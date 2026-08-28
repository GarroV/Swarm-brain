// Прогон сценария перевыпуска токена рекордера против ЖИВОЙ локальной базы.
// В CI не гоняется намеренно — нужна поднятая база (имя файла без *_test.ts, чтобы deno task test
// его не подхватывал). Запуск:
//
//   supabase start && supabase db reset --local
//   SB_URL=http://127.0.0.1:54321 SB_KEY=<SERVICE_ROLE_KEY из supabase status> \
//     deno run -A scripts/recorder-token-grace-e2e.ts
//
// Проверяет ровно то, что ломалось у людей: старый токен не умирает в момент перевыпуска,
// а перестаёт работать, как только заработал новый.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintRecorderToken, revokeRecorderToken } from "../supabase/functions/_shared/recorder-token.ts";
import { verifyAgentToken, AgentAuthError } from "../supabase/functions/_shared/agent-auth.ts";

const url = Deno.env.get("SB_URL")!;
const key = Deno.env.get("SB_KEY")!;
const supabase = createClient(url, key);
const TG = -777001;

const req = (token: string) => new Request("https://x/", { headers: { Authorization: `Bearer ${token}` } });
async function auth(token: string): Promise<string> {
  try {
    const id = await verifyAgentToken(supabase, req(token));
    return `ok(${id.telegramId})`;
  } catch (e) {
    return e instanceof AgentAuthError ? `401` : `err:${e}`;
  }
}
const prevHash = async () => {
  const { data } = await supabase.from("allowed_users").select("recorder_token_prev_hash").eq("telegram_id", TG).maybeSingle();
  return (data as { recorder_token_prev_hash: string | null } | null)?.recorder_token_prev_hash ?? null;
};

await supabase.from("allowed_users").delete().eq("telegram_id", TG);
await supabase.from("allowed_users").insert({ telegram_id: TG, username: "grace_test", group_id: "cee", added_by: 744230399 });

const a = (await mintRecorderToken(supabase, TG))!;
console.log("1. первый токен выдан           →", await auth(a.token));

const b = (await mintRecorderToken(supabase, TG))!;
console.log("2. перевыпуск: старый ещё жив   →", await auth(a.token), "| перекрытие в базе:", (await prevHash()) ? "есть" : "нет");

console.log("3. вход НОВЫМ токеном           →", await auth(b.token), "| перекрытие после:", (await prevHash()) ? "есть" : "снято");
console.log("4. старый токен после этого     →", await auth(a.token));

const c = (await mintRecorderToken(supabase, TG))!;
await supabase.from("allowed_users")
  .update({ recorder_token_prev_expires_at: new Date(Date.now() - 60_000).toISOString() })
  .eq("telegram_id", TG);
console.log("5. перекрытие истекло           →", await auth(b.token));

await supabase.from("allowed_users").update({ recorder_token_prev_hash: "x".repeat(64), recorder_token_prev_expires_at: new Date(Date.now() + 3600_000).toISOString() }).eq("telegram_id", TG);
console.log("6. отзыв гасит и перекрытие     →", await revokeRecorderToken(supabase, TG) ? "выполнен" : "ошибка", "| текущий токен:", await auth(c.token), "| перекрытие:", (await prevHash()) ? "ОСТАЛОСЬ ❌" : "снято");

await supabase.from("allowed_users").delete().eq("telegram_id", TG);
console.log("тестовый пользователь убран");
