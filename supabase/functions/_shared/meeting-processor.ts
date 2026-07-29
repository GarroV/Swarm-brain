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
import {
  dropConsecutiveRuns,
  isRepeatedFiller,
  isSingleTokenSpam,
  isWhisperHallucination,
  WHISPER_HALLUCINATION_RE,
} from "./whisper-hallucinations.ts";
import {
  langCode,
  type LangVotePart,
  partsNeedingRetranscribe,
  resolveMeetingLang,
} from "./meeting-lang.ts";
import { TEZISY_CORE } from "./tezisy-prompt.ts";
import { extractChatContent } from "./openai-chat.ts";

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
  "НЕТ_ТЕЗИСОВ возвращай ТОЛЬКО для реально пустой записи: тест связи/микрофона, тишина, " +
  "пара бессвязных обрывков. Если в разговоре есть ХОТЬ КАКОЕ-ТО предметное содержание " +
  "(работа, планы, проблемы, договорённости) — пусть вперемешку с болтовнёй и на любом языке — " +
  "ВСЕГДА делай тезисы: болтовню отбрось, суть оставь. НЕ отказывайся из-за неформального тона, " +
  "обилия мелких реплик или иностранного языка. Только при подтверждённой пустоте — верни СТРОГО " +
  "одну строку: НЕТ_ТЕЗИСОВ — и больше ничего, без извинений и пояснений.";

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
  lang?: string;        // язык части, определённый Whisper (имя на англ.)
  viaFallback?: boolean; // сегменты пришли только из d.text-фолбэка (не настоящая речь) → не якорим
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
  claim_owner: number | null;
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

async function transcribeAudio(audio: Blob, filename: string, languageHint?: string): Promise<{ segments: Segment[]; language?: string; viaFallback: boolean }> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  // languageHint (ISO-639-1) — пин языка встречи для дорожки, чей автодетект ненадёжен (тихий/
  // молчащий микрофон Whisper иначе детектит как английский и генерит галлюцинации-«аутро»).
  // ВАЖНО: на hosted OpenAI API `language` — это ТОЛЬКО хинт распознавания, он НИКОГДА не переводит
  // речь (перевод живёт лишь на отдельном /translations, всегда только в английский). Прежний
  // комментарий «language="ru" переводил всё на русский» был ошибочным диагнозом — пин безопасен.
  if (languageHint) form.append("language", languageHint);
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
    language?: string;   // язык, определённый Whisper (имя на англ.: "russian"/"english"/…)
    segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number }>;
  };
  const kept: Segment[] = (d.segments ?? [])
    .filter((s) => !isWhisperHallucination(s.text ?? "", s.no_speech_prob ?? 0, s.avg_logprob ?? 0))
    .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  // Схлопываем подряд идущие одинаковые короткие сегменты — петля Whisper на тишине
  // (напр. «sviđanje»×77 по 5с на молчащем микрофоне), язык-независимо, ДО проверки доминирования.
  const collapsed = dropConsecutiveRuns(kept, (s) => s.text);
  const texts = collapsed.map((s) => s.text);
  // Часть — мусор, если это одна фраза-«аутро» по всем сегментам (isRepeatedFiller) ИЛИ сплошной
  // спам одиночных токенов (тихий микрофон: смесь двух петель держит любой токен под порогом
  // доминирования). В обоих случаях дропаем ВСЁ и НЕ подставляем d.text (тот же повторённый мусор).
  const filler = isRepeatedFiller(texts) || isSingleTokenSpam(texts);
  const segments: Segment[] = filler ? [] : collapsed;
  let viaFallback = false;
  // Фолбэк на d.text — только если он сам не галлюцинация и часть не признана повтором-мусором.
  if (!filler && segments.length === 0 && d.text && !WHISPER_HALLUCINATION_RE.test(d.text)) {
    segments.push({ start: 0, end: 0, text: d.text.trim() });
    viaFallback = true;
  }
  return { segments, language: typeof d.language === "string" ? d.language : undefined, viaFallback };
}

