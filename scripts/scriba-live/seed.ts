// Сид стенда живого прогона бота scriba (T004). Идемпотентный: повторный запуск ничего не
// дублирует и не стирает — встречи прошлых прогонов остаются в очереди вычитки.
//
//   • воркспейс `scriba-live` — стенд, не прод, слаг нейтральный;
//   • владелец встречи — человек стенда, от его имени бот идёт на встречу (он же входит в веб);
//   • служебный агент `scriba` с токеном стенда (в базе только sha256);
//   • бакет meeting-audio под части записи.
//
// Окружение: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAND_OWNER_ID, SCRIBA_BOT_TOKEN.

import { sha256Hex } from "../../supabase/functions/_shared/agent-auth.ts";

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OWNER = Number(Deno.env.get("STAND_OWNER_ID") ?? "0");
const BOT_TOKEN = Deno.env.get("SCRIBA_BOT_TOKEN") ?? "";
const WORKSPACE = "scriba-live";

if (!URL_ || !KEY || !OWNER || !BOT_TOKEN) {
  console.error("СИД НЕ ВЫПОЛНЕН: нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STAND_OWNER_ID / SCRIBA_BOT_TOKEN");
  Deno.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function upsert(table: string, conflict: string, row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${URL_}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
}

await upsert("workspaces", "id", { id: WORKSPACE, name: "Scriba live stand" });
await upsert("allowed_users", "telegram_id", {
  telegram_id: OWNER,
  username: "live_owner",
  group_id: WORKSPACE,
  added_by: OWNER,
  email: "owner@scriba-live.local",
});
await upsert("service_agents", "id", {
  id: "scriba",
  name: "scriba",
  group_id: WORKSPACE,
  token_hash: await sha256Hex(BOT_TOKEN),
  is_active: true,
});

const bucket = await fetch(`${URL_}/storage/v1/bucket`, {
  method: "POST",
  headers,
  body: JSON.stringify({ id: "meeting-audio", name: "meeting-audio", public: false }),
});
const bucketText = await bucket.text();
if (!bucket.ok && !bucketText.includes("already exists") && !bucketText.includes("Duplicate")) {
  throw new Error(`бакет meeting-audio: ${bucket.status} ${bucketText}`);
}

console.log(`сид готов: воркспейс ${WORKSPACE}, владелец ${OWNER}, агент scriba, бакет meeting-audio`);
