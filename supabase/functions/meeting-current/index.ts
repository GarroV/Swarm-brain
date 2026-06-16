// «Какая встреча идёт сейчас» для рекордера — по серверной Google-интеграции.
// Agent-токен (smcp_) → telegram_id → refresh_token из user_integrations → access_token →
// Google Calendar API (события now±30мин) → идущее событие → идентичность для claim.
// Рекордеру не нужен ни macOS-Календарь, ни доступ к календарю на маке.
//
// Деплой: supabase functions deploy meeting-current --no-verify-jwt (хитит рекордер с Bearer smcp_).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function accessToken(refresh: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
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
  // Окно: чуть назад (идущая) + вперёд на 10 мин (предстоящая, для упреждающего «через N мин»).
  const timeMin = new Date(now.getTime() - 2 * 60_000).toISOString();
  const timeMax = new Date(now.getTime() + 10 * 60_000).toISOString();
  const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin, timeMax, maxResults: "10" });
  const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!calRes.ok) return json({ meeting: null, reason: "calendar_api_error" });

  type GEvent = {
    id: string; iCalUID?: string; summary?: string;
    start?: { dateTime?: string }; end?: { dateTime?: string };
    attendees?: Array<{ displayName?: string; email?: string }>;
  };
  const items = ((await calRes.json()).items ?? []) as GEvent[];
  const timed = items.filter((e) => e.start?.dateTime && e.end?.dateTime);
  // Идущее сейчас; иначе ближайшее предстоящее (в окне) — для упреждающего уведомления.
  const ongoing = timed.find((e) => new Date(e.start!.dateTime!) <= now && now <= new Date(e.end!.dateTime!));
  const upcoming = timed
    .filter((e) => new Date(e.start!.dateTime!) > now)
    .sort((a, b) => new Date(a.start!.dateTime!).getTime() - new Date(b.start!.dateTime!).getTime())[0];
  const ev = ongoing ?? upcoming;
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
    },
  });
});
