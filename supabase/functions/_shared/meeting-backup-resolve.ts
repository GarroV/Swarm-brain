// Разбор серверных копий записей (#1314): запись, которую сервер не взял в работу, не теряется
// молча и не ждёт человека. Зовёт тик meeting-process (каждую минуту, после проверки заморозки).
// Решение — чистая `decideBackup` (meeting-backup-decision.ts); здесь — чтение фактов, исполнение
// решения и отметка итога в `meeting_audio_backups`.
//
// «Влить» идёт тем же путём, что вторая запись в meeting-ingest: части в Storage встречи
// (`uploadPartsAndBuildState`), условная приёмка (`acceptUpload`, #578), обработка воркером
// meeting-process и сравнение по объёму распознанного (`challenge`): стенограмма заменяется, только
// если копия полнее. Личность не подделывается: источник и владелец — те, что записаны в копии, а
// влить автоматика может лишь в встречу, которую держит тот же человек.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideBackup, type OwnMeetingFacts } from "./meeting-backup-decision.ts";
import { BACKUP_BUCKET } from "./meeting-backup-retention.ts";
import { claimLeaseUntil } from "./meeting-lease.ts";
import { isFrozen } from "./meeting-frozen.ts";
import { discardState } from "./meeting-queue.ts";
import { type InMemoryPart, uploadPartsAndBuildState } from "./meeting-processor.ts";
import { acceptUpload } from "../meeting-ingest/accept-upload.ts";

/** Сколько копий разбираем за проход. */
export const RESOLVE_BATCH = 20;
/** Тяжёлое (скачать и перелить аудио) — по одной за проход: остальные доберёт следующая минута. */
export const INGEST_PER_PASS = 1;
/** Сколько своих встреч человека смотрим в поиске «тот же звук ушёл отдельной встречей». */
const OWN_MEETINGS_LIMIT = 50;

export interface ResolveSummary {
  covered: number;
  coveredElsewhere: number;
  ingested: number;
  review: number;
  waiting: number;
  failed: number;
}

interface BackupRow {
  id: string;
  meeting_id: string;
  uploader: number;
  source: string;
  recorded_seconds: number | null;
  created_at: string;
  parts: unknown;
  purged_at: string | null;
}

interface MeetingRow {
  id: string;
  claim_owner: number | null;
  summary_status: string | null;
  status: string | null;
  notes_edited_at: string | null;
  recorded_seconds: number | null;
  sources: unknown;
  gen: string | null;
  first_segment: unknown;
}

interface StoredPart {
  track: "sys" | "mic";
  name: string;
  offset: number;
  path: string;
}

const MEETING_COLUMNS =
  "id, claim_owner, summary_status, status, notes_edited_at, recorded_seconds, sources:process_state->sources, gen:process_state->>gen, first_segment:transcript->segments->0";

function sourcesOf(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : null;
}

async function ownMeetings(supabase: SupabaseClient, b: BackupRow): Promise<OwnMeetingFacts[]> {
  const { data, error } = await supabase.from("meetings")
    .select("id, summary_status, recorded_seconds, created_at")
    .eq("claim_owner", b.uploader)
    .neq("id", b.meeting_id)
    .gte("created_at", b.created_at)
    .limit(OWN_MEETINGS_LIMIT);
  if (error) throw new Error(`meetings (свои) ${b.uploader}: ${error.message}`);
  return ((data ?? []) as Array<
    { id: string; summary_status: string | null; recorded_seconds: number | null; created_at: string }
  >)
    .map((r) => ({
      id: r.id,
      summaryStatus: r.summary_status,
      recordedSeconds: r.recorded_seconds,
      createdAt: r.created_at,
    }));
}

async function downloadParts(supabase: SupabaseClient, parts: unknown): Promise<Record<"sys" | "mic", InMemoryPart[]>> {
  const out: Record<"sys" | "mic", InMemoryPart[]> = { sys: [], mic: [] };
  const list = (Array.isArray(parts) ? parts : []) as StoredPart[];
  for (const p of list) {
    if ((p.track !== "sys" && p.track !== "mic") || typeof p.path !== "string") continue;
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).download(p.path);
    if (error || !data) throw new Error(`скачивание ${p.path}: ${error?.message ?? "пусто"}`);
    out[p.track].push({ blob: data, name: p.name, offset: p.offset });
  }
  if (out.sys.length + out.mic.length === 0) throw new Error("в копии нет частей");
  return out;
}

