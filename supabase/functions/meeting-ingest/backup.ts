// Серверный бэкап записи (`backup_only=1`, #1070, решение 27.10.2026): рекордер выгружает ВСЕ записи,
// в том числе те, что сервер в работу не взял (defer, 403/409, исчерпанные попытки). Такая запись
// лежит здесь три дня — на случай, если итог встречи окажется пустым или провалится, — и не
// распознаётся: токенов не тратит. Строку `meetings` не трогаем вообще.
//
// Контракт (multipart, та же аутентификация, что у обычной выгрузки):
//   meeting_id, backup_only=1, sys_parts/mic_parts (+ файлы) или легаси audio/audio_mic;
//   reason = deferred | rejected | exhausted | other (неизвестное → other);
//   необязательные mic_start_offset (число >= 0) и recorded_seconds (число > 0).
// Кто может: держатель права или любой человек из `meetings.recorders` (любая роль). Иначе 403.
// Ответ 200 {ok, backup_id, expires_at}. Повтор от того же источника по той же встрече заменяет
// прежний бэкап (старые файлы убираются после успешной записи нового).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";
import { BACKUP_BUCKET, purgeBackupRow } from "../_shared/meeting-backup-retention.ts";
import { MAX_RECORDED_SECONDS } from "../_shared/meeting-lease.ts";
import { readParts } from "./parts.ts";

export const BACKUP_REASONS = ["deferred", "rejected", "exhausted", "other"] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

export class BackupInputError extends Error {}

/** Причина из формы; неизвестное и пустое — `other`. */
export function parseBackupReason(raw: unknown): BackupReason {
  return typeof raw === "string" && (BACKUP_REASONS as readonly string[]).includes(raw) ? raw as BackupReason : "other";
}

/** Необязательное число формы: нет поля — null; не число или вне границы — BackupInputError. */
export function parseOptionalNumber(
  raw: unknown,
  field: string,
  min: { value: number; inclusive: boolean },
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw) : NaN;
  const ok = Number.isFinite(n) && (min.inclusive ? n >= min.value : n > min.value);
  if (!ok) throw new BackupInputError(`${field} must be a number ${min.inclusive ? ">=" : ">"} ${min.value}`);
  if (field === "recorded_seconds" && n > MAX_RECORDED_SECONDS) {
    throw new BackupInputError(`recorded_seconds must not exceed ${MAX_RECORDED_SECONDS}`);
  }
  return n;
}

/** Бэкап принимается от держателя права и от любого, кто есть в recorders встречи. */
export function mayBackup(meeting: { claim_owner: number | null; recorders: unknown }, uploader: number): boolean {
  if (meeting.claim_owner === uploader) return true;
  return Array.isArray(meeting.recorders) &&
    (meeting.recorders as Array<{ telegram_id?: unknown } | null>).some((r) => r?.telegram_id === uploader);
}

/** Путь части в бакете: backup/<встреча>/<источник>/<выгрузка>/<дорожка>-<имя>. */
export function backupPartPath(
  meetingId: string,
  source: string,
  uploadId: string,
  track: string,
  name: string,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
  return `backup/${meetingId}/${safe(source)}/${uploadId}/${track}-${safe(name)}`;
}

export interface BackupMeeting {
  id: string;
  claim_owner: number | null;
  group_id: string | null;
  recorders: unknown;
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}
const fail = (message: string, status = 400): Response => json({ ok: false, error: message }, status);

interface StoredPart {
  track: "sys" | "mic";
  name: string;
  offset: number;
  path: string;
  size: number;
}

async function storeParts(
  supabase: SupabaseClient,
  meetingId: string,
  source: string,
  uploadId: string,
  tracks: Record<"sys" | "mic", InMemoryPart[]>,
): Promise<StoredPart[]> {
  const stored: StoredPart[] = [];
  try {
    for (const track of ["sys", "mic"] as const) {
      for (const p of tracks[track]) {
        const path = backupPartPath(meetingId, source, uploadId, track, p.name);
        const { error } = await supabase.storage.from(BACKUP_BUCKET)
          .upload(path, p.blob, { contentType: "audio/m4a", upsert: true });
        if (error) throw new Error(`upload ${path}: ${error.message}`);
        stored.push({ track, name: p.name, offset: p.offset, path, size: p.blob.size });
      }
    }
  } catch (e) {
    await removeQuietly(supabase, stored.map((s) => s.path));
    throw e;
  }
  return stored;
}

