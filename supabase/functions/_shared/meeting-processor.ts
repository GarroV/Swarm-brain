// meeting-processor — резюмируемая обработка аудио встреч ПО КУСКУ (durable).
//
// Зачем: транскрибация длинной встречи в одном вызове Edge Function упирается в wall-clock
// (~400s) и воркер умирает → summary навсегда 'processing'. Здесь обработка разбита на шаги:
// аудио-части лежат в Storage (bucket meeting-audio), каждый шаг транскрибирует следующие
// части в рамках бюджета времени, копит сегменты в meetings.process_state, и переживает
// смерть воркера — следующий тик cron (функция meeting-process) продолжит с того же места.
//
// Поток состояния (process_state.stage): 'transcribe' → 'summarize' → summary_status='done'.
// Защита от двойной обработки — лиз (processing_lease, `meeting-processing-lease.ts`): его значение —
// токен воркера, каждая запись воркера условна по токену и продлевает лиз (issue #578). Heartbeat — last_progress_at (его
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
import { langCode, type LangVotePart, partsNeedingRetranscribe, resolveMeetingLang } from "./meeting-lang.ts";
import { buildTezisyUserMessage, TEZISY_PROMPT } from "./tezisy-prompt.ts";
import { glossaryWhisperHint } from "./glossary.ts";
import { useGlossaryHint } from "./bot-profile.ts";
import { extractChatContent } from "./openai-chat.ts";
import { buildSegments, type Segment, speakerLegend, type SpeakerSpan } from "./speakers.ts";
import { arbitrateFullness, transcriptVolume } from "./meeting-fullness.ts";
import { processingFrozen } from "./processing-freeze.ts";
import { discardState, promoteQueued, requeueLost } from "./meeting-queue.ts";
import { isFrozen, unfrozen } from "./meeting-frozen.ts";
import { type RivalClaim, rivalOwnershipPatch, settleRival } from "./meeting-rival.ts";
import { claimLeaseUntil } from "./meeting-lease.ts";
import { isLeaseLost, LEASE_STALE_MS, ProcessingLease, rethrowIfLeaseLost } from "./meeting-processing-lease.ts";

export type { Segment, SpeakerSpan };

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

export const AUDIO_BUCKET = "meeting-audio";
// Параллелизм транскрибации частей в одном шаге. Whisper-вызовы — сетевой I/O (не жрут CPU-лимит),
// можно держать несколько в полёте, но без фанатизма — rate-limit OpenAI.
const TRANSCRIBE_CONCURRENCY = 3;
// Попыток на одну часть, прежде чем считать её «отравленной» и пропустить (poison-pill guard).
const MAX_PART_ATTEMPTS = 4;
// Лиз протух → воркер, взявший встречу, считается мёртвым (канон — meeting-processing-lease.ts).
export { LEASE_STALE_MS };
// Потолок одного обращения к модели (Whisper, тезисы). Без него зависший ответ держал воркер до
// убийства рантаймом; лиз всё это время продлевал бы пульс, и встреча стояла бы за мёртвым вызовом.
export const MODEL_CALL_TIMEOUT_MS = 180_000;

const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

// Канон тезисов — в _shared/tezisy-prompt.ts (DRY с granola/read-ai). Здесь добавляем только
// спец-обработку пустой записи (НЕТ_ТЕЗИСОВ → плашка ниже). Экспорт — для сухого прогона
// scripts/tezisy-injection-dryrun.ts: он обязан звать ровно тот промпт и ту модель, что и прод.
export const TEZIS_SYSTEM = TEZISY_PROMPT + "\n" +
  "НЕТ_ТЕЗИСОВ возвращай ТОЛЬКО для реально пустой записи: тест связи/микрофона, тишина, " +
  "пара бессвязных обрывков. Если в разговоре есть ХОТЬ КАКОЕ-ТО предметное содержание " +
  "(работа, планы, проблемы, договорённости) — пусть вперемешку с болтовнёй и на любом языке — " +
  "ВСЕГДА делай тезисы: болтовню отбрось, суть оставь. НЕ отказывайся из-за неформального тона, " +
  "обилия мелких реплик или иностранного языка. Только при подтверждённой пустоте — верни СТРОГО " +
  "одну строку: НЕТ_ТЕЗИСОВ — и больше ничего, без извинений и пояснений.";

