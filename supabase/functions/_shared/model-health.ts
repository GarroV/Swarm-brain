// Сигнал админу об отказе модели OpenAI (issue #372).
//
// 18.09.2026 прод около часа не получал ответов от OpenAI (кончилась квота): упала встреча,
// записи легли без эмбеддинга, разбор задач отдавал пустоту — а узнали об этом от владельца.
// Статус ответа модели не попадал никуда, кроме console.error в логах функции.
//
// Теперь каждый ИТОГОВЫЙ отказ (после всех повторов externalFetch) отмечается в
// app_settings['model_health']: окно в WINDOW_MIN минут и счётчик отказов в нём. На THRESHOLD-м
// отказе в окне админ получает сообщение в Telegram с причиной — квота, ключ и 5xx различаются по
// действию. Повтор не чаще ALERT_COOLDOWN_H часов, чтобы долгий отказ не засыпал чат.
//
// Успехи не пишутся — это запись в базу на каждый вызов модели. Поэтому «N подряд» здесь —
// «N за окно»: одиночный сбой не тревожит, серия — тревожит.
//
// Отметка не должна ломать вызывающего: всё здесь глотает свои ошибки в console.error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERADMIN_TELEGRAM_ID } from "./users/admin-scope.ts";

export const MODEL_HEALTH_KEY = "model_health";
export const WINDOW_MIN = 30;
export const THRESHOLD = 5;
export const ALERT_COOLDOWN_H = 6;

export interface ModelFailure {
  /** HTTP-статус; null — ответа не было (сеть, срок). */
  status: number | null;
  /** `error.code` / `error.type` из тела OpenAI или причина без ответа (timeout, network). */
  code: string | null;
  message: string | null;
}

export interface ModelHealth {
  window_start: string;
  count: number;
  last_at: string;
  last_status: number | null;
  last_code: string | null;
  last_message: string | null;
  last_alert_at: string | null;
}

const MIN = 60_000;

/** Следующее состояние и нужно ли тревожить. Чистая функция — весь смысл правила здесь. */
export function stepHealth(
  prev: ModelHealth | null,
  failure: ModelFailure,
  now: Date,
): { next: ModelHealth; alert: boolean } {
  const fresh = prev && now.getTime() - Date.parse(prev.window_start) < WINDOW_MIN * MIN;
  const count = fresh ? prev.count + 1 : 1;
  const lastAlert = prev?.last_alert_at ? Date.parse(prev.last_alert_at) : null;
  const cooled = lastAlert === null || now.getTime() - lastAlert >= ALERT_COOLDOWN_H * 60 * MIN;
  const alert = count >= THRESHOLD && cooled;
  return {
    alert,
    next: {
      window_start: fresh ? prev.window_start : now.toISOString(),
      count,
      last_at: now.toISOString(),
      last_status: failure.status,
      last_code: failure.code,
      last_message: failure.message?.slice(0, 300) ?? null,
      last_alert_at: alert ? now.toISOString() : prev?.last_alert_at ?? null,
    },
  };
}

/** Что делать — по причине. Квота и ключ чинятся человеком, 5xx обычно проходят сами. */
export function failureAdvice(f: ModelFailure): string {
  if (f.code === "insufficient_quota") return "Кончилась квота/баланс OpenAI — пополнить счёт.";
  if (f.status === 401 || f.code === "invalid_api_key") return "Ключ OpenAI не принят — проверить секрет OPENAI_API_KEY.";
  if (f.status === 429) return "OpenAI ограничивает частоту — если не проходит за час, смотреть лимиты.";
  if (f.status !== null && f.status >= 500) return "Сбой на стороне OpenAI — обычно проходит сам, следить.";
  return "Ответа нет (сеть или срок) — проверить доступность api.openai.com.";
}

export function alertText(h: ModelHealth): string {
  const what = [h.last_status !== null ? `HTTP ${h.last_status}` : null, h.last_code].filter(Boolean).join(", ");
  return [
    `⚠️ OpenAI отказывает: ${h.count} отказов за ${WINDOW_MIN} мин.`,
    `Последний: ${what || "без ответа"}${h.last_message ? ` — ${h.last_message}` : ""}`,
    failureAdvice({ status: h.last_status, code: h.last_code, message: h.last_message }),
    "Пока отказ не снят, встречи не обрабатываются, записи ложатся без поиска (дозаполнятся сами).",
  ].join("\n");
}

/** Разбор тела ошибки OpenAI: `{ error: { code, type, message } }`. Не JSON — текст как есть. */
export function parseOpenAiError(status: number, body: string): ModelFailure {
  try {
    const e = JSON.parse(body)?.error;
    return { status, code: e?.code ?? e?.type ?? null, message: typeof e?.message === "string" ? e.message : null };
  } catch {
    return { status, code: null, message: body.slice(0, 300) || null };
  }
}

export interface HealthDeps {
  load: () => Promise<ModelHealth | null>;
  save: (h: ModelHealth) => Promise<void>;
  alert: (text: string) => Promise<void>;
  now?: () => Date;
}

export async function recordModelFailure(failure: ModelFailure, deps: HealthDeps): Promise<boolean> {
  const { next, alert } = stepHealth(await deps.load(), failure, (deps.now ?? (() => new Date()))());
  await deps.save(next);
  if (alert) await deps.alert(alertText(next));
  return alert;
}

function envDeps(): HealthDeps | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!url || !key) return null; // тесты и локальные прогоны без базы — отмечать некуда
  const db = createClient(url, key);
  return {
    async load() {
      const { data, error } = await db.from("app_settings").select("value").eq("key", MODEL_HEALTH_KEY).maybeSingle();
      if (error) throw new Error(`model_health: чтение: ${error.message}`);
      return (data?.value as ModelHealth | undefined) ?? null;
    },
    async save(h) {
      const { error } = await db.from("app_settings").upsert({
        key: MODEL_HEALTH_KEY,
        value: h,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`model_health: запись: ${error.message}`);
    },
    async alert(text) {
      if (!bot) throw new Error("model_health: нет TELEGRAM_BOT_TOKEN — сигнал не отправить");
      // Голый fetch со сроком, а не externalFetch: тот зовёт этот модуль, цикл не нужен.
      const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: SUPERADMIN_TELEGRAM_ID, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`model_health: Telegram HTTP ${res.status}`);
      await res.body?.cancel();
    },
  };
}

/** Точка входа из externalFetch. Ничего не бросает и не задерживает вызывающего надолго. */
export async function reportModelFailure(failure: ModelFailure): Promise<void> {
  try {
    const deps = envDeps();
    if (deps) await recordModelFailure(failure, deps);
  } catch (e) {
    console.error("[model-health] отказ модели не отмечен:", e);
  }
}