// Проекция частей для чистой логики резолвинга языка (см. _shared/meeting-lang.ts). charCount —
// объём РЕАЛЬНОЙ речи (сумма длин текста сегментов после фильтра галлюцинаций); viaFallback —
// сегмент только из d.text-фолбэка (не голосует).
function toVoteParts(parts: Part[]): LangVotePart[] {
  return parts.map((p) => ({
    done: p.done,
    lang: p.lang,
    charCount: (p.segments ?? []).reduce((n, s) => n + s.text.length, 0),
    viaFallback: p.viaFallback,
  }));
}

// Транскрибирует часть (скачивает из Storage, зовёт Whisper с опциональным пином) и складывает
// результат в part: per-part offset (старт части в таймлайне дорожки) прибавляем сразу; глобальный
// mic-сдвиг применяется на этапе summarize. Используется и в основном цикле, и при ре-транскрибации.
async function transcribePartInto(supabase: SupabaseClient, p: Part, hint?: string): Promise<void> {
  const blob = await downloadPart(supabase, p.path);
  const { segments: segs, language, viaFallback } = await transcribeAudio(blob, p.name, hint);
  p.segments = segs.map((s) => ({ start: s.start + p.offset, end: s.end + p.offset, text: s.text }));
  if (language) p.lang = language;
  p.viaFallback = viaFallback;
  p.done = true;
}

// Модель тезисов — gpt-5.6-terra: на реальных встречах даёт заметно более конкретные тезисы, чем
// gpt-4o (тот на содержательных встречах иногда ошибочно возвращал НЕТ_ТЕЗИСОВ, теряя запись).
// GPT-5 в chat/completions требует max_completion_tokens (не max_tokens) и НЕ принимает temperature.
const TEZIS_MODEL = "gpt-5.6-terra";
// Фолбэк, если основная модель недоступна (напр. 403 insufficient permissions под нагрузкой):
// openaiFetch ретраит только 429/5xx, поэтому такую ошибку страхуем здесь — тезисы не должны
// теряться из-за проблем с одной моделью.
const TEZIS_FALLBACK_MODEL = "gpt-4o";
const isGpt5 = (model: string): boolean => /^gpt-5/.test(model);
// GPT-5 списывает reasoning-токены из max_completion_tokens. На длинной стенограмме reasoning
// съедал весь бюджет 4000 → content="" (finish=length) → пустые тезисы записывались как готовые
// (инцидент 2026-07-21, af86df08). Держим maxTokens как бюджет СОДЕРЖИМОГО, а reasoning
// оплачиваем сверху; остаточные пустые ответы ловит extractChatContent → фолбэк на gpt-4o.
const GPT5_REASONING_HEADROOM = 8000;

interface ChatOpts { temperature?: number; model?: string; maxTokens?: number }

async function chatComplete(system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4000;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];

  const callModel = async (model: string): Promise<string> => {
    // GPT-5 — max_completion_tokens + без temperature; старые модели — max_tokens (+ temperature).
    const body: Record<string, unknown> = isGpt5(model)
      ? { model, messages, max_completion_tokens: maxTokens + GPT5_REASONING_HEADROOM }
      : { model, messages, max_tokens: maxTokens, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) };
    const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
    return extractChatContent(data, model);
  };

  const model = opts.model ?? TEZIS_MODEL;
  try {
    return await callModel(model);
  } catch (e) {
    // Основная модель упала — не теряем тезисы: пробуем запасную (только если основная была gpt-5).
    if (isGpt5(model) && TEZIS_FALLBACK_MODEL !== model) {
      console.error(`meeting-processor: тезисы на ${model} упали (${e}), фолбэк на ${TEZIS_FALLBACK_MODEL}`);
      return await callModel(TEZIS_FALLBACK_MODEL);
    }
    throw e;
  }
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

// telegram_id владельца микрофонной дорожки («я» в стенограмме). Авторитетный источник —
// meetings.claim_owner: mic-дорожку заливает ТОЛЬКО claim_owner (meeting-ingest отбивает 403 на
// чужой аплоад), поэтому claim_owner === владелец «я» по построению, даже после перехвата протухшей
// брони (recorders[0] в этом случае — уже НЕ тот, кто записал). recorders[0] оставляем лишь как
// фолбэк для легаси-строк без claim_owner.
function micOwnerId(claimOwner: number | null, recorders: RecorderEntry[] | null): number | null {
  if (typeof claimOwner === "number") return claimOwner;
  return (recorders ?? []).map((r) => r?.telegram_id).find((n): n is number => typeof n === "number") ?? null;
}

