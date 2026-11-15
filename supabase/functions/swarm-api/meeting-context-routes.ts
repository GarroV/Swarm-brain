// Existing meeting-card promise (#876): summaries/tasks already in Swarm; no AI or writes.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calendarKeyOf } from "../_shared/calendar-key.ts";
import { todayCalendarEvents } from "../_shared/calendar-today.ts";
import { titleCountries } from "../_shared/market-suggest.ts";
import {
  type ContextMeeting,
  type MeetingContextView,
  previousParticipantMeeting,
} from "../_shared/meeting-participant-context.ts";
import {
  type ContextActor,
  contextAttendees,
  contextTitle,
  loadContextCandidates,
  loadContextEntry,
  loadParticipantTasks,
} from "./meeting-context-store.ts";
import { EntryAccessError, getEntrySecure } from "./entries-guard.ts";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";

export const meetingContextDeps = {
  todayCalendarEvents,
  loadContextEntry,
  loadContextCandidates,
  loadParticipantTasks,
  getEntrySecure,
};
export type MeetingContextDeps = typeof meetingContextDeps;
type Context = { supabase: SupabaseClient; actor: ContextActor; origin: string };
const SUMMARY_LIMIT = 20_000;

export async function handleMeetingContextRoutes(
  ctx: Context,
  req: Request,
  path: string,
  deps: MeetingContextDeps = meetingContextDeps,
): Promise<Response | null> {
  const entryPath = path.match(/^\/meetings\/([^/]+)\/context$/);
  if (path !== "/calendar/today/context" && !entryPath) return null;
  if (req.method !== "GET") return apiErr(405, "Method not allowed", ctx.origin);
  const { supabase: sb, actor, origin } = ctx;
  try {
    let current: ContextMeeting;
    let viewerEmail = actor.email?.trim().toLowerCase() || null;
    if (entryPath) {
      const result = await deps.loadContextEntry(sb, actor, entryPath[1]);
      if (!result) return apiErr(404, "Not found", origin);
      current = {
        id: result.entry.id,
        entryId: result.entry.id,
        title: contextTitle(result.entry),
        startsAt: result.startsAt,
        attendees: contextAttendees(result.entry.metadata?.attendees),
        countries: result.entry.countries ?? [],
      };
    } else {
      const url = new URL(req.url);
      const key = url.searchParams.get("key");
      const offset = Number(url.searchParams.get("tz_offset") ?? 0);
      if (!key || key.length > 1024 || !Number.isFinite(offset) || Math.abs(offset) > 14 * 60) {
        return apiErr(400, "Invalid calendar context", origin);
      }
      const cal = await deps.todayCalendarEvents(sb, actor.telegramId, offset);
      if (!cal.ok) {
        if (cal.reason === "not_connected") return apiErr(503, "not_connected", origin);
        if (cal.reason === "token_expired") return apiErr(503, "token_expired", origin);
        return apiErr(503, "calendar_error", origin);
      }
      const event = cal.events.find((e) =>
        calendarKeyOf(e) === key && e.status !== "cancelled" &&
        e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime
      );
      if (!event?.start?.dateTime) return apiErr(404, "Not found", origin);
      // Only this actor's freshly resolved calendar may identify self; published metadata cannot.
      if (!viewerEmail) {
        const selfEmails = new Set(
          (event.attendees ?? []).filter((a) => a.self)
            .map((a) => (a.email ?? "").trim().toLowerCase())
            .filter((email) => email && !/@resource\.calendar\.google\.com$/i.test(email)),
        );
        if (selfEmails.size === 1) viewerEmail = [...selfEmails][0];
      }
      current = {
        id: key,
        title: event.summary?.trim() || null,
        startsAt: event.start.dateTime,
        countries: titleCountries(event.summary ?? null),
        attendees: (event.attendees ?? []).map((a) => ({ ...a, name: a.displayName })),
      };
    }
    const [history, tasks] = await Promise.all([
      viewerEmail
        ? deps.loadContextCandidates(sb, actor, current.startsAt)
        : Promise.resolve({ candidates: [], truncated: true }),
      deps.loadParticipantTasks(sb, actor, current.attendees),
    ]);
    const match = previousParticipantMeeting(history.candidates, current, viewerEmail);
    let previous: MeetingContextView["previous"] = null;
    if (match) {
      // Revalidate the selected row after matching; never return metadata scan content as a summary.
      const entry = await deps.getEntrySecure(sb, match.id, { ...actor, requireMeeting: true });
      if (entry.metadata?.confirmed === true && entry.summary?.trim()) {
        previous = {
          id: entry.id,
          title: contextTitle(entry),
          date: match.date,
          summary: entry.summary.slice(0, SUMMARY_LIMIT),
          truncated: entry.summary.length > SUMMARY_LIMIT,
        };
      }
    }
    const view: MeetingContextView = {
      meeting: { title: current.title, startsAt: current.startsAt, countries: current.countries },
      previous,
      previousTruncated: history.truncated,
      tasks: tasks.tasks,
      tasksTotal: tasks.total,
      tasksTruncated: tasks.truncated,
    };
    return json(view, 200, origin);
  } catch (error) {
    if (error instanceof EntryAccessError) return apiErr(error.status, error.message, origin);
    return serverError(origin, "meeting context", error);
  }
}
