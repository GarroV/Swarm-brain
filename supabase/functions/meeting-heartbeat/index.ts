// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем. См. _shared/agent-auth.ts.
// Heartbeat рекордера. Рекордер раз в ~15 мин (maintenanceTick) шлёт «я жив» + статус записи +
// версию. Пишет allowed_users.recorder_last_{seen,recording,version}. Watchdog checkRecorderHealth
// (swarm-bot) читает эти поля для двух сигналов: «оборванная запись» и «токен истекает».
// Данные наружу НЕ отдаёт — только 200/ok.
//
// С 04.09.2026 heartbeat несёт ещё два факта — для `ON AIR` в панели «Встречи сегодня»
// (docs/decisions/2026-09-04-on-air-v-panele-vstrech.md):
//   • on_call     — идёт реальный созвон (вход микрофона держит другое приложение). В звонке
//                   можно сидеть без записи, поэтому это ОТДЕЛЬНЫЙ факт от recording;
//   • meeting_key — какую встречу рекордер при этом видит («<uid>:<дата>» из meeting-current).
// Пока звонок идёт, рекордер шлёт keep-alive чаще (2 мин) — панель считает присутствие живым
// пять минут, дальше гасит.
//
// Auth: resolveActingIdentity принимает recorder_token_hash ИЛИ claude_mcp_token_hash человека
// (см. _shared/agent-auth), а также токен служебного агента с заголовком X-On-Behalf-Of.
// Heartbeat агента при этом ложится в ЕГО строку service_agents, а не в строку человека:
// иначе watchdog решил бы, что у человека работает рекордер, и погасил бы настоящий сигнал.
// Деплой: supabase functions deploy meeting-heartbeat --no-verify-jwt (рекордер хитит с Bearer-токеном).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveActingIdentity } from "../_shared/agent-auth.ts";
import { buildHeartbeatWrite, type HeartbeatBody } from "./write.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  let identity;
  try {
    identity = await resolveActingIdentity(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) {
      return json({ error: e.message }, e.status);
    }
    throw e;
  }

  let body: HeartbeatBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const write = buildHeartbeatWrite(identity, body, new Date().toISOString());
  const { error } = await supabase
    .from(write.table)
    .update(write.patch)
    .eq(write.matchColumn, write.matchValue);
  if (error) return json({ error: "update failed" }, 500);
  return json({ ok: true });
});
