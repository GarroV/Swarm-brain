// Короткая расшифровка клипа (диктовка задачи из рекордера, до пары МБ): отдельно от
// transcribeAudio встреч, у которой свои сегменты, фильтры и лиз. Основная модель — gpt-transcribe
// (whisper-1 OpenAI отключает 26.02.2027, issue #1046); на отказ API про модель или параметры —
// один фолбэк на whisper-1 с пометкой в логе. Ключ — пространства человека (ModelAuth),
// расход пишется в model_usage с подписью purpose.
import { type ModelAuth, openaiFetch } from "./meeting-processor.ts";
import { COUNTRY_NAMES } from "./countries.ts";
import { glossaryWhisperHint, MEETING_GLOSSARY } from "./glossary.ts";
import { isRepeatedFiller, isWhisperHallucination } from "./whisper-hallucinations.ts";

export const SHORT_TRANSCRIBE_MODEL = "gpt-transcribe";
export const SHORT_TRANSCRIBE_FALLBACK_MODEL = "whisper-1";
/** Потолок на один вызов: клип короткий, долгая тишина в ответе значит сбой, а не работу. */
export const SHORT_TRANSCRIBE_TIMEOUT_MS = 40_000;
const URL = "https://api.openai.com/v1/audio/transcriptions";
/** Статусы «модель или параметры не подошли» — только на них идём на запасную модель. */
const MODEL_REJECTED = new Set([400, 404, 422]);
const MAX_KEYWORDS = 50;

export type ShortTranscript = { text: string; model: string; fallback: boolean };

/** Имена, которые модели полезно знать заранее: словарь встреч + названия рынков. */
export function transcribeKeywords(): string[] {
  const names = [...MEETING_GLOSSARY.map((g) => g.canonical), ...Object.values(COUNTRY_NAMES)];
  return [...new Set(names)].slice(0, MAX_KEYWORDS);
}

/** Тишина и «титры» из ютуб-обучения — не речь: пусто, а не задача «Спасибо за просмотр». */
export function cleanShortText(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || isWhisperHallucination(text)) return "";
  return isRepeatedFiller([text]) ? "" : text;
}

type Fetcher = typeof openaiFetch;

function formFor(model: string, audio: Blob, filename: string, lang?: string): FormData {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("prompt", glossaryWhisperHint());
  if (model === SHORT_TRANSCRIBE_MODEL) {
    for (const k of transcribeKeywords()) form.append("keywords[]", k);
    if (lang) form.append("languages[]", lang);
  } else if (lang) {
    form.append("language", lang);
  }
  return form;
}

async function once(
  fetcher: Fetcher,
  auth: ModelAuth,
  model: string,
  audio: Blob,
  filename: string,
  lang: string | undefined,
  purpose: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const res = await fetcher(
    auth,
    URL,
    { method: "POST", body: formFor(model, audio, filename, lang) },
    AbortSignal.timeout(SHORT_TRANSCRIBE_TIMEOUT_MS),
    2,
    purpose,
  );
  const data = await res.json().catch(() => null) as { text?: unknown; error?: { message?: string } } | null;
  if (!res.ok) return { ok: false, status: res.status, message: data?.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, text: cleanShortText(data?.text) };
}

/**
 * Расшифровывает короткий клип. Бросает Error при отказе API (после фолбэка) — вызывающий
 * отвечает 502; пустой `text` — «ничего не услышал» (тишина, шум, галлюцинация).
 * `lang` — ISO-639-1 подсказка языка (ru/en/sr), необязательная.
 */
export async function transcribeShortClip(
  auth: ModelAuth,
  audio: Blob,
  filename: string,
  opts: { lang?: string; purpose?: string; fetcher?: Fetcher } = {},
): Promise<ShortTranscript> {
  const fetcher = opts.fetcher ?? openaiFetch;
  const purpose = opts.purpose ?? "task:voice-transcription";
  const first = await once(fetcher, auth, SHORT_TRANSCRIBE_MODEL, audio, filename, opts.lang, purpose);
  if (first.ok) return { text: first.text, model: SHORT_TRANSCRIBE_MODEL, fallback: false };
  if (!MODEL_REJECTED.has(first.status)) {
    throw new Error(`${SHORT_TRANSCRIBE_MODEL}: ${first.message}`);
  }
  console.warn(
    `[short-transcribe] ${SHORT_TRANSCRIBE_MODEL} отказал (${first.status}: ${first.message}) — фолбэк на ${SHORT_TRANSCRIBE_FALLBACK_MODEL}`,
  );
  const second = await once(fetcher, auth, SHORT_TRANSCRIBE_FALLBACK_MODEL, audio, filename, opts.lang, purpose);
  if (!second.ok) throw new Error(`${SHORT_TRANSCRIBE_FALLBACK_MODEL}: ${second.message}`);
  return { text: second.text, model: SHORT_TRANSCRIBE_FALLBACK_MODEL, fallback: true };
}
