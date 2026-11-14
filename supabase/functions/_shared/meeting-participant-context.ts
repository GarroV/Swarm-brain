// Read-only meeting card (#876). Identity/date heuristics of ingestion stay unchanged.
import { normName } from "./meeting-dedup.ts";

export type ContextAttendee = { name?: string; email?: string; self?: boolean; resource?: boolean };
export type ContextMeeting = {
  id: string;
  title: string | null;
  startsAt: string;
  countries: string[];
  attendees: ContextAttendee[];
  entryId?: string;
};
export type ContextCandidate = {
  id: string;
  title: string | null;
  date: string;
  startsAt: string | null;
  attendees: ContextAttendee[];
};
export type ContextTask = { id: string; title: string; dueDate: string | null; status: string };
export type MeetingContextView = {
  meeting: { title: string | null; startsAt: string; countries: string[] };
  previous: { id: string; title: string | null; date: string; summary: string; truncated: boolean } | null;
  previousTruncated: boolean;
  tasks: ContextTask[];
  tasksTotal: number | null;
  tasksTruncated: boolean;
};

const emailKey = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** Same trim/case normalization, room rule and self exclusion as the existing calendar flow. */
export function participantRoster(attendees: ContextAttendee[], viewerEmail: string | null): Set<string> {
  const self = emailKey(viewerEmail ?? undefined);
  return new Set(
    attendees.filter((a) =>
      a && !a.self && !a.resource &&
      !/@resource\.calendar\.google\.com$/i.test(emailKey(a.email)) &&
      (!self || emailKey(a.email) !== self)
    )
      .map((a) => emailKey(a.email) || normName(a.name ?? "")).filter(Boolean),
  );
}

/** Existing half-of-smaller-roster convention; duplicate-specific min2/time gates do not apply. */
export function sharesParticipants(a: Set<string>, b: Set<string>): boolean {
  const small = Math.min(a.size, b.size);
  if (!small) return false;
  let common = 0;
  for (const person of a) if (b.has(person)) common++;
  return common >= Math.ceil(small * 0.5);
}

/** Without a start timestamp, a same-day row cannot prove it preceded the selected meeting. */
export function precedesMeeting(candidate: ContextCandidate, current: ContextMeeting): boolean {
  if (candidate.id === current.entryId) return false;
  if (candidate.startsAt) return Date.parse(candidate.startsAt) < Date.parse(current.startsAt);
  return candidate.date < current.startsAt.slice(0, 10);
}

export function previousParticipantMeeting(
  candidates: ContextCandidate[],
  current: ContextMeeting,
  viewerEmail: string | null,
): ContextCandidate | null {
  const roster = participantRoster(current.attendees, viewerEmail);
  return candidates.filter((c) =>
    precedesMeeting(c, current) &&
    sharesParticipants(roster, participantRoster(c.attendees, viewerEmail))
  )
    .sort((a, b) => (b.startsAt ?? b.date).localeCompare(a.startsAt ?? a.date) || b.id.localeCompare(a.id))[0] ?? null;
}

/** IDs come from the current workspace people directory, never from matching display names. */
export function participantPeople(
  attendees: ContextAttendee[],
  people: Array<{ id: string; email: string | null; telegramId: number | null }>,
): { personIds: string[]; telegramIds: number[] } {
  const emails = new Set(
    attendees.filter((a) =>
      a && !a.resource &&
      !/@resource\.calendar\.google\.com$/i.test(emailKey(a.email))
    ).map((a) => emailKey(a.email)).filter(Boolean),
  );
  const matched = people.filter((p) => p.email && emails.has(emailKey(p.email)));
  return {
    personIds: [...new Set(matched.map((p) => p.id))],
    telegramIds: [...new Set(matched.map((p) => p.telegramId).filter((id): id is number => id != null))],
  };
}
