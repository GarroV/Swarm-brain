// Очередь второй записи одной встречи (T156). Бот scriba и рекордер ОДНОГО человека пишут одну
// встречу и выгружают оба; пока первая запись обрабатывается, вторую некуда положить: в строке
// встречи одно `process_state`, и воркер первой перезаписывает его целиком на каждом шаге.
//
// Поэтому ожидающая запись лежит отдельным объектом `<meeting_id>/queued.json` в бакете аудио —
// рядом со своими частями, вне строки, которую пишет воркер. Продвигает её тот, кто первым увидит
// встречу не в обработке: воркер сразу после своего финала или meeting-ingest сразу после записи
// в очередь (порядок «записал → перечитал статус» против «финал → проверил очередь» не оставляет
// щели, в которой оба разминулись бы). Продвижение — условный UPDATE: из двух одновременных
// проходит один. Продвинутая запись обрабатывается как «претендент»: в конце её объём
// распознанного сравнивается с текущей стенограммой (meeting-processor, `challenge`).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ProcessState } from "./meeting-processor.ts";

const BUCKET = "meeting-audio"; // = AUDIO_BUCKET meeting-processor; значение не импортируем — цикл модулей

export function queuedPath(meetingId: string): string {
  return `${meetingId}/queued.json`;
}

export async function readQueued(supabase: SupabaseClient, meetingId: string): Promise<ProcessState | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(queuedPath(meetingId));
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as ProcessState;
    return Array.isArray(parsed?.parts) ? parsed : null;
  } catch {
    console.error(`meeting-queue: ${queuedPath(meetingId)} не разбирается — выбрасываю`);
    await supabase.storage.from(BUCKET).remove([queuedPath(meetingId)]);
    return null;
  }
}

export async function writeQueued(supabase: SupabaseClient, meetingId: string, state: ProcessState): Promise<void> {
  const { challenge: _challenge, ...rest } = state;
  const body = new Blob([JSON.stringify(rest)], { type: "application/json" });
  const { error } = await supabase.storage.from(BUCKET).upload(queuedPath(meetingId), body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`queue ${meetingId}: ${error.message}`);
}

/** Выбросить запись вместе с её частями: сравнивать её больше не с чем или нельзя. */
export async function discardState(
  supabase: SupabaseClient,
  meetingId: string,
  state: ProcessState,
  alsoQueued: boolean,
): Promise<void> {
  const paths = state.parts.map((p) => p.path);
  if (alsoQueued) paths.push(queuedPath(meetingId));
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch { /* осиротевший файл лучше сбоя обработки */ }
}

interface PromoteRow {
  summary_status: string | null;
  notes_edited_at: string | null;
  status: string | null;
  sources: string[] | null;
}

/**
 * Продвинуть ожидающую запись в обработку, если встреча сейчас не обрабатывается.
 * true — продвинута (встреча снова `processing`, её подхватит inline-проход или cron).
 */
export async function promoteQueued(supabase: SupabaseClient, meetingId: string): Promise<boolean> {
  const queued = await readQueued(supabase, meetingId);
  if (!queued) return false;
  const { data } = await supabase
    .from("meetings")
    .select("summary_status, notes_edited_at, status, sources:process_state->sources")
    .eq("id", meetingId)
    .maybeSingle();
  const row = data as PromoteRow | null;
  if (row?.summary_status === "processing") return false;
  if (!row || row.notes_edited_at !== null || row.status === "in_base") {
    // Тезисы правил человек или запись уже у команды — автоматика их не перезаписывает.
    console.log(`meeting-queue: ${meetingId} — вторая запись выброшена (правки человека / опубликовано)`);
    await discardState(supabase, meetingId, queued, true);
    return false;
  }
  const sources = [...new Set([...(Array.isArray(row.sources) ? row.sources : []), ...(queued.sources ?? [])])];
  const state: ProcessState = {
    ...queued,
    gen: crypto.randomUUID(),
    sources,
    challenge: { priorStatus: row.summary_status },
  };
  const nowIso = new Date().toISOString();
  const { data: moved } = await supabase
    .from("meetings")
    .update({
      summary_status: "processing",
      process_state: state,
      processing_lease: null,
      last_progress_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", meetingId)
    .or("summary_status.is.null,summary_status.neq.processing")
    .is("notes_edited_at", null)
    .select("id");
  if (!moved || moved.length === 0) return false;
  await supabase.storage.from(BUCKET).remove([queuedPath(meetingId)]);
  console.log(`meeting-queue: ${meetingId} — вторая запись (${queued.source ?? "?"}) пошла в обработку`);
  return true;
}

/**
 * Воркер обнаружил, что его состояние в строке больше не его (поколение сменилось или обнулено).
 * Так бывает, когда meeting-claim «перехватывает» встречу тем же человеком посреди обработки —
 * маркеры обработки сбрасываются, хотя владелец прежний. Тогда запись не выбрасывается, а встаёт в
 * очередь: уже распознанные части сохраняются в состоянии, повторной оплаты Whisper нет. Сменился
 * владелец — право отдано другому человеку по арбитражу claim, запись выбрасывается.
 */
export async function requeueLost(supabase: SupabaseClient, meetingId: string, state: ProcessState): Promise<void> {
  const { data } = await supabase
    .from("meetings")
    .select("claim_owner, notes_edited_at, status")
    .eq("id", meetingId)
    .maybeSingle();
  const row = data as { claim_owner: number | null; notes_edited_at: string | null; status: string | null } | null;
  const sameOwner = row !== null && state.owner !== undefined && row.claim_owner === state.owner &&
    row.notes_edited_at === null && row.status !== "in_base";
  if (!sameOwner) {
    console.log(`meeting-queue: ${meetingId} — запись ${state.source ?? "?"} вытеснена, владелец сменился; выбрасываю`);
    await discardState(supabase, meetingId, state, false);
    return;
  }
  if (await readQueued(supabase, meetingId)) {
    console.warn(`meeting-queue: ${meetingId} — очередь уже занята, запись ${state.source ?? "?"} выбрасываю`);
    await discardState(supabase, meetingId, state, false);
    return;
  }
  await writeQueued(supabase, meetingId, state);
  console.log(
    `meeting-queue: ${meetingId} — запись ${state.source ?? "?"} вытеснена посреди обработки, встала в очередь`,
  );
  await promoteQueued(supabase, meetingId);
}