/** true — запись принята в обработку; false — строка встречи сменилась, повторим в следующий проход. */
async function ingestBackup(
  supabase: SupabaseClient,
  b: BackupRow,
  m: MeetingRow,
  mode: "challenge" | "process",
): Promise<boolean> {
  const tracks = await downloadParts(supabase, b.parts);
  const state = await uploadPartsAndBuildState(supabase, m.id, tracks.sys, tracks.mic, [], {
    gen: crypto.randomUUID(),
    source: b.source,
    sources: [...new Set([...(sourcesOf(m.sources) ?? []), b.source])],
    owner: b.uploader,
    ...(mode === "challenge" ? { challenge: { priorStatus: m.summary_status } } : {}),
  });
  const nowIso = new Date().toISOString();
  const accepted = await acceptUpload(
    supabase,
    m.id,
    { claimOwner: m.claim_owner, summaryStatus: m.summary_status, gen: m.gen },
    {
      summary_status: "processing",
      process_state: state,
      last_progress_at: nowIso,
      processing_lease: null,
      lease_expires_at: claimLeaseUntil(),
      updated_at: nowIso,
    },
  );
  if (!accepted) {
    await discardState(supabase, m.id, state, false);
    return false;
  }
  return true;
}

async function mark(
  supabase: SupabaseClient,
  id: string,
  resolution: "covered" | "covered_elsewhere" | "ingested" | "needs_review",
  note: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("meeting_audio_backups").update({
    resolution,
    resolution_note: note,
    resolved_at: resolution === "needs_review" ? null : nowIso,
    ...(resolution === "ingested" ? { used_at: nowIso } : {}),
  }).eq("id", id).is("resolution", null);
  if (error) throw new Error(`meeting_audio_backups ${id}: ${error.message}`);
}

/** Разбирает неразобранные копии. Сбой одной не мешает остальным: в лог, повтор в следующий проход. */
export async function resolveBackups(supabase: SupabaseClient, nowMs: number = Date.now()): Promise<ResolveSummary> {
  const sum: ResolveSummary = { covered: 0, coveredElsewhere: 0, ingested: 0, review: 0, waiting: 0, failed: 0 };
  const { data, error } = await supabase.from("meeting_audio_backups")
    .select("id, meeting_id, uploader, source, recorded_seconds, created_at, parts, purged_at")
    .is("resolution", null)
    .is("replaced_at", null)
    .order("created_at", { ascending: true })
    .limit(RESOLVE_BATCH);
  if (error) throw new Error(`meeting_audio_backups: ${error.message}`);

  let ingests = 0;
  for (const b of (data ?? []) as BackupRow[]) {
    try {
      const { data: row, error: mErr } = await supabase.from("meetings").select(MEETING_COLUMNS)
        .eq("id", b.meeting_id).maybeSingle();
      if (mErr) throw new Error(`meetings ${b.meeting_id}: ${mErr.message}`);
      const m = row as MeetingRow | null;
      if (!m) {
        await mark(supabase, b.id, "needs_review", "встречи, к которой относится копия, нет");
        sum.review++;
        continue;
      }
      const verdict = decideBackup({
        backup: {
          id: b.id,
          meetingId: b.meeting_id,
          uploader: b.uploader,
          source: b.source,
          recordedSeconds: b.recorded_seconds,
          createdAt: b.created_at,
          filesPurged: b.purged_at !== null,
        },
        meeting: {
          id: m.id,
          claimOwner: m.claim_owner,
          summaryStatus: m.summary_status,
          frozen: isFrozen(m),
          hasTranscript: m.first_segment !== null && m.first_segment !== undefined,
          recordedSeconds: m.recorded_seconds,
          sources: sourcesOf(m.sources),
        },
        ownMeetings: await ownMeetings(supabase, b),
        nowMs,
      });

      if (verdict.action === "wait") sum.waiting++;
      else if (verdict.action === "covered") {
        await mark(supabase, b.id, "covered", verdict.note);
        sum.covered++;
      } else if (verdict.action === "covered_elsewhere") {
        await mark(supabase, b.id, "covered_elsewhere", verdict.note);
        sum.coveredElsewhere++;
      } else if (verdict.action === "review") {
        await mark(supabase, b.id, "needs_review", verdict.note);
        console.warn(`meeting-backup: копия ${b.id} (встреча ${b.meeting_id}) — нужен разбор: ${verdict.note}`);
        sum.review++;
      } else if (ingests >= INGEST_PER_PASS) {
        sum.waiting++;
      } else {
        ingests++;
        if (await ingestBackup(supabase, b, m, verdict.mode)) {
          await mark(supabase, b.id, "ingested", verdict.note);
          console.log(`meeting-backup: копия ${b.id} влита во встречу ${b.meeting_id} (${verdict.mode})`);
          sum.ingested++;
        } else sum.waiting++;
      }
    } catch (e) {
      console.error(`meeting-backup: разбор копии ${b.id} не удался (повтор в следующий проход):`, e);
      sum.failed++;
    }
  }
  return sum;
}

/** Сколько копий ждёт человека: сигнал для журнала, пока у таких копий нет экрана. */
export async function countNeedsReview(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("meeting_audio_backups")
    .select("id", { count: "exact", head: true })
    .eq("resolution", "needs_review")
    .is("resolved_at", null);
  if (error) throw new Error(`meeting_audio_backups: ${error.message}`);
  return count ?? 0;
}
