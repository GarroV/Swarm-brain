// Очередь второй записи одной встречи (T156). Бот встреч и рекордер ОДНОГО человека пишут одну
// встречу и выгружают оба; пока первая запись обрабатывается, вторую некуда положить: в строке
// встречи одно `process_state`, и воркер первой перезаписывает его целиком на каждом шаге.
//
// Поэтому ожидающая запись лежит отдельным объектом `<meeting_id>/queued/<источник>.json` в бакете
// аудио — рядом со своими частями, вне строки, которую пишет воркер. Слот — на источник (T168):
// пока первая запись обрабатывается, могут прийти и вторая запись того же человека, и запись
// другого участника; общий слот перетирал бы одну другой. Продвигается старшая, остальные ждут
// следующего финала. Продвигает её тот, кто первым увидит
// встречу не в обработке: воркер сразу после своего финала или meeting-ingest сразу после записи
// в очередь (порядок «записал → перечитал статус» против «финал → проверил очередь» не оставляет
// щели, в которой оба разминулись бы). Продвижение — условный UPDATE: из двух одновременных
// проходит один. Продвинутая запись обрабатывается как «претендент»: в конце её объём
// распознанного сравнивается с текущей стенограммой (meeting-processor, `challenge`).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ProcessState } from "./meeting-processor.ts";
import { isFrozen, unfrozen } from "./meeting-frozen.ts";

const BUCKET = "meeting-audio"; // = AUDIO_BUCKET meeting-processor; значение не импортируем — цикл модулей

function queueDir(meetingId: string): string {
  return `${meetingId}/queued`;
}

/** Слот ожидающей записи источника; символы вне [A-Za-z0-9_-] ключ Storage не принимает. */
export function queuedPath(meetingId: string, source: string | undefined): string {
  return `${queueDir(meetingId)}/${(source ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

async function readAt(supabase: SupabaseClient, path: string): Promise<ProcessState | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as ProcessState;
    return Array.isArray(parsed?.parts) ? parsed : null;
  } catch {
    console.error(`meeting-queue: ${path} не разбирается — выбрасываю`);
    await supabase.storage.from(BUCKET).remove([path]);
    return null;
  }
}

/** Ожидающая запись: этого источника — или, без источника, старшая из ожидающих. */
export async function readQueued(
  supabase: SupabaseClient,
  meetingId: string,
  source?: string,
): Promise<ProcessState | null> {
  if (source !== undefined) return await readAt(supabase, queuedPath(meetingId, source));
  const { data, error } = await supabase.storage.from(BUCKET).list(queueDir(meetingId), {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error) throw new Error(`queue ${meetingId}: ${error.message}`);
  for (const item of data ?? []) {
    if (!item.name.endsWith(".json")) continue;
    const state = await readAt(supabase, `${queueDir(meetingId)}/${item.name}`);
    if (state) return state;
  }
  return null;
}

export async function writeQueued(supabase: SupabaseClient, meetingId: string, state: ProcessState): Promise<void> {
  const { challenge: _challenge, ...rest } = state;
  const body = new Blob([JSON.stringify(rest)], { type: "application/json" });
  const { error } = await supabase.storage.from(BUCKET).upload(queuedPath(meetingId, state.source), body, {
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
  if (alsoQueued) paths.push(queuedPath(meetingId, state.source));
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
  if (!row || isFrozen(row)) {
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
  const { data: moved } = await unfrozen(
    supabase
      .from("meetings")
      .update({
        summary_status: "processing",
        process_state: state,
        processing_lease: null,
        last_progress_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", meetingId)
      .or("summary_status.is.null,summary_status.neq.processing"),
  ).select("id");
  if (!moved || moved.length === 0) return false;
  await supabase.storage.from(BUCKET).remove([queuedPath(meetingId, queued.source)]);
  console.log(`meeting-queue: ${meetingId} — вторая запись (${queued.source ?? "?"}) пошла в обработку`);
  return true;
}

/**
 * Воркер обнаружил, что его состояние в строке больше не его (поколение сменилось или обнулено).
 * Так бывает, когда meeting-claim «перехватывает» встречу тем же человеком посреди обработки —
 * маркеры обработки сбрасываются, хотя владелец прежний. Тогда запись не выбрасывается, а встаёт в
 * очередь: уже распознанные части сохраняются в состоянии, повторной оплаты Whisper нет. Сменился
 * владелец — право отдано другому человеку по арбитражу claim, запись выбрасывается. Запись
 * претендента (`rival`) владельцем и не была — она встаёт в очередь, как запись держателя.
 *
 * Встречу опубликовали или правили посреди обработки (запись содержимого не легла по условию
 * meeting-frozen.ts) — запись выбрасывается, а встреча, если состояние ещё наше, выходит из
 * обработки: иначе cron гонял бы её сводку по кругу.
 */
export async function requeueLost(supabase: SupabaseClient, meetingId: string, state: ProcessState): Promise<void> {
  const { data } = await supabase
    .from("meetings")
    .select("claim_owner, notes_edited_at, status")
    .eq("id", meetingId)
    .maybeSingle();
  const row = data as { claim_owner: number | null; notes_edited_at: string | null; status: string | null } | null;
  if (row !== null && isFrozen(row)) {
    console.log(
      `meeting-queue: ${meetingId} — запись ${state.source ?? "?"} не легла: встречу правили или опубликовали`,
    );
    if (state.gen) {
      await supabase.from("meetings").update({
        summary_status: state.challenge?.priorStatus ?? "done",
        processing_lease: null,
        updated_at: new Date().toISOString(),
      }).eq("id", meetingId).eq("process_state->>gen", state.gen).select("id");
    }
    await discardState(supabase, meetingId, state, false);
    return;
  }
  const mayWait = row !== null && state.owner !== undefined && (row.claim_owner === state.owner || !!state.rival);
  if (!mayWait) {
    console.log(`meeting-queue: ${meetingId} — запись ${state.source ?? "?"} вытеснена, владелец сменился; выбрасываю`);
    await discardState(supabase, meetingId, state, false);
    return;
  }
  if (await readQueued(supabase, meetingId, state.source)) {
    console.warn(
      `meeting-queue: ${meetingId} — эта же запись уже ждёт в очереди, копию ${state.source ?? "?"} выбрасываю`,
    );
    await discardState(supabase, meetingId, state, false);
    return;
  }
  await writeQueued(supabase, meetingId, state);
  console.log(
    `meeting-queue: ${meetingId} — запись ${state.source ?? "?"} вытеснена посреди обработки, встала в очередь`,
  );
  await promoteQueued(supabase, meetingId);
}
