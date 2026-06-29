// meeting-processor — резюмируемая обработка аудио встреч ПО КУСКУ (durable).
//
// Зачем: транскрибация длинной встречи в одном вызове Edge Function упирается в wall-clock
// (~400s) и воркер умирает → summary навсегда 'processing'. Здесь обработка разбита на шаги:
// аудио-части лежат в Storage (bucket meeting-audio), каждый шаг транскрибирует следующие
// части в рамках бюджета времени, копит сегменты в meetings.process_state, и переживает
// смерть воркера — следующий тик cron (функция meeting-process) продолжит с того же места.
//
// Поток состояния (process_state.stage): 'transcribe' → 'summarize' → summary_status='done'.
// Защита от двойной обработки — лиз (processing_lease). Heartbeat — last_progress_at (его
// смотрит watchdog: валит в 'failed' только по ЗАСТОЮ, а не по общему возрасту). Poison-part
// (часть, которая стабильно падает) добивается через attempts и не блокирует встречу вечно.
//
// Используется двумя функциями: meeting-ingest (приём + inline-проход) и meeting-process (cron).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isWhisperHallucination, WHISPER_HALLUCINATION_RE } from "./whisper-hallucinations.ts";
import { TEZISY_CORE } from "./tezisy-prompt.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

export const AUDIO_BUCKET = "meeting-audio";
// Параллелизм транскрибации частей в одном шаге. Whisper-вызовы — сетевой I/O (не жрут CPU-лимит),
// можно держать несколько в полёте, но без фанатизма — rate-limit OpenAI.
const TRANSCRIBE_CONCURRENCY = 3;
// Попыток на одну часть, прежде чем считать её «отравленной» и пропустить (poison-pill guard).
const MAX_PART_ATTEMPTS = 4;
// Лиз протух → воркер, взявший встречу, считается мёртвым, и её можно перехватить.
export const LEASE_STALE_MS = 5 * 60_000;

const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

// Канон тезисов — в _shared/tezisy-prompt.ts (DRY с granola/read-ai). Здесь добавляем только
// спец-обработку пустой записи (НЕТ_ТЕЗИСОВ → плашка ниже).
const TEZIS_SYSTEM =
  TEZISY_CORE + "\n" +
  "Если в стенограмме нет содержательного обсуждения (проверка связи, тест микрофона, тишина, " +
  "обрывки фраз) — верни СТРОГО одну строку: НЕТ_ТЕЗИСОВ — и больше ничего, без извинений и пояснений.";

// Плашка вместо тезисов, когда обсуждать в записи нечего. Короткая и нейтральная — стенограмма
// (если есть) видна на экране вычитки ниже; пустые/бессмысленные тезисы туда не пишем.
const NO_TEZISY_NOTE = "В записи нет содержательного обсуждения — тезисы не сформированы. Ниже доступна стенограмма.";

export interface Segment { start: number; end: number; text: string; speaker?: string }
// Одна часть дорожки в Storage. segments заполняются ПОСЛЕ успешной транскрибации (offset уже
// прибавлен — глобальный сдвиг mic применяется на этапе summarize).
export interface Part {
  track: "sys" | "mic";
  name: string;
  offset: number;
  path: string;        // путь в бакете meeting-audio
  done: boolean;
  attempts: number;
  segments?: Segment[];
}
export interface ProcessState { parts: Part[]; stage: "transcribe" | "summarize" }
// Части в памяти (как их собрал meeting-ingest из multipart) до заливки в Storage.
export interface InMemoryPart { blob: Blob; name: string; offset: number }
interface RecorderEntry { telegram_id: number; claimed_at?: string; role?: string }
interface InlineButton { text: string; url: string }
interface MeetingRow {
  id: string;
  title: string | null;
  recorders: RecorderEntry[] | null;
  mic_start_offset: number | null;
  summary_status: string | null;
  process_state: ProcessState | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── OpenAI / Telegram ─────────────────────────────────────────────────────────
async function openaiFetch(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 1; i < attempts; i++) {
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (res.ok || !retryable) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, i - 1) * 1000;
    await res.body?.cancel();
    await sleep(delayMs);
    res = await fetch(url, init);
  }
  return res;
}