// Плашка вместо тезисов, когда обсуждать в записи нечего. Короткая и нейтральная — стенограмма
// (если есть) видна на экране вычитки ниже; пустые/бессмысленные тезисы туда не пишем.
const NO_TEZISY_NOTE = "В записи нет содержательного обсуждения — тезисы не сформированы. Ниже доступна стенограмма.";

// Segment живёт в _shared/speakers.ts (там же сведение с таймлайном говорящих) и ре-экспортируется
// выше — потребители продолжают импортировать его отсюда.
// Одна часть дорожки в Storage. segments заполняются ПОСЛЕ успешной транскрибации (offset уже
// прибавлен — глобальный сдвиг mic применяется на этапе summarize).
export interface Part {
  track: "sys" | "mic";
  name: string;
  offset: number;
  path: string; // путь в бакете meeting-audio
  done: boolean;
  attempts: number;
  segments?: Segment[];
  lang?: string; // язык части, определённый Whisper (имя на англ.)
  viaFallback?: boolean; // сегменты пришли только из d.text-фолбэка (не настоящая речь) → не якорим
}
// speakers — необязательный таймлайн говорящих (секунды от начала записи), присланный полем
// `speakers` формы meeting-ingest. Живёт в той же jsonb-колонке meetings.process_state, миграции
// не требует; старые строки его не имеют — это и есть путь мягкой деградации.
//
// Поля второй записи одной встречи (T156) — все необязательные, старые состояния их не имеют и
// обрабатываются ровно как раньше:
//   gen      — поколение выгрузки. Воркер пишет в строку, только пока `process_state.gen` — его:
//              состояние, обнулённое перехватом claim или заменённое другой записью, он не
//              перетирает (раньше побеждал последний писавший, см. meeting-queue.requeueLost);
//   source   — чья выгрузка (`agent:<id>` | `person`, meeting-ingest/second-recording.ts);
//   sources  — все источники, чьи выгрузки встреча приняла (повтор не становится «второй записью»);
//   owner    — claim_owner на момент выгрузки;
//   challenge — вторая запись: в конце сравнить объём распознанного с текущей стенограммой и
//              оставить более полную; priorStatus — какой summary_status вернуть, если текущая полнее;
//   rival    — запись другого человека, претендента (meeting-rival.ts): владелец встречи перейдёт к
//              `owner` той же UPDATE, что пишет стенограмму, и только если осталась эта запись.
export interface ProcessState {
  parts: Part[];
  stage: "transcribe" | "summarize";
  speakers?: SpeakerSpan[];
  gen?: string;
  source?: string;
  sources?: string[];
  owner?: number;
  challenge?: { priorStatus: string | null };
  rival?: RivalClaim;
}
/** Кто и какую выгрузку кладёт в состояние (meeting-ingest). */
export interface UploadMeta {
  gen: string;
  source: string;
  sources: string[];
  owner: number;
  challenge?: { priorStatus: string | null };
  rival?: RivalClaim;
}
// Части в памяти (как их собрал meeting-ingest из multipart) до заливки в Storage.
export interface InMemoryPart {
  blob: Blob;
  name: string;
  offset: number;
}
interface RecorderEntry {
  telegram_id: number;
  claimed_at?: string;
  role?: string;
}
interface InlineButton {
  text: string;
  url: string;
}
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
// Каждая попытка — со своим потолком времени; `signal` (лиз потерян) прерывает и ожидание, и паузу.
async function openaiFetch(url: string, init: RequestInit, signal?: AbortSignal, attempts = 4): Promise<Response> {
  const attempt = () => {
    const timeout = AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS);
    signal?.throwIfAborted();
    return fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };
  let res = await attempt();
  for (let i = 1; i < attempts; i++) {
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (res.ok || !retryable) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, i - 1) * 1000;
    await res.body?.cancel();
    await sleep(delayMs);
    res = await attempt();
  }
  return res;
}

