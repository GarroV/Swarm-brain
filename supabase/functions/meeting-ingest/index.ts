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
interface AudioPart { blob: Blob; name: string }
interface RecorderEntry { telegram_id: number; claimed_at: string; role: string }
interface InlineButton { text: string; url: string }

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

// Транскрибация аудио через OpenAI Whisper (verbose_json → сегменты с таймстампами).
async function transcribeAudio(audio: Blob, filename: string): Promise<Transcript> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("language", "ru");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
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

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
  system: AudioPart,
  mic: AudioPart | null,
  recorders: RecorderEntry[],
): Promise<void> {
  // Транскрибируем системный звук (собеседники) и, если есть, микрофон (я).
  const sys = await transcribeAudio(system.blob, system.name);
  let segments: Segment[] = sys.segments.map((s) => ({ ...s, speaker: "собеседник" }));
  let model = sys.model;
  if (mic) {
    const m = await transcribeAudio(mic.blob, mic.name);
    segments = segments.concat(m.segments.map((s) => ({ ...s, speaker: "я" })));
    model = `${sys.model}+mic`;
  }
  // Сводим по таймстампам (общий старт сессии) → восстанавливаем порядок реплик.
  segments.sort((a, b) => a.start - b.start);
  const transcript: Transcript = { language: sys.language, model, segments };
  await supabase.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", meetingId);

  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  const tezisi = await chatComplete(
    TEZIS_SYSTEM,
    `Встреча: ${title ?? "без названия"}\n\nСтенограмма (реплики помечены «собеседник» — другие участники, «я» — владелец записи):\n${transcriptText}`,
  );
  await supabase
    .from("meetings")
    .update({ draft_notes_md: tezisi, updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${meetingId}` : "";
  const titleStr = title ? `: <b>${title}</b>` : "";
  const text = `📝 Тезисы встречи готовы к вычитке${titleStr}\nВозьмёт любой из участников.`;
  const keyboard: InlineButton[][] | undefined = webUrl ? [[{ text: "Открыть", url: webUrl }]] : undefined;
  for (const r of recorders) {
    await sendTelegram(r.telegram_id, text, keyboard);
  }
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
  const audioField = formData.get("audio");
  if (typeof meetingId !== "string" || meetingId.length === 0) {
    return fail("meeting_id required");
  }
  if (!(audioField instanceof File)) {
    return fail("audio file required");
  }
  if (audioField.size === 0) {
    return fail("audio is empty");
  }
  if (audioField.size > OPENAI_AUDIO_MAX_BYTES) {
    return fail("audio too large (>25MB) — нужна нарезка/сжатие на стороне рекордера", 413);
  }
  // Опциональная вторая дорожка — микрофон владельца записи.
  const micField = formData.get("audio_mic");
  const micFile = micField instanceof File && micField.size > 1024 ? micField : null;
  if (micFile && micFile.size > OPENAI_AUDIO_MAX_BYTES) {
    return fail("audio_mic too large (>25MB)", 413);
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, claim_owner, notes_edited_at, recorders")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return fail("meeting not found", 404);
  const m = meeting as {
    id: string;
    title: string | null;
    claim_owner: number | null;
    notes_edited_at: string | null;
    recorders: RecorderEntry[] | null;
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

  // Считываем аудио в память до ответа, чтобы фон мог им пользоваться.
  const sysBuf = await audioField.arrayBuffer();
  const systemPart: AudioPart = {
    blob: new Blob([sysBuf], { type: audioField.type || "audio/m4a" }),
    name: audioField.name && audioField.name.length > 0 ? audioField.name : "audio.m4a",
  };
  let micPart: AudioPart | null = null;
  if (micFile) {
    const micBuf = await micFile.arrayBuffer();
    micPart = {
      blob: new Blob([micBuf], { type: micFile.type || "audio/m4a" }),
      name: micFile.name && micFile.name.length > 0 ? micFile.name : "audio_mic.m4a",
    };
  }
  const recorders = m.recorders ?? [];

  const job = processAudio(m.id, m.title, systemPart, micPart, recorders).catch((e) => {
    console.error(`meeting-ingest: processing failed for ${m.id}:`, e);
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
