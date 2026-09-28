// meeting-invite — оркестратор забирает приглашения бота своего воркспейса (решение D017).
//
// Человек вставляет в вебе ссылку на созвон (swarm-api POST /meeting-invites) — сервер заводит
// одноразовое приглашение. Оркестратор под токеном служебного агента опрашивает этот эндпоинт и
// получает ожидающие приглашения СВОЕГО воркспейса; каждое отдаётся ровно один раз: забор — один
// условный UPDATE (taken_at is null), и два одновременных опроса одну строку не делят.
//
// К каждому приглашению сервер выдаёт пропуск бота на эту встречу (`grant_token`, T165,
// _shared/agent-grant.ts): за `invited_by` бот ходит только с ним, общий токен агента за человека
// не действует. Бот предъявляет `id` и `join_url` в meeting-claim — там приглашение сверяется с
// пропуском и гасится (meeting-claim/agent-scope.ts). Пропуск не выдался — приглашения возвращаются
// в очередь, а не теряются.
//
// Дверь — resolveServiceAgent: только токен агента, без подмены личности; люди сюда не проходят.
//
// POST, тело необязательно: { "limit"?: 1..20 } (по умолчанию 10).
// 200 { ok: true, invites: [{ id, invited_by, join_url, platform, created_at, expires_at, grant_token }] }
// 401 не агент · 403 X-On-Behalf-Of или агент без воркспейса · 405 не POST · 500 сбой базы.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Деплой: supabase functions deploy meeting-invite --no-verify-jwt (бот хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveServiceAgent } from "../_shared/agent-auth.ts";
import { mintGrants } from "../_shared/agent-grant.ts";

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

  type Taken = { id: string; invited_by: number; join_url: string; created_at: string };
  const invites = ((taken ?? []) as Taken[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  let tokens: string[];
  try {
    tokens = await mintGrants(
      supabase,
      invites.map((i) => ({
        agentId: agent.agentId,
        groupId: agent.groupId,
        telegramId: i.invited_by,
        joinUrl: i.join_url,
        inviteId: i.id,
      })),
      Date.now(),
    );
  } catch (e) {
    // Приглашение без пропуска боту бесполезно: вернуть в очередь, следующий опрос заберёт снова.
    console.error(`meeting-invite: пропуска не выданы: ${e instanceof Error ? e.message : String(e)}`);
    const { error: backErr } = await supabase.from("meeting_invites")
      .update({ taken_at: null, taken_by: null })
      .in("id", invites.map((i) => i.id))
      .eq("taken_by", agent.agentId);
    if (backErr) console.error(`meeting-invite: приглашения не вернулись в очередь: ${backErr.message}`);
    return json({ ok: false, error: "grant issue failed" }, 500);
  }
  console.log(`meeting-invite: агент ${agent.agentId} (${agent.groupId}) забрал ${invites.length}`);
  return json({ ok: true, invites: invites.map((i, n) => ({ ...i, grant_token: tokens[n] })) });
});