async function transcribeAudio(
  audio: Blob,
  filename: string,
  languageHint?: string,
  withGlossary = true,
  signal?: AbortSignal,
): Promise<{ segments: Segment[]; language?: string; viaFallback: boolean }> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  // Хинт написания имён собственных (Wolt/Београд/Нови Сад…) — снижает мишеринг Whisper.
  // best-effort: `prompt` в Whisper только смещает распознавание, не гарантирует.
  // Запись бота идёт без подсказки: профиль бота, #620 (`useGlossaryHint`).
  if (withGlossary) form.append("prompt", glossaryWhisperHint());
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
  }, signal);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI transcription error");
  }
  const d = data as {
    text?: string;
    language?: string; // язык, определённый Whisper (имя на англ.: "russian"/"english"/…)
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
async function transcribePartInto(
  supabase: SupabaseClient,
  p: Part,
  hint: string | undefined,
  source: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const blob = await downloadPart(supabase, p.path);
  const { segments: segs, language, viaFallback } = await transcribeAudio(
    blob,
    p.name,
    hint,
    useGlossaryHint(source),
    signal,
  );
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

interface ChatOpts {
  temperature?: number;
  model?: string;
  maxTokens?: number;
  /** Отмена извне: лиз обработки потерян — ответ модели уже некому записать. */
  signal?: AbortSignal;
}

export async function chatComplete(system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4000;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];

  const callModel = async (model: string): Promise<string> => {
    // GPT-5 — max_completion_tokens + без temperature; старые модели — max_tokens (+ temperature).
    const body: Record<string, unknown> = isGpt5(model)
      ? { model, messages, max_completion_tokens: maxTokens + GPT5_REASONING_HEADROOM }
      : {
        model,
        messages,
        max_tokens: maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      };
    const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    }, opts.signal);
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
    return extractChatContent(data, model);
  };

  const model = opts.model ?? TEZIS_MODEL;
  try {
    return await callModel(model);
  } catch (e) {
    // Отменили извне (лиз потерян) — запасная модель тоже ни к чему.
    if (opts.signal?.aborted) throw opts.signal.reason ?? e;
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
  try {
    await supabase.storage.from(AUDIO_BUCKET).remove(paths);
  } catch { /* лучше осиротевший файл, чем сбой done */ }
}

// Заливает части (из памяти) в Storage и строит начальный process_state. Часть > 25МБ
// (лимит Whisper) — ошибка наверх (рекордер режет, но подстрахуемся). Вызывается meeting-ingest.
export async function uploadPartsAndBuildState(
  supabase: SupabaseClient,
  meetingId: string,
  systemParts: InMemoryPart[],
  micParts: InMemoryPart[],
  speakers: readonly SpeakerSpan[] = [],
  meta?: UploadMeta,
): Promise<ProcessState> {
  const parts: Part[] = [];
  // Части выгрузки с поколением лежат в своём каталоге: одноимённые части второй записи той же
  // встречи иначе перетёрли бы аудио первой (upsert), пока её воркер ещё транскрибирует.
  const dir = meta ? `${meetingId}/${meta.gen}` : meetingId;
  const upload = async (track: "sys" | "mic", list: InMemoryPart[]) => {
    for (const p of list) {
      if (p.blob.size > OPENAI_AUDIO_MAX_BYTES) throw new Error(`part "${p.name}" too large (>25MB)`);
      const path = `${dir}/${track}-${p.name}`;
      const { error } = await supabase.storage.from(AUDIO_BUCKET)
        .upload(path, p.blob, { contentType: "audio/m4a", upsert: true });
      if (error) throw new Error(`upload ${path}: ${error.message}`);
      parts.push({ track, name: p.name, offset: p.offset, path, done: false, attempts: 0 });
    }
  };
  await upload("sys", systemParts);
  await upload("mic", micParts);
  // Пустой таймлайн в состояние не пишем: старая форма process_state остаётся байт-в-байт прежней.
  const base: ProcessState = speakers.length > 0
    ? { parts, stage: "transcribe", speakers: [...speakers] }
    : { parts, stage: "transcribe" };
  return meta ? { ...base, ...meta } : base;
}

// ── Лиз и состояние ───────────────────────────────────────────────────────────
// Взятие, продление и снятие лиза — `meeting-processing-lease.ts` (условная UPDATE по токену).