// Имя владельца записи для легенды спикеров тезисов: telegram_id → user_profiles(first/last) →
// фолбэк @username из allowed_users. null, если не резолвится (легенда останется обезличенной).
async function resolveOwnerName(supabase: SupabaseClient, telegramId: number | null): Promise<string | null> {
  if (telegramId == null) return null;
  const [{ data: prof }, { data: au }] = await Promise.all([
    supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", telegramId).maybeSingle(),
    supabase.from("allowed_users").select("username").eq("telegram_id", telegramId).maybeSingle(),
  ]);
  const p = prof as { first_name?: string | null; last_name?: string | null } | null;
  const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  const uname = (au as { username?: string | null } | null)?.username;
  return uname ? `@${uname}` : null;
}

// Легенда спикеров для промпта тезисов. Если владелец записи известен — называем его по имени,
// чтобы модель атрибутировала реплики «я» именно ему, а не делала «главным героем» собеседника,
// чьё имя всплывает в разговоре (корневая причина жалобы владельца на перекос атрибуции).
function speakerLegend(ownerName: string | null): string {
  const me = ownerName ? `«я» — это ${ownerName} (владелец записи)` : "«я» — владелец записи";
  return `Стенограмма (реплики помечены «собеседник» — другие участники, ${me}):`;
}

