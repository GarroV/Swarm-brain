import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";
import { runMeetingStep, uploadPartsAndBuildState, type InMemoryPart } from "../_shared/meeting-processor.ts";

// meeting-ingest — приём АУДИО от claimer (см. transcribator/10-REVISED-DESIGN.md §4, §7.2).
// Облачная схема: рекордер пишет звук → грузит сюда; сервер транскрибирует (OpenAI Whisper)
// → текст → тезисы (GPT) → meetings.draft_notes_md → уведомляет записавших.
//
// DURABLE-обработка: аудио НЕ транскрибируется одним куском (длинная встреча убивала воркер по
// wall-clock). Части сохраняются в Storage (bucket meeting-audio), обработка идёт по шагам в
// _shared/meeting-processor.ts: тут — приём + короткий inline-проход (короткой встрече хватает);
// длинную добивает cron-функция meeting-process. Состояние и сшивка — в meetings.process_state.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

// Лимит файла на эндпоинте транскрибации OpenAI — часть не должна его превышать (рекордер режет).
const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
// Бюджет inline-прохода после ответа: короткая встреча (1–2 части) добивается сразу, без задержки
// cron. Длинная упрётся в бюджет, освободит лиз — её продолжит meeting-process. << wall-clock 400s.
const INLINE_BUDGET_MS = 90_000;

// Supabase-инъектируемый глобал для фоновой работы после ответа.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface RecorderEntry { telegram_id: number; claimed_at: string; role: string }

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
function fail(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

// Ошибка разбора частей с HTTP-статусом (413 для превышения лимита, 400 для прочего).
class PartError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Собирает части одной дорожки. Новый путь — JSON-манифест `manifestField` ([{name,offset}])
// + файлы по `name`. Легаси-путь — одиночный файл `legacyField` (offset 0). Файлы буферизуются
// в память (req.formData() уже прочитал тело). Бросает PartError при невалидном вводе/превышении.
async function buildTrackParts(
  formData: FormData,
  manifestField: string,
  legacyField: string,
  fallbackName: string,
  legacyMinSize: number,
): Promise<InMemoryPart[]> {
  const toPart = async (file: File, name: string, offset: number): Promise<InMemoryPart> => {
    const buf = await file.arrayBuffer();
    return {
      blob: new Blob([buf], { type: file.type || "audio/m4a" }),
      name: file.name && file.name.length > 0 ? file.name : name,
      offset,
    };
  };

  const raw = formData.get(manifestField);
  if (typeof raw === "string" && raw.length > 0) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(raw);
    } catch {
      throw new PartError(`${manifestField}: invalid JSON manifest`);
    }
    if (!Array.isArray(manifest)) throw new PartError(`${manifestField}: manifest must be an array`);
    const parts: InMemoryPart[] = [];
    const seen = new Set<string>();
    for (const item of manifest as Array<{ name?: unknown; offset?: unknown }>) {
      const name = typeof item?.name === "string" ? item.name : "";
      const offset = Number(item?.offset);
      if (!name) throw new PartError(`${manifestField}: part name required`);
      if (seen.has(name)) throw new PartError(`${manifestField}: duplicate part name "${name}"`);
      seen.add(name);
      if (!Number.isFinite(offset) || offset < 0) throw new PartError(`${manifestField}: bad offset for "${name}"`);
      const file = formData.get(name);
      if (!(file instanceof File)) throw new PartError(`${manifestField}: file "${name}" missing`);
      if (file.size === 0) throw new PartError(`${manifestField}: file "${name}" empty`);
      if (file.size > OPENAI_AUDIO_MAX_BYTES) throw new PartError(`part "${name}" too large (>25MB)`, 413);
      parts.push(await toPart(file, `${name}.m4a`, offset));
    }
    return parts;
  }

  // Легаси: один файл, offset 0. Пустой/мелкий (mic без доступа) → дорожки нет.
  const legacy = formData.get(legacyField);
  if (!(legacy instanceof File) || legacy.size <= legacyMinSize) return [];
  if (legacy.size > OPENAI_AUDIO_MAX_BYTES) throw new PartError(`${legacyField} too large (>25MB)`, 413);
  return [await toPart(legacy, fallbackName, 0)];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return fail(e.message, e.status);
    throw e;
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("expected multipart/form-data with meeting_id + audio");
  }
  const meetingId = formData.get("meeting_id");
  if (typeof meetingId !== "string" || meetingId.length === 0) return fail("meeting_id required");

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, claim_owner, notes_edited_at, summary_status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return fail("meeting not found", 404);
  const m = meeting as { id: string; claim_owner: number | null; notes_edited_at: string | null; summary_status: string | null };

  // Аудио льёт только держатель права транскрибации (claim_owner).
  if (m.claim_owner !== identity.telegramId) return fail("not the transcription owner for this meeting", 403);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";

  // Защита правок человека: черновик уже правили → не перетранскрибируем и не перегенерим.
  if (m.notes_edited_at) {
    return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "skipped_human_edit" });
  }

  // Идемпотентность: повторный upload (потерянный 202 → ретрай клиента) не должен запускать
  // вторую обработку. 'failed'/null — можно (пере)обработать, 'processing'/'done' — нет.
  if (m.summary_status === "processing" || m.summary_status === "done") {
    return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "already_processed" });
  }

  // Собираем части дорожек (файлы уже в памяти после req.formData()).
  let systemParts: InMemoryPart[];
  let micParts: InMemoryPart[];
  try {
    systemParts = await buildTrackParts(formData, "sys_parts", "audio", "audio.m4a", 1);
    micParts = await buildTrackParts(formData, "mic_parts", "audio_mic", "audio_mic.m4a", 1024);
  } catch (e) {
    if (e instanceof PartError) return fail(e.message, e.status);
    throw e;
  }
  if (systemParts.length === 0) return fail("audio required (sys_parts manifest or legacy audio field)");

  // Кладём части в Storage и пишем манифест в process_state. Метим 'processing' ДО фоновой работы.
  let state;
  try {
    state = await uploadPartsAndBuildState(supabase, m.id, systemParts, micParts);
  } catch (e) {
    console.error(`meeting-ingest: storage upload failed for ${m.id}:`, e);
    return fail("failed to store audio", 500);
  }
  const nowIso = new Date().toISOString();
  await supabase
    .from("meetings")
    .update({ summary_status: "processing", process_state: state, last_progress_at: nowIso, processing_lease: null, updated_at: nowIso })
    .eq("id", m.id);

  // Inline-проход после ответа: короткую встречу добивает сразу; длинную подхватит cron meeting-process.
  const job = runMeetingStep(supabase, m.id, INLINE_BUDGET_MS).catch((e) => {
    console.error(`meeting-ingest: inline step failed for ${m.id} (cron подхватит):`, e);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
    EdgeRuntime.waitUntil(job);
  } else {
    await job;
  }

  return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "processing" }, 202);
});
