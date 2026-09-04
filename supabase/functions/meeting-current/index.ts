// «Какая встреча идёт сейчас» для рекордера — по серверной Google-интеграции.
// Agent-токен (smcp_) → telegram_id → refresh_token из user_integrations → access_token →
// Google Calendar API (события now−2мин…now+LOOKAHEAD_MIN) → идущее событие → идентичность для claim.
// Рекордеру не нужен ни macOS-Календарь, ни доступ к календарю на маке.
//
// Деплой: supabase functions deploy meeting-current --no-verify-jwt (хитит рекордер с Bearer smcp_).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";
import { type GEvent, pickCurrentEvent } from "./select.ts";
import { joinLink } from "./join-link.ts";
// Обмен refresh→access и запрос событий — общий модуль (его же зовёт swarm-api для панели
// «Встречи сегодня», issue #218). Здесь своей копии больше нет.
import { accessToken, listEvents } from "../_shared/google-calendar.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// За сколько минут до начала встреча считается «предстоящей» и рекордер предлагает запись.
const LOOKAHEAD_MIN = 5;
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

  const { data } = await supabase.from("user_integrations")
    .select("api_key").eq("telegram_id", identity.telegramId).eq("service", "google_calendar").maybeSingle();
  const refresh = (data as { api_key?: string } | null)?.api_key;
  if (!refresh) return json({ meeting: null, reason: "google_not_connected" });

  const token = await accessToken(refresh);
  if (!token) return json({ meeting: null, reason: "token_refresh_failed" });

  const now = new Date();
  // Окно: чуть назад (идущая) + вперёд на LOOKAHEAD_MIN (предстоящая, для упреждающего «через N мин»).
  // Порог упреждения задаёт ТОЛЬКО сервер: рекордер показывает «через N мин» по тому, что пришло
  // (AppDelegate.swift, meetingSubtitle) — своего порога у него нет. Было 10 мин, с 04.09.2026 — 5
  // (решение владельца: «есть запрос на уведомление о встрече за 5 минут, а не за десять»).
  const timeMin = new Date(now.getTime() - 2 * 60_000).toISOString();
  const timeMax = new Date(now.getTime() + LOOKAHEAD_MIN * 60_000).toISOString();
  const items = await listEvents(token, timeMin, timeMax, 10);
  if (!items) return json({ meeting: null, reason: "calendar_api_error" });
  // Выбор события среди перекрывающихся — скоринг по RSVP/организатору/плотности (см. select.ts).
  // Фаза B (привязка по ссылке комнаты) ляжет поверх коротким замыканием при room-match.
  const ev = pickCurrentEvent(items, now.getTime());
  if (!ev) return json({ meeting: null, reason: "no_ongoing_event" });

  const uid = ev.iCalUID ?? ev.id;
  const date = ev.start!.dateTime!.slice(0, 10);
  const attendees = (ev.attendees ?? [])
    .map((a) => ({ name: a.displayName ?? null, email: a.email ?? null }))
    .filter((a) => a.name || a.email);

  return json({
    meeting: {
      identity_kind: "calendar",
      identity_key: `${uid}:${date}`,
      title: ev.summary ?? null,
      attendees,
      started_at: ev.start!.dateTime,
      ended_at: ev.end!.dateTime,
      // Ссылка «зайти в звонок»: рекордер вешает на неё кнопку в уведомлении, чтобы не
      // бежать в календарь (#193). null — у встречи ссылки нет, кнопки не будет.
      join_url: joinLink(ev),
    },
  });
});
