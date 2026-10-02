// Учёт расхода OpenAI на нашей стороне (issue #311, владелец 02.10.2026: «очень надо. заведи это
// все в админскую панель»). Каждый ответ OpenAI несёт `usage` (токены) или длительность аудио —
// раньше это выбрасывалось, и «куда ушли деньги» отвечалось только в кабинете OpenAI, одной
// кучей со всеми системами под тем же ключом (#312). Теперь каждый удачный вызов — строка в
// `model_usage`: что, какой моделью, сколько токенов/секунд и во что обошлось.
//
// Запись идёт из `externalFetch` — через него ходят ВСЕ вызовы OpenAI, поэтому учёт полный без
// правки каждого места. Подпись `purpose` (зачем звали) и связь со встречей — по желанию вызывающего.
// Учёт никогда не роняет вызов: сбой записи — строка в лог.
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type UsageKind = "chat" | "embedding" | "transcription" | "other";

/** Что вызывающий может сообщить о вызове сверх того, что видно из запроса и ответа. */
export interface UsageLabel {
  /** Зачем звали: «tezisy», «search», «embedding:entry»… Без подписи — «unlabeled». */
  purpose?: string;
  meetingId?: string;
  entryId?: string;
  groupId?: string;
}

// Подпись на всю цепочку вызовов: обработчик встречи задаёт её один раз (`withUsageLabel`), и
// каждый вызов модели внутри — транскрибация, тезисы, задачи — записывается на эту встречу,
// без протаскивания id через каждую функцию. Подпись вызова (`opts.usage`) уточняет её поверх.
const usageScope = new AsyncLocalStorage<UsageLabel>();

export function withUsageLabel<T>(label: UsageLabel, fn: () => Promise<T>): Promise<T> {
  return usageScope.run({ ...usageScope.getStore(), ...label }, fn);
}

// Цены, USD. Источник — прайс OpenAI на 02.10.2026; модель без цены честно даёт cost = null,
// а не ноль: админка показывает её токены и пометку «цена не задана».
// Токены — за 1M; транскрибация — за минуту аудио.
const PRICES: Record<string, { input?: number; output?: number; perMinute?: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "text-embedding-3-small": { input: 0.02 },
  "whisper-1": { perMinute: 0.006 },
};

/** Цена модели; датированная версия («gpt-4o-mini-2024-07-18») — по базовой. */
function priceOf(model: string) {
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES).sort((a, b) => b.length - a.length)
    .find((m) => new RegExp(`^${m.replace(/[.]/g, "\\.")}-\\d{4}-\\d{2}-\\d{2}$`).test(model));
  return base ? PRICES[base] : null;
}

export interface UsageNumbers {
  model: string | null;
  kind: UsageKind;
  promptTokens?: number | null;
  completionTokens?: number | null;
  audioSeconds?: number | null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Стоимость вызова в USD; null — цена модели не задана или не хватает чисел. */
export function costUsd(u: UsageNumbers): number | null {
  if (!u.model) return null;
  const p = priceOf(u.model);
  if (!p) return null;
  if (u.kind === "transcription") {
    if (p.perMinute === undefined || u.audioSeconds == null) return null;
    return round6((u.audioSeconds / 60) * p.perMinute);
  }
  if (p.input === undefined || u.promptTokens == null) return null;
  const out = u.completionTokens ?? 0;
  if (out > 0 && p.output === undefined) return null;
  return round6((u.promptTokens * p.input + out * (p.output ?? 0)) / 1_000_000);
}

export interface ParsedUsage {
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  audioSeconds: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Числа расхода из тела ответа OpenAI. */
export function parseUsage(kind: UsageKind, body: unknown): ParsedUsage {
  const b = (body ?? {}) as Record<string, unknown>;
  const usage = (b.usage ?? {}) as Record<string, unknown>;
  const details = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
  return {
    model: typeof b.model === "string" ? b.model : null,
    promptTokens: num(usage.prompt_tokens) ?? num(usage.input_tokens),
    completionTokens: kind === "embedding" ? null : num(usage.completion_tokens) ?? num(usage.output_tokens),
    reasoningTokens: num(details.reasoning_tokens),
    audioSeconds: kind === "transcription" ? num(b.duration) : null,
  };
}

/** Модель из тела запроса: JSON-строка или форма (транскрибация). */
export function requestModel(init: { body?: unknown }): string | null {
  const body = init.body;
  if (body instanceof FormData) {
    const m = body.get("model");
    return typeof m === "string" ? m : null;
  }
  if (typeof body === "string") {
    try {
      const m = (JSON.parse(body) as { model?: unknown }).model;
      return typeof m === "string" ? m : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function usageKind(url: string): UsageKind {
  if (url.includes("/chat/completions") || url.includes("/responses")) return "chat";
  if (url.includes("/embeddings")) return "embedding";
  if (url.includes("/audio/transcriptions")) return "transcription";
  return "other";
}

type Insert = (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

// Свой fetch, снятый при загрузке модуля: запись расхода — не вызов модели, и подмена
// globalThis.fetch в тестах (они считают запросы к OpenAI) не должна её ловить.
const nativeFetch = globalThis.fetch;

let insertRow: Insert | null | undefined;
function envInsert(): Insert | null {
  if (insertRow !== undefined) return insertRow;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return (insertRow = null);
  const db = createClient(url, key, { global: { fetch: (input, init) => nativeFetch(input, init) } });
  insertRow = async (row) => await db.from("model_usage").insert(row);
  return insertRow;
}

/**
 * Записать расход удачного вызова. Ответ читается из копии — оригинал остаётся вызывающему.
 * Никогда не бросает: учёт не должен ронять работу.
 */
export async function recordModelUsage(
  url: string,
  init: RequestInit,
  res: Response,
  label: UsageLabel | undefined,
  insert: Insert | null = envInsert(),
): Promise<void> {
  if (!insert) return;
  try {
    const kind = usageKind(url);
    const body = await res.clone().json().catch(() => null);
    const parsed = parseUsage(kind, body);
    const model = parsed.model ?? requestModel(init);
    const scoped = { ...usageScope.getStore(), ...label };
    const { error } = await insert({
      kind,
      model,
      purpose: scoped.purpose ?? "unlabeled",
      meeting_id: scoped.meetingId ?? null,
      entry_id: scoped.entryId ?? null,
      group_id: scoped.groupId ?? null,
      prompt_tokens: parsed.promptTokens,
      completion_tokens: parsed.completionTokens,
      reasoning_tokens: parsed.reasoningTokens,
      audio_seconds: parsed.audioSeconds,
      cost_usd: costUsd({ ...parsed, model, kind }),
    });
    if (error) console.error("[model-usage] insert failed:", error.message);
  } catch (e) {
    console.error("[model-usage] record failed:", e instanceof Error ? e.message : String(e));
  }
}