// Запись в строку встречи от имени воркера — только пока лиз его (иначе LeaseLostError) и пока
// состояние в строке его поколения. Состояние старой формы (без gen) — без условия на поколение.
// Запись без снятия лиза его же и продлевает. true — строка обновлена.
// `content` — пишется содержимое встречи (стенограмма, тезисы, название): тогда ещё и только в
// незамороженную встречу (meeting-frozen.ts) — её могли опубликовать или править, пока шла обработка.
async function writeOwn(
  lease: ProcessingLease,
  gen: string | undefined,
  patch: Record<string, unknown>,
  content = false,
): Promise<boolean> {
  return await lease.write(patch, (q) => {
    let r = gen ? q.eq("process_state->>gen", gen) : q;
    if (content) r = unfrozen(r);
    return r;
  }, gen);
}

// Персист прогресса: process_state + heartbeat. summary_status НЕ трогаем (остаётся processing).
// Вместе с прогрессом продлеваем оба лиза: обработки (processing_lease, issue #578 — иначе через
// LEASE_STALE_MS встречу брал второй воркер) и права транскрибации (issue #285): обработка длинной
// записи идёт дольше 30 минут, а истёкший лиз права означает «встреча свободна» — и её подхватывал
// любой следующий claim, теряя уже принятое аудио держателя.
// false — состояние в строке уже не наше (см. writeOwn).
async function saveState(lease: ProcessingLease, state: ProcessState): Promise<boolean> {
  const nowIso = new Date().toISOString();
  return await writeOwn(lease, state.gen, {
    process_state: state,
    last_progress_at: nowIso,
    lease_expires_at: claimLeaseUntil(),
    updated_at: nowIso,
  });
}

