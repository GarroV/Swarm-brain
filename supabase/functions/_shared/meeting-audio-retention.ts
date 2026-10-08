// Срок хранения аудио встреч (решение владельца 08.10.2026, docs/decisions/2026-10-08-meeting-audio-week.md).
// Части больше не удаляются по готовности встречи: неделю они лежат в закрытом бакете meeting-audio,
// чтобы обрезку тишины и модели распознавания проверять на настоящих записях. Чистит тик meeting-process
// раз в час; список устаревших отдаёт SQL-функция meeting_audio_expired (только service_role).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const AUDIO_RETENTION_DAYS = 7;
/** Сколько путей разбирать за один проход: остаток доберёт следующий час. */
const PURGE_BATCH = 1000;
/** Storage API принимает пачку путей на удаление; держим её небольшой. */
const REMOVE_CHUNK = 100;
/** Минута часа, в которую тик meeting-process (раз в минуту) чистит хранилище. */
export const PURGE_MINUTE = 7;

export function isPurgeMinute(now: Date): boolean {
  return now.getUTCMinutes() === PURGE_MINUTE;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Удаляет аудио старше срока. Возвращает, сколько путей удалено; сбой — исключение наверх. */
export async function purgeExpiredAudio(supabase: SupabaseClient, bucket: string): Promise<number> {
  const { data, error } = await supabase.rpc("meeting_audio_expired", {
    p_days: AUDIO_RETENTION_DAYS,
    p_limit: PURGE_BATCH,
  });
  if (error) throw new Error(`meeting_audio_expired: ${error.message}`);
  const paths = (data ?? []) as string[];
  let removed = 0;
  for (const part of chunk(paths, REMOVE_CHUNK)) {
    const { error: rmError } = await supabase.storage.from(bucket).remove(part);
    if (rmError) throw new Error(`удаление аудио: ${rmError.message}`);
    removed += part.length;
  }
  return removed;
}
