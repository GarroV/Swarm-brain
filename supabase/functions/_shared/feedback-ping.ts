// Пинг нового отзыва в канал команды (Telegram). Один путь для веба (swarm-api POST /feedback)
// и бота (swarm-bot, раздел «Отзыв»).
//
// Скрин лежит в ПРИВАТНОМ бакете, а в `feedback.screenshot_url` хранится путь объекта. Путь —
// не ссылка: Telegram по нему ничего не скачает, и sendPhoto с путём молча не доходил. Поэтому
// фото уходит короткоживущей подписанной ссылкой (externalFileUrl, срок EXTERNAL_TTL_SEC) —
// Telegram забирает файл сразу, а утёкшая ссылка через минуту бесполезна.
//
// Ответ Telegram проверяется: не дошло фото — отзыв всё равно уходит текстом, сбой — в лог.
// Канал переехал в супергруппу (migrate_to_chat_id) — новый id сохраняется и пинг повторяется.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { externalFileUrl } from "./storage-files.ts";
import { externalFetch, VIA_TELEGRAM, VIA_TELEGRAM_UPLOAD } from "./external-fetch.ts";

/** Предел подписи к фото в Telegram (sendPhoto caption). Длиннее — текст уходит отдельно. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

export interface TelegramResult {
  ok: boolean;
  description?: string;
  migrateToChatId?: string;
}

export interface FeedbackPingDeps {
  /** Путь в бакете → ссылка, по которой Telegram скачает файл; null — подписать не удалось. */
  fileUrl: (path: string) => Promise<string | null>;
  /** Вызов метода Bot API. Не бросает: сбой сети — `{ ok: false }`. */
  call: (method: string, payload: Record<string, unknown>) => Promise<TelegramResult>;
  /** Сохранить новый id канала после переезда группы в супергруппу. */
  saveChannelId?: (chatId: string) => Promise<void>;
}

export interface FeedbackPing {
  chatId: string;
  /** Текст в HTML-разметке Telegram. */
  text: string;
  /** Путь скрина в приватном бакете (`feedback.screenshot_url`), если есть. */
  screenshotPath?: string | null;
}

export type FeedbackPingResult = { ok: true; photo: boolean } | { ok: false; error: string };

async function deliver(deps: FeedbackPingDeps, ping: FeedbackPing): Promise<TelegramResult & { photo: boolean }> {
  const { chatId, text } = ping;
  const message = () => deps.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
  const photoUrl = ping.screenshotPath ? await deps.fileUrl(ping.screenshotPath) : null;
  if (ping.screenshotPath && !photoUrl) console.error("[feedback-ping] скрин не подписан — отзыв уйдёт без фото");
  if (!photoUrl) return { ...(await message()), photo: false };

  if (text.length <= TELEGRAM_CAPTION_LIMIT) {
    const sent = await deps.call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption: text, parse_mode: "HTML" });
    if (sent.ok || sent.migrateToChatId) return { ...sent, photo: sent.ok };
    console.error(`[feedback-ping] sendPhoto не прошёл (${sent.description ?? "нет описания"}) — шлём текстом`);
    return { ...(await message()), photo: false };
  }

  // Подпись длиннее предела — сначала текст целиком, затем фото без подписи.
  const sent = await message();
  if (!sent.ok) return { ...sent, photo: false };
  const photo = await deps.call("sendPhoto", { chat_id: chatId, photo: photoUrl });
  if (!photo.ok) console.error(`[feedback-ping] sendPhoto не прошёл (${photo.description ?? "нет описания"})`);
  return { ok: true, photo: photo.ok };
}

export async function sendFeedbackPing(deps: FeedbackPingDeps, ping: FeedbackPing): Promise<FeedbackPingResult> {
  let res = await deliver(deps, ping);
  if (!res.ok && res.migrateToChatId && deps.saveChannelId) {
    await deps.saveChannelId(res.migrateToChatId);
    res = await deliver(deps, { ...ping, chatId: res.migrateToChatId });
  }
  if (res.ok) return { ok: true, photo: res.photo };
  const error = res.description ?? "Telegram не принял сообщение";
  console.error(`[feedback-ping] отзыв в канал не доставлен: ${error}`);
  return { ok: false, error };
}

/** Вызов Bot API с разбором ответа: `ok`, описание ошибки, переезд группы. */
export async function callTelegram(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramResult> {
  const via = method === "sendPhoto" ? VIA_TELEGRAM_UPLOAD : VIA_TELEGRAM;
  try {
    const res = await externalFetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, via);
    const body = await res.json().catch(() => null) as {
      ok?: boolean;
      description?: string;
      parameters?: { migrate_to_chat_id?: number };
    } | null;
    const migrate = body?.parameters?.migrate_to_chat_id;
    return {
      ok: res.ok && body?.ok === true,
      description: body?.description ?? (res.ok ? undefined : `HTTP ${res.status}`),
      migrateToChatId: migrate ? String(migrate) : undefined,
    };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

export function makeFeedbackPingDeps(supabase: SupabaseClient, botToken: string): FeedbackPingDeps {
  return {
    fileUrl: (path) => externalFileUrl(supabase, path),
    call: (method, payload) => callTelegram(botToken, method, payload),
    saveChannelId: async (chatId) => {
      const { error } = await supabase.from("app_settings").update({ value: chatId }).eq("key", "feedback_channel_id");
      if (error) console.error(`[feedback-ping] новый id канала не сохранён: ${error.message}`);
    },
  };
}