async function markFailed(lease: ProcessingLease, m: MeetingRow, state: ProcessState): Promise<void> {
  const applied = await writeOwn(lease, state.gen, {
    summary_status: "failed",
    processing_lease: null,
    updated_at: new Date().toISOString(),
  });
  if (!applied) return; // запись вытеснена — о чужой встрече её владельцу не пишем
  const note =
    "⚠️ Не удалось обработать запись встречи — не получилось транскрибировать аудио. Попробуй записать заново.";
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

// Легенда спикеров для промпта тезисов живёт в _shared/speakers.ts: она обязана описывать ровно те
// метки, которые в стенограмме есть (запись бота — только имена, реплик «я» там нет вовсе).
// Метки берём из самих сегментов.
function labelsOf(segments: readonly Segment[]): string[] {
  return segments.map((s) => s.speaker ?? "");
}

// ── Вторая запись: оставить текущую стенограмму, если она не беднее ──────────────
// Канон сравнения — объём распознанного (`_shared/meeting-fullness.ts`, тот же порог, что на
// публикации): длительность слепа к потерянному звуку (#10), а длительность бота серверу не
// известна вовсе. true — текущая остаётся, встреча вернулась в прежний статус, уведомлений нет.
async function keepCurrentTranscript(
  lease: ProcessingLease,
  state: ProcessState,
  segments: Segment[],
): Promise<boolean> {
  const { supabase, meetingId: id } = lease;
  const { data } = await supabase.from("meetings").select("transcript, notes_edited_at, status").eq("id", id)
    .maybeSingle();
  const current = data as
    | { transcript: { segments?: Segment[] } | null; notes_edited_at: string | null; status?: string | null }
    | null;
  const incoming = { segments };
  const frozen = current !== null && isFrozen(current);
  const verdict = frozen ? { replace: false, reason: "frozen" } : arbitrateFullness(
    { transcript: incoming },
    { transcript: current?.transcript ?? null, notesEditedAt: current?.notes_edited_at ?? null },
  );
  console.log(
    `meeting-processor: вторая запись ${id} (${state.source ?? "?"}) — распознано ${
      transcriptVolume(incoming)
    } против ${transcriptVolume(current?.transcript ?? null)} у текущей → ${
      verdict.replace ? "заменяем" : "оставляем текущую"
    } (${verdict.reason})`,
  );
  if (verdict.replace) return false;
  const nowIso = new Date().toISOString();
  await writeOwn(lease, state.gen, {
    summary_status: state.challenge?.priorStatus ?? "done",
    processing_lease: null,
    last_progress_at: nowIso,
    updated_at: nowIso,
  });
  await discardState(supabase, id, state, false);
  if (state.rival && state.owner !== undefined) await settleRival(supabase, id, state.owner, state.rival, false, null);
  return true;
}

// ── Финал: сводим транскрипт → тезисы → done → уведомляем → чистим Storage ──────
async function summarizeAndFinish(lease: ProcessingLease, m: MeetingRow, state: ProcessState): Promise<void> {
  const { supabase, signal } = lease;
  // Запись претендента сдвигается своим mic и говорит от своего имени: в строке встречи пока
  // держатель (meeting-rival.ts).
  const rival = state.rival && state.owner !== undefined ? { ...state.rival, owner: state.owner } : null;
  const rawOffset = rival ? rival.micStartOffset : m.mic_start_offset;
  const micOffset = typeof rawOffset === "number" && Number.isFinite(rawOffset) ? rawOffset : 0;
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
        await transcribePartInto(supabase, state.parts[i], pin, state.source, signal);
      } catch (e) {
        rethrowIfLeaseLost(signal.reason ?? e);
        console.error(`meeting-processor: ре-транскрибация части ${state.parts[i].path} упала:`, e);
      }
    }
    if (idxs.length > 0) await saveState(lease, state);
  }

  // Сборка стенограммы (сдвиг mic↔system, метки говорящих, сортировка) — в _shared/speakers.ts.
  // Таймлайна нет → метки ровно прежние: sys → «собеседник», mic → «я».
  const segments = buildSegments(state.parts, micOffset, state.speakers ?? []);

  // Вторая запись встречи (T156): стенограмма заменяется ЦЕЛИКОМ, только если эта полнее.
  if (state.challenge && await keepCurrentTranscript(lease, state, segments)) return;

  const hasMic = state.parts.some((p) => p.track === "mic" && p.done);
  const transcript = { language: resolved, model: hasMic ? "whisper-1+mic" : "whisper-1", segments };
  const writtenAt = new Date().toISOString();
  const ownership = rival ? rivalOwnershipPatch(rival.owner, rival, writtenAt) : {};
  if (!(await writeOwn(lease, state.gen, { transcript, ...ownership, updated_at: writtenAt }, true))) {
    await requeueLost(supabase, m.id, state);
    return;
  }
  if (rival) await settleRival(supabase, m.id, rival.owner, rival, true, m.claim_owner);

  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  // Пустая стенограмма (всё вычищено фильтром) → не зовём GPT за «отпиской». Иначе GPT сам решает:
  // нет содержания → НЕТ_ТЕЗИСОВ (см. TEZIS_SYSTEM) → подменяем на короткую плашку.
  let tezisi: string;
  if (!transcriptText.trim()) {
    tezisi = NO_TEZISY_NOTE;
  } else {
    const ownerName = await resolveOwnerName(supabase, rival ? rival.owner : micOwnerId(m.claim_owner, m.recorders));
    const raw = (await chatComplete(
      TEZIS_SYSTEM,
      // Текст встречи — недоверенные данные (issue #458): в маркерах, см. _shared/tezisy-prompt.ts.
      buildTezisyUserMessage(
        `Встреча: ${m.title ?? "без названия"}\n\n${speakerLegend(ownerName, labelsOf(segments))}\n${transcriptText}`,
      ),
      { temperature: 0.3, signal }, // температура — для фолбэк-gpt-4o; terra (GPT-5) её игнорирует
    )).trim();
    // Пустой ответ модели при СОДЕРЖАТЕЛЬНОМ транскрипте — это сбой сводки, а НЕ пустая встреча.
    // Раньше "" сохранялось с summary_status="done" → ревью вечно «Тезисы готовятся…» без кнопки.
    // Транскрипт уже сохранён выше; метим failed → на ревью доступно «Переобработать».
    if (!raw) {
      console.error(
        `meeting-processor: пустая сводка от модели для ${m.id} при непустом транскрипте (${transcriptText.length} симв) — mark failed`,
      );
      await writeOwn(lease, state.gen, {
        summary_status: "failed",
        last_progress_at: new Date().toISOString(),
        processing_lease: null,
        updated_at: new Date().toISOString(),
      });
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
          { model: "gpt-4o-mini", maxTokens: 60, signal }, // заголовок — дешёвая быстрая модель, не terra
        )).trim().replace(/^["«»\s]+|["«»\s]+$/g, "").slice(0, 120);
        if (t) finalTitle = t;
      } catch (e) {
        rethrowIfLeaseLost(signal.reason ?? e); // иначе оставляем исходный заголовок
      }
    }
  }

  const nowIso = new Date().toISOString();
  const finished = await writeOwn(lease, state.gen, {
    draft_notes_md: tezisi,
    title: finalTitle,
    summary_status: "done",
    last_progress_at: nowIso,
    processing_lease: null,
    updated_at: nowIso,
  }, true);
  if (!finished) {
    // Вытеснены между стенограммой и тезисами: уведомлять не о чем, запись — в очередь.
    await requeueLost(supabase, m.id, state);
    return;
  }

  const webUrl = WEB_BASE_URL ? `${WEB_BASE_URL}/?meeting=${m.id}` : "";
  const titleStr = finalTitle ? `: <b>${finalTitle}</b>` : "";
  // Только факт «обработана и готова» (владелец 30.09.2026): приписка «Возьмёт любой из участников»
  // смысла для получателя не несла.
  const text = `📝 Встреча обработана и готова${titleStr}`;
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
export async function resummarizeFromTranscript(
  supabase: SupabaseClient,
  meetingId: string,
  note = "",
): Promise<string> {
  const tezisi = await buildTezisyFromTranscript(supabase, meetingId, note);
  // Успешно записали тезисы → приводим summary_status в согласованность: встреча, ранее упавшая в
  // "failed", после успешной переобработки не должна оставаться "failed" (иначе UI врёт про статус).
  await supabase.from("meetings")
    .update({ draft_notes_md: tezisi, summary_status: "done", updated_at: new Date().toISOString() })
    .eq("id", meetingId);
  return tezisi;
}