async function transcribeAudio(audio: Blob, filename: string): Promise<Segment[]> {
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
  const d = data as {
    text?: string;
    segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number }>;
  };
  const segments: Segment[] = (d.segments ?? [])
    .filter((s) => !isWhisperHallucination(s.text ?? "", s.no_speech_prob ?? 0, s.avg_logprob ?? 0))
    .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  // Фолбэк на d.text — только если он сам не галлюцинация (иначе вернули бы тот же мусор).
  if (segments.length === 0 && d.text && !WHISPER_HALLUCINATION_RE.test(d.text)) {
    segments.push({ start: 0, end: 0, text: d.text.trim() });
  }
  return segments;
}

async function chatComplete(system: string, user: string, temperature?: number): Promise<string> {
  const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 3000,
      ...(temperature !== undefined ? { temperature } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
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

// ── Storage ─────────────────────────────────────────────────────────────────
async function downloadPart(supabase: SupabaseClient, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  return data as Blob;
}

async function cleanupStorage(supabase: SupabaseClient, state: ProcessState): Promise<void> {
  const paths = state.parts.map((p) => p.path);
  if (paths.length === 0) return;
  try { await supabase.storage.from(AUDIO_BUCKET).remove(paths); } catch { /* лучше осиротевший файл, чем сбой done */ }
}

// Заливает части (из памяти) в Storage и строит начальный process_state. Часть > 25МБ
// (лимит Whisper) — ошибка наверх (рекордер режет, но подстрахуемся). Вызывается meeting-ingest.
export async function uploadPartsAndBuildState(
  supabase: SupabaseClient,
  meetingId: string,
  systemParts: InMemoryPart[],
  micParts: InMemoryPart[],
): Promise<ProcessState> {
  const parts: Part[] = [];
  const upload = async (track: "sys" | "mic", list: InMemoryPart[]) => {
    for (const p of list) {
      if (p.blob.size > OPENAI_AUDIO_MAX_BYTES) throw new Error(`part "${p.name}" too large (>25MB)`);
      const path = `${meetingId}/${track}-${p.name}`;
      const { error } = await supabase.storage.from(AUDIO_BUCKET)
        .upload(path, p.blob, { contentType: "audio/m4a", upsert: true });
      if (error) throw new Error(`upload ${path}: ${error.message}`);
      parts.push({ track, name: p.name, offset: p.offset, path, done: false, attempts: 0 });
    }
  };
  await upload("sys", systemParts);
  await upload("mic", micParts);
  return { parts, stage: "transcribe" };
}

// ── Лиз и состояние ───────────────────────────────────────────────────────────
// Атомарно берём лиз: ставим processing_lease=now ТОЛЬКО если он пуст или протух. Параллельный
// тик/проход получит null (его WHERE не сматчит свежий лиз) → не возьмётся за ту же встречу.
async function claimLease(supabase: SupabaseClient, id: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  const { data } = await supabase
    .from("meetings")
    .update({ processing_lease: nowIso })
    .eq("id", id)
    .eq("summary_status", "processing")
    .or(`processing_lease.is.null,processing_lease.lt.${staleIso}`)
    .select("id")
    .maybeSingle();
  return !!data;
}

async function releaseLease(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("meetings").update({ processing_lease: null }).eq("id", id);
}

// Персист прогресса: process_state + heartbeat. summary_status НЕ трогаем (остаётся processing).
async function saveState(supabase: SupabaseClient, id: string, state: ProcessState): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase.from("meetings")
    .update({ process_state: state, last_progress_at: nowIso, updated_at: nowIso })
    .eq("id", id);
}

async function markFailed(supabase: SupabaseClient, m: MeetingRow): Promise<void> {
  await supabase.from("meetings")
    .update({ summary_status: "failed", processing_lease: null, updated_at: new Date().toISOString() })
    .eq("id", m.id);
  const note = "⚠️ Не удалось обработать запись встречи — не получилось транскрибировать аудио. Попробуй записать заново.";
  for (const r of m.recorders ?? []) {
    if (r && typeof r.telegram_id === "number") await sendTelegram(r.telegram_id, note).catch(() => {});
  }
}

// ── Финал: сводим транскрипт → тезисы → done → уведомляем → чистим Storage ──────
async function summarizeAndFinish(supabase: SupabaseClient, m: MeetingRow, state: ProcessState): Promise<void> {
  const micOffset = typeof m.mic_start_offset === "number" && Number.isFinite(m.mic_start_offset) ? m.mic_start_offset : 0;
  const segments: Segment[] = [];
  for (const p of state.parts) {
    if (!p.done || !p.segments) continue;
    const speaker = p.track === "sys" ? "собеседник" : "я";
    // Глобальный сдвиг mic↔system добавляем тут (per-part offset уже учтён при транскрибации).
    const shift = p.track === "mic" ? micOffset : 0;
    for (const s of p.segments) segments.push({ start: s.start + shift, end: s.end + shift, text: s.text, speaker });
  }
  segments.sort((a, b) => a.start - b.start);

  const hasMic = state.parts.some((p) => p.track === "mic" && p.done);
  const transcript = { language: "ru", model: hasMic ? "whisper-1+mic" : "whisper-1", segments };
  await supabase.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", m.id);

  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  // Пустая стенограмма (всё вычищено фильтром) → не зовём GPT за «отпиской». Иначе GPT сам решает:
  // нет содержания → НЕТ_ТЕЗИСОВ (см. TEZIS_SYSTEM) → подменяем на короткую плашку.
  let tezisi: string;
  if (!transcriptText.trim()) {
    tezisi = NO_TEZISY_NOTE;
  } else {
    const raw = (await chatComplete(
      TEZIS_SYSTEM,
      `Встреча: ${m.title ?? "без названия"}\n\nСтенограмма (реплики помечены «собеседник» — другие участники, «я» — владелец записи):\n${transcriptText}`,
      0.3, // ниже дефолта (1.0): меньше воды, держится фактов из стенограммы
    )).trim();
    tezisi = /^НЕТ[_\s]?ТЕЗИСОВ/i.test(raw) ? NO_TEZISY_NOTE : raw;
  }
  const noContent = tezisi === NO_TEZISY_NOTE;

  let finalTitle = m.title;
  if (!m.title || /^Запись\s/i.test(m.title)) {
    // Для бессодержательной записи не выдумываем красивый титул из обрывков — нейтральная заглушка.
    if (noContent) {
      finalTitle = "Тема встречи не установлена";
    } else {
      try {
        const t = (await chatComplete(
          "Придумай короткое название встречи на русском: 3–6 слов, по сути обсуждения, без даты, кавычек и префиксов. Верни ТОЛЬКО название.",
          tezisi.slice(0, 2000),
        )).trim().replace(/^["«»\s]+|["«»\s]+$/g, "").slice(0, 120);
        if (t) finalTitle = t;
      } catch { /* оставляем исходный заголовок */ }
    }
  }

  const nowIso = new Date().toISOString();
  await supabase.from("meetings")
    .update({ draft_notes_md: tezisi, title: finalTitle, summary_status: "done", last_progress_at: nowIso, processing_lease: null, updated_at: nowIso })
    .eq("id", m.id);

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${m.id}` : "";
  const titleStr = finalTitle ? `: <b>${finalTitle}</b>` : "";
  const text = `📝 Тезисы встречи готовы к вычитке${titleStr}\nВозьмёт любой из участников.`;
  const keyboard: InlineButton[][] | undefined = webUrl ? [[{ text: "Открыть", url: webUrl }]] : undefined;
  for (const r of m.recorders ?? []) {
    if (r && typeof r.telegram_id === "number") await sendTelegram(r.telegram_id, text, keyboard).catch(() => {});
  }

  await cleanupStorage(supabase, state);
}

// Пере-сводка тезисов из УЖЕ сохранённого транскрипта (meetings.transcript) ТЕКУЩИМ промптом —
// без повторной транскрибации. Для кнопки «Переобработать тезисы» на ревью (вызывается из swarm-api).
// Тот же путь, что и при первичной сводке (TEZIS_SYSTEM, temp 0.3) — один источник правды.
// Заголовок НЕ трогаем (мог быть отредактирован вручную). Возвращает новые тезисы.
export async function resummarizeFromTranscript(supabase: SupabaseClient, meetingId: string): Promise<string> {
  const { data } = await supabase.from("meetings").select("id, title, transcript").eq("id", meetingId).single();
  const row = data as { title: string | null; transcript: { segments?: Segment[] } | null } | null;
  const segments = row?.transcript?.segments ?? [];
  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  if (!transcriptText.trim()) return NO_TEZISY_NOTE;
  const raw = (await chatComplete(
    TEZIS_SYSTEM,
    `Встреча: ${row?.title ?? "без названия"}\n\nСтенограмма (реплики помечены «собеседник» — другие участники, «я» — владелец записи):\n${transcriptText}`,
    0.3,
  )).trim();
  const tezisi = /^НЕТ[_\s]?ТЕЗИСОВ/i.test(raw) ? NO_TEZISY_NOTE : raw;
  await supabase.from("meetings").update({ draft_notes_md: tezisi, updated_at: new Date().toISOString() }).eq("id", meetingId);
  return tezisi;
}

// ── Главный шаг ─────────────────────────────────────────────────────────────
// Делает ОГРАНИЧЕННУЮ бюджетом работу по одной встрече: берёт лиз, транскрибирует следующие
// части, и если все готовы — сводит тезисы. Безопасно прерывается по бюджету (cron продолжит).
// Возвращает {claimed, done}: claimed=false → встречу обрабатывает кто-то другой (лиз занят).
export async function runMeetingStep(
  supabase: SupabaseClient,
  meetingId: string,
  budgetMs: number,
): Promise<{ claimed: boolean; done: boolean }> {
  const startedAt = Date.now();
  if (!(await claimLease(supabase, meetingId))) return { claimed: false, done: false };

  try {
    const { data } = await supabase
      .from("meetings")
      .select("id, title, recorders, mic_start_offset, summary_status, process_state")
      .eq("id", meetingId)
      .maybeSingle();
    const m = data as MeetingRow | null;
    if (!m || !m.process_state || m.summary_status !== "processing") {
      return { claimed: true, done: m?.summary_status === "done" };
    }
    const state = m.process_state;

    if (state.stage === "transcribe") {
      while (Date.now() - startedAt < budgetMs) {
        const pending = state.parts.filter((p) => !p.done && p.attempts < MAX_PART_ATTEMPTS);
        if (pending.length === 0) break;
        const batch = pending.slice(0, TRANSCRIBE_CONCURRENCY);
        await mapLimit(batch, TRANSCRIBE_CONCURRENCY, async (p) => {
          try {
            const blob = await downloadPart(supabase, p.path);
            const segs = await transcribeAudio(blob, p.name);
            // per-part offset (старт части в таймлайне дорожки) добавляем сразу; глобальный mic-сдвиг — в summarize.
            p.segments = segs.map((s) => ({ start: s.start + p.offset, end: s.end + p.offset, text: s.text }));
            p.done = true;
          } catch (e) {
            p.attempts = (p.attempts ?? 0) + 1;
            console.error(`meeting-processor: part ${p.path} attempt ${p.attempts} failed:`, e);
          }
        });
        await saveState(supabase, meetingId, state);
      }
      const recoverable = state.parts.filter((p) => !p.done && p.attempts < MAX_PART_ATTEMPTS);
      if (recoverable.length > 0) return { claimed: true, done: false }; // ещё есть части — продолжит следующий тик
      // Все оставшиеся части либо готовы, либо отравлены. Если не вышло НИ ОДНОЙ — это провал.
      if (!state.parts.some((p) => p.done)) {
        await markFailed(supabase, m);
        return { claimed: true, done: true };
      }
      state.stage = "summarize";
      await saveState(supabase, meetingId, state);
    }

    if (state.stage === "summarize") {
      await summarizeAndFinish(supabase, m, state);
      return { claimed: true, done: true };
    }
    return { claimed: true, done: false };
  } finally {
    // Снимаем лиз, ЕСЛИ встреча ещё processing (done/failed уже обнулили его сами).
    await releaseLease(supabase, meetingId).catch(() => {});
  }
}
