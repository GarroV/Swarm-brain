// meeting-invite — оркестратор забирает приглашения бота своего воркспейса (решение D017).
//
// Человек вставляет в вебе ссылку на созвон (swarm-api POST /meeting-invites) — сервер заводит
// одноразовое приглашение. Оркестратор под токеном служебного агента опрашивает этот эндпоинт и
// получает ожидающие приглашения СВОЕГО воркспейса; каждое отдаётся ровно один раз: забор — один
// условный UPDATE (taken_at is null), и два одновременных опроса одну строку не делят.
//
// Дальше оркестратор запускает бота за `invited_by` (X-On-Behalf-Of), и бот предъявляет `id` и
// `join_url` в meeting-claim — там приглашение сверяется и гасится (meeting-claim/agent-scope.ts).
//
// Дверь — resolveServiceAgent: только токен агента, без подмены личности; люди сюда не проходят.
//
// POST, тело необязательно: { "limit"?: 1..20 } (по умолчанию 10).
// 200 { ok: true, invites: [{ id, invited_by, join_url, platform, created_at, expires_at }] }
// 401 не агент · 403 X-On-Behalf-Of или агент без воркспейса · 405 не POST.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Деплой: supabase functions deploy meeting-invite --no-verify-jwt (бот хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveServiceAgent } from "../_shared/agent-auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const COLUMNS = "id, invited_by, join_url, platform, created_at, expires_at";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readLimit(req: Request): Promise<number> {
  const text = await req.text();
  if (text.trim() === "") return DEFAULT_LIMIT;
  const raw = (JSON.parse(text) as { limit?: unknown }).limit;
  if (raw === undefined) return DEFAULT_LIMIT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) throw new Error("limit must be a positive integer");
  return Math.min(raw, MAX_LIMIT);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let agent: { agentId: string; groupId: string };
  try {
    agent = await resolveServiceAgent(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  let limit: number;
  try {
    limit = await readLimit(req);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "invalid body" }, 400);
  }

  const nowIso = new Date().toISOString();
  // Кандидаты — старые первыми; забор ниже перепроверяет те же условия под блокировкой строки.
  const { data: pending, error: listErr } = await supabase
    .from("meeting_invites")
    .select("id")
    .eq("group_id", agent.groupId)
    .is("taken_at", null)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (listErr) return json({ ok: false, error: `list failed: ${listErr.message}` }, 500);
  const ids = (pending ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return json({ ok: true, invites: [] });

  const { data: taken, error: takeErr } = await supabase
    .from("meeting_invites")
    .update({ taken_at: nowIso, taken_by: agent.agentId })
    .in("id", ids)
    .eq("group_id", agent.groupId)
    .is("taken_at", null)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select(COLUMNS);
  if (takeErr) return json({ ok: false, error: `take failed: ${takeErr.message}` }, 500);

  const invites = ((taken ?? []) as Array<{ created_at: string }>)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  console.log(`meeting-invite: агент ${agent.agentId} (${agent.groupId}) забрал ${invites.length}`);
  return json({ ok: true, invites });
});
