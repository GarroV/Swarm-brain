// Единственный путь сообщения человеку «по инициативе бота» (напоминание, дайджест, уведомление о
// задаче, комментарии, встрече): вне комендантского часа (23:00–9:00 по Москве, _shared/curfew.ts)
// уходит сразу, внутри — ложится в `telegram_outbox` и уходит первым тиком после 9:00
// (drainTelegramOutbox, _shared/telegram-outbox.ts). Решение владельца 13.10.2026,
// docs/decisions/2026-10-13-notification-curfew.md.
//
// Сюда НЕ ходят: технические тревоги админу/владельцу (сломалось — шлём всегда) и ответы на
// собственное сообщение или нажатие кнопки человеком (это не уведомление — бот отвечает сразу).
//
// Результат: "sent" — Telegram принял; "queued" — отложено до утра. Недоставка — исключение (как у
// прежних отправителей): вызывающий, у которого «доставлено» — условие чего-то (пинг гасится только
// по факту), ловит его сам; «queued» для него — принято, но не недоставлено.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inCurfew } from "./curfew.ts";
import { externalFetch, VIA_TELEGRAM } from "./external-fetch.ts";
import { makeOutboxStore, type OutboxStore, type TelegramCall } from "./telegram-outbox.ts";

export interface NotifyRequest {
  recipientId: number;
  /** Метод Bot API; по умолчанию sendMessage. */
  method?: string;
  /** Тело запроса БЕЗ chat_id — его подставит получатель. Хранится в очереди как есть. */
  payload: Record<string, unknown>;
  /** Короткая метка отправителя (digest, task_comment…) — для разбора очереди. */
  kind: string;
}

export type NotifyResult = "sent" | "queued";

/**
 * Низкоуровневая отправка в Bot API: токен читается в момент вызова (модуль общий для всех
 * функций), успех — HTTP 2xx, иначе исключение с описанием от Telegram.
 */
export const sendTelegramCall: TelegramCall = async (method, payload) => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set on the server");
  const res = await externalFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, VIA_TELEGRAM);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { description?: string };
    throw new Error(`Telegram API: ${err.description ?? res.status}`);
  }
};

export interface NotifyDeps {
  store: OutboxStore;
  send: TelegramCall;
}

/** Решение «слать сейчас или отложить» — без привязки к supabase (тест подставляет хранилище). */
export async function deliverOrQueue(
  deps: NotifyDeps,
  request: NotifyRequest,
  now: Date = new Date(),
): Promise<NotifyResult> {
  const method = request.method ?? "sendMessage";
  const payload = { chat_id: request.recipientId, ...request.payload };
  if (inCurfew(now)) {
    await deps.store.enqueue({ recipient_id: request.recipientId, method, payload, kind: request.kind });
    return "queued";
  }
  await deps.send(method, payload);
  return "sent";
}

/**
 * Сообщение человеку по инициативе бота. `send` подменяется там, где отправка устроена иначе
 * (meeting-notice с проверкой `ok: true` в теле и подменой базы API для смоука).
 */
export function notifyPerson(
  supabase: SupabaseClient,
  request: NotifyRequest,
  now: Date = new Date(),
  send: TelegramCall = sendTelegramCall,
): Promise<NotifyResult> {
  return deliverOrQueue({ store: makeOutboxStore(supabase), send }, request, now);
}
