// Отправка уведомления в Telegram — с ПРОВЕРКОЙ результата.
//
// Вынесено из index.ts отдельным модулем ровно затем, чтобы это можно было проверить тестом:
// в index.ts живёт Deno.serve, и импортировать его из теста нельзя.
//
// Остальной код продукта шлёт в Telegram и на ответ не смотрит. Для уведомления о сбое так
// нельзя: недоставленное сообщение о том, что запись не идёт, и есть молчаливый отказ — причём
// вдвойне, потому что оно молчит о молчании.
//
// Успехом считается ТОЛЬКО `{"ok": true}` в теле. Не «не пришёл ok: false», а именно ok: true:
// Telegram умеет ответить 200 с телом, которое не разбирается (прокси, обрезанный ответ,
// HTML-заглушка шлюза), и тогда проверка «ok !== false» пропускала недоставленное сообщение
// как доставленное.
import type { TelegramCall } from "../_shared/telegram-outbox.ts";

export interface TelegramSenderConfig {
  botToken: string;
  /** База API. Подменяется смоуком блока, чтобы прогон отказов не стучался в живой Telegram. */
  apiBase: string;
  /** Точка подмены для теста; в проде — глобальный fetch. */
  fetchImpl?: typeof fetch;
}

export type TelegramSender = (chatId: number, text: string) => Promise<void>;

/** Тело сообщения-уведомления без chat_id (его подставляет получатель). Одно место и для отправки, и для очереди. */
export function noticeBody(text: string): Record<string, unknown> {
  return { text, parse_mode: "HTML", disable_web_page_preview: true };
}

/** Вызов Bot API с той же строгой проверкой (`ok: true`); общий для прямой отправки и разбора очереди. */
export function makeTelegramCaller(config: TelegramSenderConfig): TelegramCall {
  const doFetch = config.fetchImpl ?? fetch;
  return async (method: string, payload: Record<string, unknown>): Promise<void> => {
    if (config.botToken === "") throw new Error("TELEGRAM_BOT_TOKEN is not set on the server");
    const res = await doFetch(`${config.apiBase}/bot${config.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let body: { ok?: unknown; description?: unknown } | null = null;
    try {
      body = (await res.json()) as { ok?: unknown; description?: unknown };
    } catch {
      body = null;
    }

    if (body === null) {
      throw new Error(`telegram ${res.status}: ответ не разобран — считать сообщение доставленным нельзя`);
    }
    if (body.ok !== true) {
      const description = typeof body.description === "string" ? body.description : "no description in response";
      throw new Error(`telegram ${res.status}: ${description}`);
    }
  };
}

export function makeTelegramSender(config: TelegramSenderConfig): TelegramSender {
  const call = makeTelegramCaller(config);
  return (chatId: number, text: string): Promise<void> => call("sendMessage", { chat_id: chatId, ...noticeBody(text) });
}

/**
 * Часы для комендантского часа уведомлений. На проде — настоящее время. Подменить его можно ТОЛЬКО
 * вместе с подменой базы Bot API (`TELEGRAM_API_BASE` — её задаёт один смоук блока): иначе забытая
 * на проде переменная `SMOKE_NOW` сдвинула бы тишину 23:00–9:00 МСК. Смоук фиксирует «день»,
 * чтобы не краснеть ночью, и отдельным экземпляром — «ночь», чтобы проверить очередь.
 */
export function noticeClock(env: { smokeNow?: string; apiBase?: string }): () => Date {
  const fixed = env.apiBase && env.smokeNow ? new Date(env.smokeNow) : null;
  if (fixed && Number.isNaN(fixed.getTime())) throw new Error(`SMOKE_NOW не дата: ${env.smokeNow}`);
  return () => fixed ?? new Date();
}