// Текст встречи для модели из сохранённого транскрипта: название, легенда говорящих и реплики.
// Общий для тезисов и точечного вопроса по встрече (`meeting-ask.ts`) — модель видит одно и то же.
// null — транскрипта нет или он пуст.
export async function loadMeetingTextForModel(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<string | null> {
  const { data } = await supabase.from("meetings").select("id, title, transcript, recorders, claim_owner").eq(
    "id",
    meetingId,
  ).single();
  const row = data as {
    title: string | null;
    transcript: { segments?: Segment[] } | null;
    recorders: RecorderEntry[] | null;
    claim_owner: number | null;
  } | null;
  const segments = row?.transcript?.segments ?? [];
  const transcriptText = segments.map((s) => `${s.speaker ?? ""}: ${s.text}`).join("\n").slice(0, 100000);
  if (!transcriptText.trim()) return null;
  const ownerName = await resolveOwnerName(supabase, micOwnerId(row?.claim_owner ?? null, row?.recorders ?? null));
  return `Встреча: ${row?.title ?? "без названия"}\n\n${
    speakerLegend(ownerName, labelsOf(segments))
  }\n${transcriptText}`;
}

// Та же сводка, но БЕЗ записи в базу — «сухой прогон». Отделено от resummarizeFromTranscript,
// чтобы промпт можно было проверить на реальной встрече, не затирая ни авто-тезисы, ни правки
// человека (у половины встреч стоит notes_edited_at — там перезапись уничтожила бы его работу).
export async function buildTezisyFromTranscript(
  supabase: SupabaseClient,
  meetingId: string,
  note = "",
): Promise<string> {
  const meetingText = await loadMeetingTextForModel(supabase, meetingId);
  if (meetingText === null) return NO_TEZISY_NOTE;
  // Пожелание пользователя к этой переработке (из кнопки «Переработать»: короче/подробнее/акцент/…) —
  // добавляем в конец user-сообщения как приоритетную инструкцию поверх общего промпта.
  // Текст встречи — в маркерах как недоверенные данные, пожелание — после них (issue #458).
  const raw = (await chatComplete(
    TEZIS_SYSTEM,
    buildTezisyUserMessage(meetingText, note),
    { temperature: 0.3 },
  )).trim();
  // Пустой ответ модели — не затираем существующие тезисы пустой строкой и не метим done;
  // бросаем, чтобы swarm-api вернул ошибку, а кнопка «Переобработать» осталась для повторной попытки.
  if (!raw) throw new Error("Модель вернула пустые тезисы — попробуй ещё раз");
  return /^НЕТ[_\s]?ТЕЗИСОВ/i.test(raw) ? NO_TEZISY_NOTE : raw;
}

// Встреча закончена (done/failed). Если ждёт вторая запись той же встречи (T156) — она идёт в
// обработку сейчас; тогда done=false: встречу продолжит следующий проход (cron или inline).
async function finishAndPromote(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<{ claimed: boolean; done: boolean }> {
  const promoted = await promoteQueued(supabase, meetingId).catch((e) => {
    console.error(`meeting-processor: очередь ${meetingId} не продвинута (cron/ingest повторят):`, e);
    return false;
  });
  return { claimed: true, done: !promoted };
}

// ── Главный шаг ─────────────────────────────────────────────────────────────
// Делает ОГРАНИЧЕННУЮ бюджетом работу по одной встрече: берёт лиз, транскрибирует следующие
// части, и если все готовы — сводит тезисы. Безопасно прерывается по бюджету (cron продолжит).
// Возвращает {claimed, done}: claimed=false → встречу обрабатывает кто-то другой (лиз занят).
// deferred=true → действует заморозка: встречу не трогаем вовсе, её подхватит первый тик cron после
// разморозки (решение владельца 01.10.2026, _shared/processing-freeze.ts).
export async function runMeetingStep(
  supabase: SupabaseClient,
  meetingId: string,
  budgetMs: number,
  now: Date = new Date(),
): Promise<{ claimed: boolean; done: boolean; deferred?: boolean }> {
  const startedAt = Date.now();
  if (await processingFrozen(supabase, now)) {
    console.log(`meeting-processor: ${meetingId} — заморозка, обработка отложена`);
    return { claimed: false, done: false, deferred: true };
  }
  const lease = await ProcessingLease.claim(supabase, meetingId);
  if (!lease) return { claimed: false, done: false };

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
    // Пульс продлевает лиз, пока идут долгие вызовы модели (запись прогресса продлевает его и сама).
    lease.startHeartbeat(state.gen);

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
        const micHint = pendingSys.length > 0 ? undefined : langCode(resolveMeetingLang(toVoteParts(state.parts)));
        const batch = pending.slice(0, TRANSCRIBE_CONCURRENCY);
        await mapLimit(batch, TRANSCRIBE_CONCURRENCY, async (p) => {
          try {
            // Микрофон пинуем на язык встречи; систему — как есть (автодетект).
            const hint = p.track === "mic" ? micHint : undefined;
            await transcribePartInto(supabase, p, hint, state.source, lease.signal);
          } catch (e) {
            // Потерянный лиз — не сбой части: попытку не списываем, шаг прекращается.
            rethrowIfLeaseLost(lease.signal.reason ?? e);
            p.attempts = (p.attempts ?? 0) + 1;
            console.error(`meeting-processor: part ${p.path} attempt ${p.attempts} failed:`, e);
          }
        });
        if (!(await saveState(lease, state))) {
          await requeueLost(supabase, meetingId, state);
          return { claimed: true, done: true };
        }
      }
      const recoverable = state.parts.filter((p) => !p.done && p.attempts < MAX_PART_ATTEMPTS);
      if (recoverable.length > 0) return { claimed: true, done: false }; // ещё есть части — продолжит следующий тик
      // Все оставшиеся части либо готовы, либо отравлены. Если не вышло НИ ОДНОЙ — это провал.
      if (!state.parts.some((p) => p.done)) {
        await markFailed(lease, m, state);
        return await finishAndPromote(supabase, meetingId);
      }
      state.stage = "summarize";
      if (!(await saveState(lease, state))) {
        await requeueLost(supabase, meetingId, state);
        return { claimed: true, done: true };
      }
    }

    if (state.stage === "summarize") {
      await summarizeAndFinish(lease, m, state);
      return await finishAndPromote(supabase, meetingId);
    }
    return { claimed: true, done: false };
  } catch (e) {
    // Лиз перехватил другой воркер: встречу ведёт он, этот молча выходит, ничего не записав.
    if (isLeaseLost(lease.signal.reason ?? e)) {
      console.warn(`meeting-processor: ${meetingId} — лиз обработки перехвачен, шаг прекращён без записи`);
      return { claimed: true, done: false };
    }
    throw e;
  } finally {
    lease.stopHeartbeat();
    // Снимаем лиз, ЕСЛИ он ещё наш (done/failed обнулили его сами той же записью). Чужой не трогаем.
    await lease.release().catch(() => {});
  }
}
