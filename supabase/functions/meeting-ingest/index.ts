// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем. См. _shared/agent-auth.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveActingIdentity } from "../_shared/agent-auth.ts";
import { assertGrantMeeting, GrantScopeError } from "../_shared/agent-grant.ts";
import { type InMemoryPart, runMeetingStep, uploadPartsAndBuildState } from "../_shared/meeting-processor.ts";
import { promoteQueued, readQueued, writeQueued } from "../_shared/meeting-queue.ts";
import { decideUpload, uploadSource } from "./second-recording.ts";
import { freshChallenge, holderSecondsCorrection, mayCorrectHolderSeconds } from "./challenge.ts";
import { lowerHolderSeconds, measureUpload, type Rival, settleChallengeUpload } from "./challenge-io.ts";
import { isFrozen } from "../_shared/meeting-frozen.ts";
import { parseSpeakerTimeline, type SpeakerSpan, SpeakerTimelineError } from "../_shared/speakers.ts";

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
declare const EdgeRuntime:
  | { waitUntil: (p: Promise<unknown>) => void }
  | undefined;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface RecorderEntry {
  telegram_id: number;
  claimed_at: string;
  role: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  const toPart = async (
    file: File,
    name: string,
    offset: number,
  ): Promise<InMemoryPart> => {
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
    if (!Array.isArray(manifest)) {
      throw new PartError(`${manifestField}: manifest must be an array`);
    }
    const parts: InMemoryPart[] = [];
    const seen = new Set<string>();
    for (
      const item of manifest as Array<{ name?: unknown; offset?: unknown }>
    ) {
      const name = typeof item?.name === "string" ? item.name : "";
      const offset = Number(item?.offset);
      if (!name) throw new PartError(`${manifestField}: part name required`);
      if (seen.has(name)) {
        throw new PartError(`${manifestField}: duplicate part name "${name}"`);
      }
      seen.add(name);
      if (!Number.isFinite(offset) || offset < 0) {
        throw new PartError(`${manifestField}: bad offset for "${name}"`);
      }
      const file = formData.get(name);
      if (!(file instanceof File)) {
        throw new PartError(`${manifestField}: file "${name}" missing`);
      }
      if (file.size === 0) {
        throw new PartError(`${manifestField}: file "${name}" empty`);
      }
      if (file.size > OPENAI_AUDIO_MAX_BYTES) {
        throw new PartError(`part "${name}" too large (>25MB)`, 413);
      }
      parts.push(await toPart(file, `${name}.m4a`, offset));
    }
    return parts;
  }

  // Легаси: один файл, offset 0. Пустой/мелкий (mic без доступа) → дорожки нет.
  const legacy = formData.get(legacyField);
  if (!(legacy instanceof File) || legacy.size <= legacyMinSize) return [];
  if (legacy.size > OPENAI_AUDIO_MAX_BYTES) {
    throw new PartError(`${legacyField} too large (>25MB)`, 413);
  }
  return [await toPart(legacy, fallbackName, 0)];
}

interface TrackParts {
  systemParts: InMemoryPart[];
  micParts: InMemoryPart[];
}

// Части обеих дорожек (файлы уже в памяти после req.formData()) или готовый ответ об ошибке.
async function readParts(formData: FormData): Promise<TrackParts | Response> {
  let systemParts: InMemoryPart[];
  let micParts: InMemoryPart[];
  try {
    systemParts = await buildTrackParts(formData, "sys_parts", "audio", "audio.m4a", 1);
    micParts = await buildTrackParts(formData, "mic_parts", "audio_mic", "audio_mic.m4a", 1024);
  } catch (e) {
    if (e instanceof PartError) return fail(e.message, e.status);
    throw e;
  }
  // Принимаем запись с ОДНОЙ дорожкой: только система ИЛИ только микрофон. mic-only — частый кейс:
  // юзер говорил, но через систему ничего не воспроизводилось → sys-дорожка пустая, рекордер её не
  // шлёт (гард >1024Б в Segmenter). Отклоняем лишь совсем пустую запись (нет ни одной дорожки).
  if (systemParts.length === 0 && micParts.length === 0) {
    return fail("audio required (sys_parts/mic_parts manifest or legacy audio field)");
  }
  return { systemParts, micParts };
}

