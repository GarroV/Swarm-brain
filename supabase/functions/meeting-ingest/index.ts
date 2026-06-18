import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

// meeting-ingest — заливка АУДИО от claimer (см. transcribator/10-REVISED-DESIGN.md §4, §7.2).
// Облачная схема: рекордор пишет звук → грузит сюда; сервер сам транскрибирует
// (OpenAI Whisper) → текст → тезисы (GPT) → meetings.draft_notes_md (черновик, НЕ в базе
// знаний) → уведомляет записавших. Запись entries создаётся позже, на аппруве.
// 202/processing + EdgeRuntime.waitUntil — транскрибация+тезисы идут в фоне, чтобы не
// упереться в wall-clock и не словить дубли от retry агента.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

// Лимит файла на эндпоинте транскрибации OpenAI. Длинные встречи — резать/жать (TODO).
const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

// Supabase-инъектируемый глобал для фоновой работы после ответа.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Segment { start: number; end: number; text: string; speaker?: string }
interface Transcript { language: string; model: string; segments: Segment[] }
// Часть дорожки: один файл ≤25МБ + смещение начала (сек) в общей таймлинии встречи.
// Короткая встреча = одна часть с offset=0; длинная нарезана рекордером на N частей.
interface AudioPart { blob: Blob; name: string; offset: number }
interface RecorderEntry { telegram_id: number; claimed_at: string; role: string }
interface InlineButton { text: string; url: string }

// Параллелизм транскрибации частей — держим в узде, чтобы не упереться в rate-limit OpenAI.
const TRANSCRIBE_CONCURRENCY = 4;

const TEZIS_SYSTEM =
  "Ты помощник команды. Создай структурированные тезисы встречи строго по тексту стенограммы — " +
  "не домысливай и не добавляй информацию которой нет в тексте.\n" +
  "Формат: ### Тема\n- тезис\n- тезис\n\n" +
  "Темы называй широко: 'Персонал', 'IT / Технические проблемы', 'Поставки', 'Финансы / Эквайринг', " +
  "'Строительство', 'Маркетинг', 'Операции', 'Региональные новости' и т.п. " +
  "Только то что реально обсуждалось. Без выдумок.";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Запрос к OpenAI с ретраями на 429/5xx (учитывает Retry-After). С нарезкой на части один
// транзиентный сбой не должен ронять всю встречу. Не-ok ответ отдаём наверх для разбора тела.
async function openaiFetch(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 1; i < attempts; i++) {
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (res.ok || !retryable) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, i - 1) * 1000;
    await res.body?.cancel(); // освобождаем тело перед повтором
    await sleep(delayMs);
    res = await fetch(url, init);
  }
  return res;
}

// Транскрибация аудио через OpenAI Whisper (verbose_json → сегменты с таймстампами).
async function transcribeAudio(audio: Blob, filename: string): Promise<Transcript> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("language", "ru");

  const res = await openaiFetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI transcription error");
  }
  const d = data as { language?: string; text?: string; segments?: Array<{ start: number; end: number; text: string }> };
  const segments: Segment[] = (d.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));
  if (segments.length === 0 && d.text) {
    segments.push({ start: 0, end: 0, text: d.text });
  }
  return { language: d.language ?? "ru", model: "whisper-1", segments };
}

// Ограниченно-параллельный map: не больше `limit` промисов в полёте одновременно.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Транскрибируем все части одной дорожки (параллельно, с ограничением) и сводим в единый
// поток сегментов: к таймстампам каждой части прибавляем её offset (Whisper нумерует с нуля).
async function transcribeTrack(parts: AudioPart[], speaker: string): Promise<Segment[]> {
  const perPart = await mapLimit(parts, TRANSCRIBE_CONCURRENCY, async (p) => {
    const t = await transcribeAudio(p.blob, p.name);
    return t.segments.map((s) => ({
      start: s.start + p.offset,
      end: s.end + p.offset,
      text: s.text,
      speaker,
    }));
  });
  return perPart.flat();
}

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 3000,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
  }
  return (data as { choices: Array<{ message: { content: string } }> }).choices[0].message.content;
}

async function sendTelegram(chatId: number, text: string, keyboard?: InlineButton[][]): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  });
}

