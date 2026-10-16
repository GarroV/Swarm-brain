// Запись встречи из браузера (офлайн-встреча, docs/decisions/2026-10-16-web-recorder.md).
//
// Клиент льёт аудио кусками в Storage (swarm-api/web-recording.ts), а «завершить» собирает куски в
// process_state обычной обработки встреч: дальше всё как у записи с Мака. «Завершить» зовут двое:
// сам человек (POST /meetings/record/:id/finish) и сторож брошенных записей (ghost-sweep) — оба
// идут через finalizeWebRecording, чтобы собирать куски одним кодом.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimLeaseUntil } from "./meeting-lease.ts";
import type { Part, ProcessState } from "./meeting-processor.ts";

/** meetings.source строки, заведённой записью из браузера. */
export const WEB_RECORDER_SOURCE = "web-recorder";
/** Бакет с аудио (тот же, что у meeting-processor.AUDIO_BUCKET; константа не импортируется — тянет весь процессор). */
const BUCKET = "meeting-audio";
/** Потолок одного куска: лимит Whisper 25 МБ, берём с запасом. */
export const MAX_SEGMENT_BYTES = 24 * 1024 * 1024;
/** Номера кусков 0..999 — три цифры в имени файла держат порядок при сортировке по имени. */
export const MAX_SEGMENT_N = 999;
/** Сколько минут без новых кусков запись из браузера считается брошенной. */
export const WEB_STALE_MIN = 30;
/** Потолок смещения куска от начала записи, секунды (сутки). */
export const MAX_OFFSET_SEC = 86_400;
const LIST_PAGE = 100;

export type SegmentExt = "m4a" | "webm";

/** Папка кусков записи в бакете. */
export const segmentDir = (meetingId: string): string => `${meetingId}/web`;

/** Путь куска: номер с нулями + смещение в мс — имя само хранит порядок и таймлайн. */
export function segmentPath(meetingId: string, n: number, offsetSec: number, ext: SegmentExt): string {
  return `${segmentDir(meetingId)}/${String(n).padStart(3, "0")}-${Math.round(offsetSec * 1000)}.${ext}`;
}

const SEGMENT_NAME = /^(\d{3})-(\d+)\.(m4a|webm)$/;

export interface StoredSegment {
  name: string;
  /** Для выбора из дублей одного номера: свежий кусок вытесняет старый. */
  stamp: string;
}

export interface WebSegment {
  n: number;
  offsetMs: number;
  name: string;
}

/** Разбирает имена из Storage: чужие файлы пропускает, дубли одного номера схлопывает (побеждает свежий), сортирует по номеру. */
export function parseSegments(files: StoredSegment[]): WebSegment[] {
  const byN = new Map<number, { seg: WebSegment; stamp: string }>();
  for (const f of files) {
    const m = SEGMENT_NAME.exec(f.name);
    if (!m) continue;
    const n = Number(m[1]);
    const prev = byN.get(n);
    if (prev && prev.stamp > f.stamp) continue;
    byN.set(n, { seg: { n, offsetMs: Number(m[2]), name: f.name }, stamp: f.stamp });
  }
  return [...byN.values()].map((v) => v.seg).sort((a, b) => a.n - b.n);
}

/** Куски записи, лежащие в Storage. Сбой чтения — исключение: пустой список выглядел бы как «куски не дошли». */
export async function listWebSegments(supabase: SupabaseClient, meetingId: string): Promise<WebSegment[]> {
  const files: StoredSegment[] = [];
  for (let offset = 0;; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(segmentDir(meetingId), {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`web-recording ${meetingId}: list: ${error.message}`);
    for (const item of data ?? []) {
      files.push({ name: item.name, stamp: item.updated_at ?? item.created_at ?? "" });
    }
    if ((data ?? []).length < LIST_PAGE) break;
  }
  return parseSegments(files);
}

/** Части обработки из кусков: одна дорожка mic, смещение — секунды от начала записи. */
export function buildWebParts(meetingId: string, segments: WebSegment[]): Part[] {
  return segments.map((s) => ({
    track: "mic" as const,
    name: s.name,
    offset: s.offsetMs / 1000,
    path: `${segmentDir(meetingId)}/${s.name}`,
    done: false,
    attempts: 0,
  }));
}

export interface FinalizeOptions {
  endedAt?: string;
  recordedSeconds?: number;
}

export type FinalizeResult =
  | { already: true; failed?: undefined; parts?: undefined }
  | { already?: undefined; failed: true; parts: 0 }
  | { already?: undefined; failed?: undefined; parts: number };

/**
 * Завершает запись из браузера: куски → process_state → summary_status='processing'.
 * Идемпотентна: условная UPDATE (только пока summary_status пуст и source — web-recorder) пропускает
 * ровно одного из двух одновременных вызовов (человек и сторож), второй получает { already: true }.
 * Ни одного куска — строка помечается 'failed' (сообщение о сбое не уходит: обработки не было).
 */
export async function finalizeWebRecording(
  supabase: SupabaseClient,
  meetingId: string,
  opts: FinalizeOptions = {},
): Promise<FinalizeResult> {
  const { data: row, error: readErr } = await supabase.from("meetings")
    .select("id, claim_owner, source, summary_status")
    .eq("id", meetingId)
    .maybeSingle();
  if (readErr) throw new Error(`web-recording ${meetingId}: read: ${readErr.message}`);
  const meeting = row as { claim_owner: number | null; source: string | null; summary_status: string | null } | null;
  if (!meeting || meeting.source !== WEB_RECORDER_SOURCE || meeting.summary_status !== null) return { already: true };

  const segments = await listWebSegments(supabase, meetingId);
  const nowIso = new Date().toISOString();
  const common = {
    ended_at: opts.endedAt ?? nowIso,
    ...(opts.recordedSeconds !== undefined ? { recorded_seconds: opts.recordedSeconds } : {}),
    updated_at: nowIso,
  };

  let patch: Record<string, unknown>;
  if (segments.length === 0) {
    patch = { ...common, summary_status: "failed" };
  } else {
    const source = `web:${meeting.claim_owner ?? "unknown"}`;
    const state: ProcessState = {
      parts: buildWebParts(meetingId, segments),
      stage: "transcribe",
      gen: crypto.randomUUID(),
      source,
      sources: [source],
      ...(meeting.claim_owner !== null ? { owner: meeting.claim_owner } : {}),
    };
    patch = {
      ...common,
      summary_status: "processing",
      process_state: state,
      last_progress_at: nowIso,
      processing_lease: null,
      lease_expires_at: claimLeaseUntil(),
    };
  }

  const { data: updated, error } = await supabase.from("meetings")
    .update(patch)
    .eq("id", meetingId)
    .eq("source", WEB_RECORDER_SOURCE)
    .is("summary_status", null)
    .select("id");
  if (error) throw new Error(`web-recording ${meetingId}: finalize: ${error.message}`);
  if (((updated ?? []) as unknown[]).length === 0) return { already: true };
  return segments.length === 0 ? { failed: true, parts: 0 } : { parts: segments.length };
}
