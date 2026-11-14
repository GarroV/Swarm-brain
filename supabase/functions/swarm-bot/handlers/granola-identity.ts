import { type MeetingAttendee, parseMeetingContent } from "../../_shared/meeting-dedup.ts";

export type GranolaIdentity = {
  attendees: MeetingAttendee[];
  startedAt: string | null;
  entryDate: string | null;
  startTime: string | null;
};

// A text fallback has no offset. Reinterpreting it would shift old previews in another timezone.
function sourceInstant(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(raw) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Start used by automatic import, kept separate from legacy formatted dates. */
export function granolaImportStartedAt(identity: GranolaIdentity, note: Record<string, unknown>): string | null {
  const calendar = note.calendar_event as { scheduled_start_time?: string } | undefined;
  return sourceInstant(identity.startedAt) ?? sourceInstant(calendar?.scheduled_start_time) ??
    sourceInstant(note.created_at) ?? identity.startedAt;
}

// Сначала структурные поля Granola/кэша; текст — только для старых заметок и кэшей (#180).
export function granolaIdentity(source: unknown, content: string): GranolaIdentity {
  const raw = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const calendar = raw.calendar_event && typeof raw.calendar_event === "object"
    ? raw.calendar_event as Record<string, unknown>
    : {};
  const scheduled = raw.startedAt ?? calendar.scheduled_start_time;
  const iso = sourceInstant(scheduled);
  const date = content.match(/Дата: .*?(\d{2})\.(\d{2})\.(\d{4})/);
  const entryDate = iso ? iso.slice(0, 10) : date ? `${date[3]}-${date[2]}-${date[1]}` : null;
  const startTime = iso ? iso.slice(11, 16) : content.match(/Дата:[^\n]*?(\d{1,2}:\d{2})/)?.[1] ?? null;
  const attendees: MeetingAttendee[] = Array.isArray(raw.attendees)
    ? raw.attendees.filter((a) => a && typeof a === "object").map((a) => ({
      ...(typeof a.name === "string" ? { name: a.name } : {}),
      ...(typeof a.email === "string" ? { email: a.email } : {}),
    }))
    : parseMeetingContent(content).attendees.map((name) => ({ name }));
  return {
    attendees,
    startedAt: iso ?? (entryDate ? `${entryDate}T${startTime ?? "00:00"}:00` : null),
    entryDate,
    startTime,
  };
}