// ── Финал: сводим транскрипт → тезисы → done → уведомляем → чистим Storage ──────
async function summarizeAndFinish(supabase: SupabaseClient, m: MeetingRow, state: ProcessState): Promise<void> {
  const micOffset = typeof m.mic_start_offset === "number" && Number.isFinite(m.mic_start_offset) ? m.mic_start_offset : 0;
  // Язык встречи — язык-нейтральный автодетект, взвешенный по объёму РЕАЛЬНОЙ речи по всем частям
  // (см. _shared/meeting-lang.ts). Русская встреча → russian, английская → english. Нет реальной
  // речи → undefined (пина нет, каждый чанк остаётся на своём автодетекте Whisper — без форс-ru).
  const resolved = resolveMeetingLang(toVoteParts(state.parts));

  // Части, чей детект языка ≠ языку встречи, — ПЕРЕтранскрибируем с пином языка встречи (а НЕ
  // выбрасываем: дропать реальный транскрипт владельца хуже болезни). Только рассинхронные, не
  // блэнкет-двойной проход. Пин ставим лишь если язык резолвился и мапится в ISO; аудио ещё в
  // Storage (чистим ниже).
  const pin = resolved ? langCode(resolved) : undefined;
  if (resolved && pin) {
    const idxs = partsNeedingRetranscribe(toVoteParts(state.parts), resolved);
    for (const i of idxs) {
      try {
        await transcribePartInto(supabase, state.parts[i], pin);
      } catch (e) {
        console.error(`meeting-processor: ре-транскрибация части ${state.parts[i].path} упала:`, e);
      }
    }
    if (idxs.length > 0) await saveState(supabase, m.id, state);
  }

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
  const transcript = { language: resolved, model: hasMic ? "whisper-1+mic" : "whisper-1", segments };
  await supabase.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", m.id);

  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  // Пустая стенограмма (всё вычищено фильтром) → не зовём GPT за «отпиской». Иначе GPT сам решает:
  // нет содержания → НЕТ_ТЕЗИСОВ (см. TEZIS_SYSTEM) → подменяем на короткую плашку.
  let tezisi: string;
  if (!transcriptText.trim()) {
    tezisi = NO_TEZISY_NOTE;
  } else {
    const ownerName = await resolveOwnerName(supabase, micOwnerId(m.claim_owner, m.recorders));
    const raw = (await chatComplete(
      TEZIS_SYSTEM,
      `Встреча: ${m.title ?? "без названия"}\n\n${speakerLegend(ownerName)}\n${transcriptText}`,
      { temperature: 0.3 }, // применяется к фолбэк-gpt-4o; terra (GPT-5) температуру игнорирует
    )).trim();
    // Пустой ответ модели при СОДЕРЖАТЕЛЬНОМ транскрипте — это сбой сводки, а НЕ пустая встреча.
    // Раньше "" сохранялось с summary_status="done" → ревью вечно «Тезисы готовятся…» без кнопки.
    // Транскрипт уже сохранён выше; метим failed → на ревью доступно «Переобработать».
    if (!raw) {
      console.error(`meeting-processor: пустая сводка от модели для ${m.id} при непустом транскрипте (${transcriptText.length} симв) — mark failed`);
      await supabase.from("meetings")
        .update({ summary_status: "failed", last_progress_at: new Date().toISOString(), processing_lease: null, updated_at: new Date().toISOString() })
        .eq("id", m.id);
      return;
    }
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
          { model: "gpt-4o-mini", maxTokens: 60 }, // заголовок — дешёвая быстрая модель, не terra
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
  const { data } = await supabase.from("meetings").select("id, title, transcript, recorders, claim_owner").eq("id", meetingId).single();
  const row = data as { title: string | null; transcript: { segments?: Segment[] } | null; recorders: RecorderEntry[] | null; claim_owner: number | null } | null;
  const segments = row?.transcript?.segments ?? [];
  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  if (!transcriptText.trim()) return NO_TEZISY_NOTE;
  const ownerName = await resolveOwnerName(supabase, micOwnerId(row?.claim_owner ?? null, row?.recorders ?? null));
  const raw = (await chatComplete(
    TEZIS_SYSTEM,
    `Встреча: ${row?.title ?? "без названия"}\n\n${speakerLegend(ownerName)}\n${transcriptText}`,
    { temperature: 0.3 },
  )).trim();
  // Пустой ответ модели — не затираем существующие тезисы пустой строкой и не метим done;
  // бросаем, чтобы swarm-api вернул ошибку, а кнопка «Переобработать» осталась для повторной попытки.
  if (!raw) throw new Error("Модель вернула пустые тезисы — попробуй ещё раз");
  const tezisi = /^НЕТ[_\s]?ТЕЗИСОВ/i.test(raw) ? NO_TEZISY_NOTE : raw;
  // Успешно записали тезисы → приводим summary_status в согласованность: встреча, ранее упавшая в
  // "failed", после успешной переобработки не должна оставаться "failed" (иначе UI врёт про статус).
  await supabase.from("meetings")
    .update({ draft_notes_md: tezisi, summary_status: "done", updated_at: new Date().toISOString() })
    .eq("id", meetingId);
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
      .select("id, title, recorders, claim_owner, mic_start_offset, summary_status, process_state")
      .eq("id", meetingId)
      .maybeSingle();
    const m = data as MeetingRow | null;
    if (!m || !m.process_state || m.summary_status !== "processing") {
      return { claimed: true, done: m?.summary_status === "done" };
    }
    const state = m.process_state;

    if (state.stage === "transcribe") {
      while (Date.now() - startedAt < budgetMs) {
        const pendingAll = state.parts.filter((p) => !p.done && p.attempts < MAX_PART_ATTEMPTS);
        if (pendingAll.length === 0) break;
        // Сначала ПОЛНОСТЬЮ системные части — они задают язык встречи; только потом микрофон, уже
        // с пином этого языка (иначе тихий микрофон галлюцинирует по-английски). Пока есть pending
        // sys — берём только их; система закончилась → переходим к микрофону с языком встречи.
        const pendingSys = pendingAll.filter((p) => p.track === "sys");
        const pending = pendingSys.length > 0 ? pendingSys : pendingAll;
        // Пин микрофона = язык встречи, взвешенный по объёму реальной речи по всем готовым частям
        // (язык-нейтрально). Пока речи мало (первые чанки тишины) — undefined → микрофон на
        // автодетекте Whisper; по мере накопления реальных символов пин сходится к языку встречи, а
        // ранние флипнутые чанки чинятся ре-транскрибацией на сведении. Форс-ru нет.
        const micHint = pendingSys.length > 0
          ? undefined
          : langCode(resolveMeetingLang(toVoteParts(state.parts)));
        const batch = pending.slice(0, TRANSCRIBE_CONCURRENCY);
        await mapLimit(batch, TRANSCRIBE_CONCURRENCY, async (p) => {
          try {
            // Микрофон пинуем на язык встречи; систему — как есть (автодетект).
            const hint = p.track === "mic" ? micHint : undefined;
            await transcribePartInto(supabase, p, hint);
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