async function removeQuietly(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BACKUP_BUCKET).remove(paths);
  if (error) console.error(`meeting-ingest: backup — не убрал файлы ${paths.length} шт.: ${error.message}`);
}

/**
 * Обработчик `backup_only=1`. Вызывается ПОСЛЕ проверки пропуска бота и чтения строки встречи, ДО
 * логики держателя/претендента/идемпотентности: строку `meetings` не трогаем, распознавание не
 * запускаем. Замороженная (опубликованная/правленная) встреча бэкап тоже принимает.
 */
export async function handleBackupUpload(
  supabase: SupabaseClient,
  meeting: BackupMeeting,
  uploader: number,
  source: string,
  formData: FormData,
): Promise<Response> {
  if (!mayBackup(meeting, uploader)) return fail("not a recorder of this meeting", 403);

  let reason: BackupReason;
  let micStartOffset: number | null;
  let recordedSeconds: number | null;
  try {
    reason = parseBackupReason(formData.get("reason"));
    micStartOffset = parseOptionalNumber(formData.get("mic_start_offset"), "mic_start_offset", {
      value: 0,
      inclusive: true,
    });
    recordedSeconds = parseOptionalNumber(formData.get("recorded_seconds"), "recorded_seconds", {
      value: 0,
      inclusive: false,
    });
  } catch (e) {
    if (e instanceof BackupInputError) return fail(e.message);
    throw e;
  }

  const read = await readParts(formData);
  if (read instanceof Response) return read;

  const { data: prior, error: priorError } = await supabase.from("meeting_audio_backups")
    .select("id, parts").eq("meeting_id", meeting.id).eq("source", source)
    .is("purged_at", null).is("replaced_at", null).maybeSingle();
  if (priorError) {
    console.error(`meeting-ingest: backup ${meeting.id} — чтение прежнего бэкапа: ${priorError.message}`);
    return fail("failed to store backup", 500);
  }

  let stored: StoredPart[];
  try {
    stored = await storeParts(supabase, meeting.id, source, crypto.randomUUID(), {
      sys: read.systemParts,
      mic: read.micParts,
    });
  } catch (e) {
    console.error(`meeting-ingest: backup storage upload failed for ${meeting.id}:`, e);
    return fail("failed to store audio", 500);
  }

  // Прежний бэкап этого источника уступает место ДО вставки нового (уникальный индекс на живой),
  // но файлы его убираем только после успешной записи нового.
  const old = prior as { id: string; parts: unknown } | null;
  if (old) {
    const { error } = await supabase.from("meeting_audio_backups")
      .update({ replaced_at: new Date().toISOString() }).eq("id", old.id).is("replaced_at", null);
    if (error) {
      await removeQuietly(supabase, stored.map((s) => s.path));
      console.error(`meeting-ingest: backup ${meeting.id} — замена прежнего: ${error.message}`);
      return fail("failed to store backup", 500);
    }
  }

  const { data: row, error: insertError } = await supabase.from("meeting_audio_backups").insert({
    meeting_id: meeting.id,
    group_id: meeting.group_id,
    uploader,
    source,
    reason,
    parts: stored,
    mic_start_offset: micStartOffset,
    recorded_seconds: recordedSeconds,
  }).select("id, expires_at").single();
  if (insertError || !row) {
    // Вернуть прежний бэкап в строй и убрать только что залитые файлы.
    if (old) await supabase.from("meeting_audio_backups").update({ replaced_at: null }).eq("id", old.id);
    await removeQuietly(supabase, stored.map((s) => s.path));
    console.error(`meeting-ingest: backup ${meeting.id} — запись не удалась: ${insertError?.message ?? "нет строки"}`);
    const concurrent = insertError?.code === "23505";
    return fail(
      concurrent ? "another backup upload is in progress, retry" : "failed to store backup",
      concurrent ? 409 : 500,
    );
  }

  if (old) {
    // Сбой уборки не рушит ответ: строка замещена, её подберёт уборка по `replaced_at`.
    await purgeBackupRow(supabase, { id: old.id, parts: old.parts });
  }
  const saved = row as { id: string; expires_at: string };
  console.log(
    `meeting-ingest: backup ${meeting.id} — ${source}, ${reason}, ${stored.length} частей${
      old ? ", прежний заменён" : ""
    }`,
  );
  return json({ ok: true, backup_id: saved.id, expires_at: saved.expires_at });
}
