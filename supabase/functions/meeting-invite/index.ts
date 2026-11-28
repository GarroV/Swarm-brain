// meeting-invite — оркестратор забирает приглашения бота своего воркспейса (решение D017).
//
// Человек вставляет в вебе ссылку на созвон (swarm-api POST /meeting-invites) — сервер заводит
// одноразовое приглашение. После внутреннего push оркестратор под токеном служебного агента вызывает этот эндпоинт и
// получает ожидающие приглашения СВОЕГО воркспейса; каждое отдаётся ровно один раз: забор — один
// условный UPDATE; повтор того же агента продолжает неподтверждённый старт, другой агент строку не получает.
//
// К каждому приглашению сервер выдаёт пропуск бота на эту встречу (`grant_token`, T165,
// _shared/agent-grant.ts): за `invited_by` бот ходит только с ним, общий токен агента за человека
// не действует. Бот предъявляет `id` и `join_url` в meeting-claim — там приглашение сверяется с
// пропуском и гасится (meeting-claim/agent-scope.ts). Пропуск не выдался — приглашения возвращаются
// в повторяемом намерении, а не теряются.
//
// Дверь — resolveServiceAgent: только токен агента, без подмены личности; люди сюда не проходят.
//
// POST {id: uuid, started?: true}; started confirms durable container creation.
// No polling: the signal carries the exact job id. A terminal replay returns an empty list.
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
import { acknowledgeSignalWork, parseWorkRequest, takeSignalWork } from "../_shared/scriba-work.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

  let work: { id: string; started: boolean };
  try {
    work = parseWorkRequest(await req.json());
  } catch {
    return json({ ok: false, error: "id is required" }, 400);
  }
  let invites: Array<
    { id: string; invited_by: number; join_url: string; platform: string; created_at: string; expires_at: string }
  >;
  try {
    if (work.started) {
      const ok = await acknowledgeSignalWork(supabase, "invite", work.id, agent);
      return json({ ok, invites: [] }, ok ? 200 : 409);
    }
    const result = await takeSignalWork(supabase, "invite", work.id, agent);
    if (result.state === "busy" || result.state === "not_due") return json({ ok: false, error: result.state }, 409);
    if (result.state !== "taken") return json({ ok: true, invites: [], terminal: true });
    const row = result.job!;
    invites = [{
      id: String(row.id),
      invited_by: Number(row.invited_by),
      join_url: String(row.join_url),
      platform: String(row.platform),
      created_at: String(row.created_at),
      expires_at: String(row.expires_at),
    }];
  } catch {
    return json({ ok: false, error: "work take failed" }, 503);
  }
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
  } catch {
    // Leave the same-agent resumable reservation intact. A retry mints the grant again.
    console.error("meeting-invite: grant issue failed; signal will retry");
    return json({ ok: false, error: "grant issue failed" }, 500);
  }
  console.log(`meeting-invite: агент ${agent.agentId} (${agent.groupId}) забрал ${invites.length}`);
  return json({ ok: true, invites: invites.map((i, n) => ({ ...i, grant_token: tokens[n] })) });
});
