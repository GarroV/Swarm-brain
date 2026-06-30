import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

// meeting-status — лёгкий статус-эндпоинт для рекордера. Рекордер держит локальный бэкап
// исходного аудио и удаляет его, КОГДА встреча ОПУБЛИКОВАНА в базу (`status='in_base'` → запись
// уже в команде/личном, аудио больше не нужно), либо по 3-суточному потолку. Отдельно `summary_status`
// нужен рекордеру, чтобы погасить капсулу «в обработке» по готовности транскрипта (`done`), НЕ удаляя
// бэкап. Рекордер спрашивает статус своих встреч пачкой: GET /meeting-status?ids=a,b,c.
//
// Приватность: отдаём статус ТОЛЬКО встреч, которыми владеет вызывающий (claim_owner = он сам) —
// чужие статусы не светим. Auth — персональный токен рекордера (тот же, что claim/ingest).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_IDS = 200;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("OK", { status: 200 });

  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS);
  if (ids.length === 0) return json({ ok: true, statuses: [] });

  // Только встречи вызывающего (claim_owner) — не раскрываем чужие статусы.
  const { data, error } = await supabase
    .from("meetings")
    .select("id, summary_status, status")
    .in("id", ids)
    .eq("claim_owner", identity.telegramId);

  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, statuses: data ?? [] });
});