// Inline-проход после ответа: короткую встречу добивает сразу; длинную подхватит cron meeting-process.
function runInline(id: string): Promise<void> {
  const job = runMeetingStep(supabase, id, INLINE_BUDGET_MS).then(() => {}).catch((e) => {
    console.error(`meeting-ingest: inline step failed for ${id} (cron подхватит):`, e);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
    EdgeRuntime.waitUntil(job);
    return Promise.resolve();
  }
  return job;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let identity;
  try {
    identity = await resolveActingIdentity(supabase, req);
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
  if (typeof meetingId !== "string" || meetingId.length === 0) {
    return fail("meeting_id required");
  }
  // Бот выгружает только во встречу своего пропуска (T165) — до чтения строки встречи.
  try {
    assertGrantMeeting(identity, meetingId);
  } catch (e) {
    if (e instanceof GrantScopeError) return fail(e.message, e.status);
    throw e;
  }

  const { data: meeting } = await supabase
    .from("meetings")
    // Источники и первый сегмент — без тяжёлых jsonb целиком: только чтобы решить судьбу второй
    // записи той же встречи (second-recording.ts).
    .select(
      "id, claim_owner, notes_edited_at, status, summary_status, sources:process_state->sources, first_segment:transcript->segments->0, recorded_seconds, agent_last_seen_at, recorders",
    )
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return fail("meeting not found", 404);
  let m = meeting as {
    id: string;
    claim_owner: number | null;
    notes_edited_at: string | null;
    status: string | null;
    summary_status: string | null;
    sources: unknown;
    first_segment: unknown;
    recorded_seconds: number | null;
    agent_last_seen_at: string | null;
    recorders: unknown;
  };

  // Аудио льёт держатель права транскрибации (claim_owner) — или свежий претендент (T160): заявку
  // другого человека claim не перехватывает, право решит длина этой выгрузки (challenge.ts).
  const uploader = identity.telegramId;
  const challenge = m.claim_owner === uploader ? null : freshChallenge(m.recorders, uploader, new Date().toISOString());
  if (m.claim_owner !== identity.telegramId && !challenge) {
    return fail("not the transcription owner for this meeting", 403);
  }

  // Таймлайн говорящих — НЕОБЯЗАТЕЛЬНОЕ поле (его шлёт бот scriba, рекордер bumblebee о нём не
  // знает). Разбор идёт ПОСЛЕ проверки владения встречей: иначе держатель токена агента платил бы
  // разбором за произвольный и даже несуществующий meeting_id. И всё ещё ДО любых записей — мусор
  // обязан отбиваться внятной ошибкой, а не оседать в process_state и всплывать именем-абракадаброй
  // в стенограмме.
  let speakers: SpeakerSpan[];
  try {
    speakers = parseSpeakerTimeline(formData.get("speakers"));
  } catch (e) {
    if (e instanceof SpeakerTimelineError) return fail(e.message);
    throw e;
  }

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";

  // Правленное человеком или опубликованное команде не трогает никто (_shared/meeting-frozen.ts):
  // ни держатель, ни претендент. 200 — клиенту выгружать больше нечего.
  if (isFrozen(m)) {
    return json({
      ok: true,
      meeting_id: meetingId,
      web_url: webUrl,
      summary_status: m.notes_edited_at ? "skipped_human_edit" : "skipped_published",
    });
  }

  // Претендент: сперва измерить выгрузку и решить право (до идемпотентности — она смотрит на
  // строку, какой она станет после перехвата). Отказ — 409, строка встречи не тронута. Если у
  // держателя уже есть своя версия, право не переходит сейчас: запись идёт на сравнение (`rival`).
  let parts: TrackParts | null = null;
  let rival: Rival | undefined;
  if (challenge) {
    const read = await readParts(formData);
    if (read instanceof Response) return read;
    parts = read;
    const settled = await settleChallengeUpload(
      supabase,
      m.id,
      uploader,
      challenge.micStartOffset,
      [...read.systemParts, ...read.micParts],
      new Date().toISOString(),
    );
    if (!settled.ok) return fail(settled.error, settled.status);
    rival = settled.rival;
    // Перехват сбросил маркеры обработки тем же UPDATE (claim-patch.ts takeoverPatch).
    if (!rival) {
      m = { ...m, claim_owner: uploader, ...(settled.reset ? { summary_status: null, sources: null } : {}) };
    }
  }

  // Идемпотентность: повторный upload (потерянный 202 → ретрай клиента) не должен запускать
  // вторую обработку. Но выгрузка ДРУГОГО источника той же встречи — не повтор, а вторая запись
  // (бот и рекордер одного человека, T156): она ждёт очереди или сравнивается с готовой.
  const source = uploadSource(identity);
  const listed = Array.isArray(m.sources) ? m.sources.filter((s): s is string => typeof s === "string") : null;
  // Запись претендента — другой человек по построению: «старая форма без источников» не делает её
  // повтором чужой выгрузки.
  const sources = rival && listed === null ? [] : listed;
  const decision = decideUpload({
    summaryStatus: m.summary_status,
    sources,
    hasTranscript: m.first_segment !== null && m.first_segment !== undefined,
    incoming: source,
  });
  const queued = decision === "queue" ? await readQueued(supabase, m.id, source) : null;
  if (decision === "already_processed" || queued !== null) {
    return json({
      ok: true,
      meeting_id: meetingId,
      web_url: webUrl,
      summary_status: "already_processed",
    });
  }

  const read = parts ?? await readParts(formData);
  if (read instanceof Response) return read;
  const { systemParts, micParts } = read;

  // Первая выгрузка держателя меряется: заявленные секунды больше измеренного — встреча получает
  // измеренные (challenge.ts holderSecondsCorrection), иначе завышенная заявка первого заявителя
  // закрывала бы встречу от перехвата более полной записью.
  if (!challenge && m.recorded_seconds !== null && mayCorrectHolderSeconds(m, uploader, sources)) {
    const measured = await measureUpload([...systemParts, ...micParts]);
    const lowered = holderSecondsCorrection(m, uploader, sources, measured);
    if (lowered !== null) await lowerHolderSeconds(supabase, m.id, uploader, m.recorded_seconds, lowered);
  }

  // Кладём части в Storage и пишем манифест в process_state. Метим 'processing' ДО фоновой работы.
  let state;
  try {
    state = await uploadPartsAndBuildState(supabase, m.id, systemParts, micParts, speakers, {
      gen: crypto.randomUUID(),
      source,
      sources: [...new Set([...(sources ?? []), source])],
      owner: identity.telegramId,
      ...(rival ? { rival } : {}),
      ...(decision === "challenge" ? { challenge: { priorStatus: m.summary_status } } : {}),
    });
    if (decision === "queue") await writeQueued(supabase, m.id, state);
  } catch (e) {
    console.error(`meeting-ingest: storage upload failed for ${m.id}:`, e);
    return fail("failed to store audio", 500);
  }
  if (decision === "queue") {
    // Первая запись ещё обрабатывается. Перечитываем статус ПОСЛЕ записи в очередь: если она уже
    // закончила, продвигаем сами (воркер проверил очередь до того, как мы в неё встали).
    console.log(`meeting-ingest: ${m.id} — вторая запись (${source}) ждёт, пока обработается первая`);
    if (await promoteQueued(supabase, m.id)) await runInline(m.id);
    return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "processing" }, 202);
  }
  if (decision === "challenge") {
    console.log(`meeting-ingest: ${m.id} — вторая запись (${source}), сравним с текущей стенограммой`);
  }
  const nowIso = new Date().toISOString();
  await supabase
    .from("meetings")
    .update({
      summary_status: "processing",
      process_state: state,
      last_progress_at: nowIso,
      processing_lease: null,
      updated_at: nowIso,
    })
    .eq("id", m.id);

  await runInline(m.id);

  return json({
    ok: true,
    meeting_id: meetingId,
    web_url: webUrl,
    summary_status: "processing",
  }, 202);
});
