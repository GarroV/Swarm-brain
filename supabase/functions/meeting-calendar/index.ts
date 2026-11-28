// meeting-calendar: targeted dequeue after a private Scriba signal. Planning belongs to
// calendar-push; this endpoint only checks notice recipients for the one selected job.
// Agent auth, one job reservation and its existing per-meeting grant remain the authority.
// POST {id: uuid, started?: true}; started confirms a durably created Docker container.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveServiceAgent } from "../_shared/agent-auth.ts";
import { mintGrants } from "../_shared/agent-grant.ts";
import { acknowledgeSignalWork, parseWorkRequest, takeSignalWork } from "../_shared/scriba-work.ts";
import type { TakenJob } from "./sweep.ts";
import { prepareJobNotices } from "./notices.ts";
import { loadCoveredRooms } from "../_shared/manual-rooms.ts";
import { roomOf } from "../_shared/calendar-dispatch.ts";
import { reportCalendarSkips } from "../_shared/calendar-push-report.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  let agent: { agentId: string; groupId: string };
  try {
    agent = await resolveServiceAgent(db, req);
  } catch (error) {
    if (error instanceof AgentAuthError) return json({ ok: false, error: error.message }, error.status);
    throw error;
  }
  let body: { id: string; started: boolean };
  try {
    const text = await req.text();
    if (text.length > 1024) return json({ ok: false }, 413);
    body = parseWorkRequest(JSON.parse(text));
  } catch {
    return json({ ok: false }, 400);
  }
  try {
    if (body.started) {
      const acknowledged = await acknowledgeSignalWork(db, "calendar", body.id, agent);
      return acknowledged ? json({ ok: true, terminal: true, jobs: [], skipped: [] }) : json({ ok: false }, 409);
    }
    const result = await takeSignalWork(db, "calendar", body.id, agent);
    if (["missing", "started"].includes(result.state)) return json({ ok: true, terminal: true, jobs: [], skipped: [] });
    if (result.state !== "taken" || !result.job) return json({ ok: false, error: result.state }, 409);
    const job = result.job as unknown as TakenJob;
    if ((await loadCoveredRooms(db, agent.groupId, Date.now())).has(roomOf(job.join_url))) {
      await reportCalendarSkips(db, agent.groupId, [{
        invited_by: job.invited_by,
        calendar_key: job.calendar_key,
        title: job.title,
        starts_at: job.starts_at,
        ends_at: job.ends_at,
        reason: "manual_invite_exists",
        platform: job.platform,
      }]);
      if (!await acknowledgeSignalWork(db, "calendar", body.id, agent)) return json({ ok: false }, 409);
      return json({ ok: true, terminal: true, jobs: [], skipped: [] });
    }
    await prepareJobNotices(db, agent.groupId, agent.agentId, job);
    const [token] = await mintGrants(db, [{
      agentId: agent.agentId,
      groupId: agent.groupId,
      telegramId: job.invited_by,
      joinUrl: job.join_url,
      calendarJobId: job.id,
      calendarKey: job.calendar_key,
      title: job.title,
    }], Date.now());
    // Expose the established job contract only, never reservation/internal delivery columns.
    const { id, calendar_key, invited_by, join_url, platform, title, starts_at, ends_at } = job;
    return json({
      ok: true,
      jobs: [{ id, calendar_key, invited_by, join_url, platform, title, starts_at, ends_at, grant_token: token }],
      skipped: [],
    });
  } catch {
    console.error("meeting-calendar: targeted dequeue failed; delivery must retry");
    return json({ ok: false, error: "calendar_dequeue_failed" }, 503);
  }
});
