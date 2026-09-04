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
// Auth: verifyAgentToken принимает recorder_token_hash ИЛИ claude_mcp_token_hash (см. _shared/agent-auth).
// Деплой: supabase functions deploy meeting-heartbeat --no-verify-jwt (рекордер хитит с Bearer-токеном).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ error: e.message }, 401);
    throw e;
  }

  let body: { recording?: unknown; version?: unknown; on_call?: unknown; meeting_key?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const recording = body.recording === true;
  const version = typeof body.version === "number" ? body.version : null;
  const onCall = body.on_call === true;
  const rawKey = typeof body.meeting_key === "string" ? body.meeting_key.trim() : "";
  // Ключ держим только пока человек в звонке (или мы пишем). Иначе он завис бы после
  // созвона и панель показывала бы ON AIR на давно закончившейся встрече.
  const meetingKey = (onCall || recording) && rawKey ? rawKey : null;

  const { error } = await supabase.from("allowed_users").update({
    recorder_last_seen: new Date().toISOString(),
    recorder_last_recording: recording,
    recorder_last_version: version,
    recorder_last_on_call: onCall,
    recorder_last_meeting_key: meetingKey,
  }).eq("telegram_id", identity.telegramId);
  if (error) return json({ error: "update failed" }, 500);
  return json({ ok: true });
});
