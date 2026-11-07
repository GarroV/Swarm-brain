import type { MeetingAttendee } from "../../_shared/meeting-dedup.ts";

export type GranolaNote = {
  id: string;
  title: string;
  created_at: string;
  calendar_event?: { scheduled_start_time?: string; scheduled_end_time?: string };
  attendees?: Array<{ name?: string; email?: string }>;
};

export type NotesResult = { ok: true; notes: GranolaNote[] } | { ok: false; error: string };

export type GranolaPreviewCache = { content: string; title: string; tezises: string };

export type PreparedGranolaEntry = {
  title: string;
  content: string;
  tezises: string;
  entryDate: string | null;
  /** Время начала "HH:MM" (из строки "Дата: …, HH:MM" в контенте) — для дедупа. */
  startTime: string | null;
  /** Участники встречи (из строки "Участники: …") — для дедупа. */
  attendees: MeetingAttendee[];
  countries: string[];
  embedding: number[];
};