// Фон: транскрибируем аудио → meetings.transcript, генерим тезисы → draft_notes_md,
// уведомляем записавших.
async function processAudio(
  meetingId: string,
  title: string | null,
  systemParts: AudioPart[],
  micParts: AudioPart[],
  recorders: RecorderEntry[],
): Promise<void> {
  // Транскрибируем системный звук (собеседники) и, если есть, микрофон (я).
  // Каждая дорожка может быть нарезана на части — сводим их по offset внутри transcribeTrack.
  let segments = await transcribeTrack(systemParts, "собеседник");
  let model = "whisper-1";
  if (micParts.length > 0) {
    segments = segments.concat(await transcribeTrack(micParts, "я"));
    model = "whisper-1+mic";
  }
  // Сводим по таймстампам (общий старт сессии) → восстанавливаем порядок реплик.
  segments.sort((a, b) => a.start - b.start);
  // language форсим в запросе Whisper ('ru'), поэтому фиксируем константой.
  const transcript: Transcript = { language: "ru", model, segments };
  await supabase.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", meetingId);

  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  const tezisi = await chatComplete(
    TEZIS_SYSTEM,
    `Встреча: ${title ?? "без названия"}\n\nСтенограмма (реплики помечены «собеседник» — другие участники, «я» — владелец записи):\n${transcriptText}`,
  );

  // Авто-название по сути встречи, если заголовка нет или это плейсхолдер «Запись <дата>»
  // (ручная запись без события календаря). Календарные названия не трогаем.
  let finalTitle = title;
  if (!title || /^Запись\s/i.test(title)) {
    try {
      const t = (await chatComplete(
        "Придумай короткое название встречи на русском: 3–6 слов, по сути обсуждения, без даты, кавычек и префиксов. Верни ТОЛЬКО название.",
        (tezisi || transcriptText).slice(0, 2000),
      )).trim().replace(/^["«»\s]+|["«»\s]+$/g, "").slice(0, 120);
      if (t) finalTitle = t;
    } catch { /* оставляем исходный заголовок */ }
  }

  await supabase
    .from("meetings")
    .update({ draft_notes_md: tezisi, title: finalTitle, summary_status: "done", updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";
  const titleStr = finalTitle ? `: <b>${finalTitle}</b>` : "";
  const text = `📝 Тезисы встречи готовы к вычитке${titleStr}\nВозьмёт любой из участников.`;
  const keyboard: InlineButton[][] | undefined = webUrl ? [[{ text: "Открыть", url: webUrl }]] : undefined;
  for (const r of recorders) {
    await sendTelegram(r.telegram_id, text, keyboard);
  }
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
): Promise<AudioPart[]> {
  const toPart = async (file: File, name: string, offset: number): Promise<AudioPart> => {
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
    const parts: AudioPart[] = [];
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

  // multipart/form-data: meeting_id (text) + audio (file)
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

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, claim_owner, notes_edited_at, recorders, summary_status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return fail("meeting not found", 404);
  const m = meeting as {
    id: string;
    title: string | null;
    claim_owner: number | null;
    notes_edited_at: string | null;
    recorders: RecorderEntry[] | null;
    summary_status: string | null;
  };

  // Аудио льёт только держатель права транскрибации (claim_owner).
  if (m.claim_owner !== identity.telegramId) {
    return fail("not the transcription owner for this meeting", 403);
  }

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";

  // Защита правок человека: черновик уже правили → не перетранскрибируем и не перегенерим.
  if (m.notes_edited_at) {
    return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "skipped_human_edit" });
  }

  // Идемпотентность: повторный upload (потерянный 202 → ретрай клиента) не должен запускать
  // вторую транскрибацию. 'failed'/null — можно (пере)обработать, 'processing'/'done' — нет.
  if (m.summary_status === "processing" || m.summary_status === "done") {
    return json({ ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "already_processed" });
  }

  // Собираем части дорожек (файлы уже в памяти после req.formData()).
  // Новый контракт: sys_parts/mic_parts — JSON-манифест [{name,offset}] + файлы по name.
  // Легаси: одиночные audio/audio_mic (offset 0) для старых рекордеров.
  let systemParts: AudioPart[];
  let micParts: AudioPart[];
  try {
    systemParts = await buildTrackParts(formData, "sys_parts", "audio", "audio.m4a", 1);
    micParts = await buildTrackParts(formData, "mic_parts", "audio_mic", "audio_mic.m4a", 1024);
  } catch (e) {
    if (e instanceof PartError) return fail(e.message, e.status);
    throw e;
  }
  if (systemParts.length === 0) {
    return fail("audio required (sys_parts manifest or legacy audio field)");
  }

  const recorders = m.recorders ?? [];
  // Метим 'processing' ДО фоновой работы: зависший в этом статусе = незавершённая обработка
  // (например, воркер убит по wall-clock на очень длинной встрече) — это видно снаружи.
  await supabase
    .from("meetings")
    .update({ summary_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", m.id);

  const job = processAudio(m.id, m.title, systemParts, micParts, recorders).catch(async (e) => {
    console.error(`meeting-ingest: processing failed for ${m.id}:`, e);
    // Не глотаем: помечаем 'failed' и явно сообщаем записавшим, что обработка не удалась.
    await supabase
      .from("meetings")
      .update({ summary_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", m.id);
    const note = "⚠️ Не удалось обработать запись встречи — попробуй записать заново.";
    for (const r of recorders) {
      await sendTelegram(r.telegram_id, note).catch(() => {});
    }
  });

  // 202 + фон: транскрибация и тезисы досчитываются после ответа.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
    EdgeRuntime.waitUntil(job);
  } else {
    await job;
  }

  return json(
    { ok: true, meeting_id: meetingId, web_url: webUrl, summary_status: "processing" },
    202,
  );
});
