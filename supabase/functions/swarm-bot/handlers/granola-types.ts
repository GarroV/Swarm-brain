import type { MeetingAttendee } from "../../_shared/meeting-dedup.ts";

export type GranolaNote = {
  id: string;
  title: string;
  created_at: string;
  calendar_event?: { scheduled_start_time?: string; scheduled_end_time?: string };
  attendees?: Array<{ name?: string; email?: string }>;
};

export type NotesResult = { ok: true; notes: GranolaNote[] } | { ok: false; error: string };

export type GranolaPreviewCache = {
  content: string;
  title: string;
  tezises: string;
  /** Optional for previews created before #180. */
  attendees?: MeetingAttendee[];
  startedAt?: string | null;
};

export type PreparedGranolaEntry = {
  title: string;
  content: string;
  tezises: string;
  entryDate: string | null;
  /** Точный момент календарного события, текстовый fallback — только для старых кэшей. */
  startedAt: string | null;
  /** Время начала "HH:MM" — для дедупа (UTC для структурного момента события). */
  startTime: string | null;
  /** Участники из Granola с e-mail; разбор строки — только для старых кэшей. */
  attendees: MeetingAttendee[];
  countries: string[];
  embedding: number[];
};
