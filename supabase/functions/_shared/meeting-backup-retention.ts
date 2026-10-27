// Уборка серверных бэкапов записей (#1070, решение 27.10.2026): через три дня (`expires_at`) и сразу
// после замены более новым бэкапом того же источника файлы уходят из бакета meeting-audio, а на
// строке ставится `purged_at`. Саму строку не удаляем — «архивация вместо удаления». Сбой удаления
// файла — в лог, `purged_at` не ставится, следующий проход повторит; молча ничего не теряется.
// Зовёт тик meeting-process раз в час (рядом с чисткой аудио, meeting-audio-retention.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chunk } from "./meeting-audio-retention.ts";

export const BACKUP_BUCKET = "meeting-audio";
/** Сколько бэкапов убираем за проход: остаток доберёт следующий час. */
export const BACKUP_PURGE_BATCH = 50;
/** Storage API принимает пачку путей на удаление; держим её небольшой. */
const REMOVE_CHUNK = 100;

export interface BackupRow {
  id: string;
  parts: unknown;
}

/** Пути файлов бэкапа из его `parts` ([{path, …}]); мусор пропускается. */
export function backupPaths(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((p) => (p as { path?: unknown } | null)?.path)
    .filter((p): p is string => typeof p === "string" && p.startsWith("backup/"));
}

/** Удаляет файлы бэкапа из хранилища и ставит `purged_at`. false — не удалось (причина в логе). */
export async function purgeBackupRow(supabase: SupabaseClient, row: BackupRow): Promise<boolean> {
  for (const part of chunk(backupPaths(row.parts), REMOVE_CHUNK)) {
    const { error } = await supabase.storage.from(BACKUP_BUCKET).remove(part);
    if (error) {
      console.error(`meeting-backup: удаление файлов бэкапа ${row.id}: ${error.message}`);
      return false;
    }
  }
  const { error } = await supabase.from("meeting_audio_backups")
    .update({ purged_at: new Date().toISOString() }).eq("id", row.id).is("purged_at", null);
  if (error) {
    console.error(`meeting-backup: purged_at бэкапа ${row.id}: ${error.message}`);
    return false;
  }
  return true;
}

/** Убирает просроченные и замещённые бэкапы пачкой. Возвращает, сколько убрано и сколько не удалось. */
export async function purgeExpiredBackups(
  supabase: SupabaseClient,
  nowIso: string,
): Promise<{ purged: number; failed: number }> {
  const { data, error } = await supabase.from("meeting_audio_backups")
    .select("id, parts")
    .is("purged_at", null)
    .or(`expires_at.lt.${nowIso},replaced_at.not.is.null`)
    .order("expires_at", { ascending: true })
    .limit(BACKUP_PURGE_BATCH);
  if (error) throw new Error(`meeting_audio_backups: ${error.message}`);
  let purged = 0;
  let failed = 0;
  for (const row of (data ?? []) as BackupRow[]) {
    if (await purgeBackupRow(supabase, row)) purged++;
    else failed++;
  }
  return { purged, failed };
}
