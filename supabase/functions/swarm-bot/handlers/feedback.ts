import { supabase } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession, getSession } from "../lib/storage.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

async function getFeedbackChannelId(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "feedback_channel_id")
    .maybeSingle();
  return data?.value ?? null;
}

async function postToChannel(channelId: string, text: string, photoFileId?: string): Promise<void> {
  if (photoFileId) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelId, photo: photoFileId, caption: text, parse_mode: "HTML" }),
    });
    if (!res.ok) console.error("[feedback] channel sendPhoto failed:", res.status, await res.text());
  } else {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) console.error("[feedback] channel sendMessage failed:", res.status, await res.text());
  }
}

async function saveFeedback(
  telegramId: number,
  username: string,
  text: string,
  photoFileId?: string,
): Promise<void> {
  const { error } = await supabase.from("feedback").insert({
    telegram_id: telegramId,
    username,
    text,
    photo_file_id: photoFileId ?? null,
  });
  if (error) throw new Error(`feedback insert failed: ${error.message}`);

  const channelId = await getFeedbackChannelId();
  if (!channelId) return;

  const date = new Date().toLocaleString("ru-RU", {
    day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const channelText = `🐛 @${username} · ${date}\n\n${text}`;
  await postToChannel(channelId, channelText, photoFileId);
}

export async function handleFeedbackCommand(chatId: number): Promise<void> {
  await setSession(chatId, "feedback_text");
  await sendMessage(chatId, "Опиши проблему или предложение:");
}

export async function handleFeedbackCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
): Promise<boolean> {
  if (cb.data !== "fb_done") return false;

  const session = await getSession(chatId);
  if (session?.action !== "feedback_photo" || !session.context) {
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return true;
  }

  const { text } = JSON.parse(session.context) as { text: string };
  await clearSession(chatId);
  try {
    await saveFeedback(userId, username, text);
    await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
  } catch {
    await sendMessage(chatId, "Ошибка при сохранении фидбека. Попробуй снова.");
  }
  return true;
}

export async function handleFeedbackPhoto(
  chatId: number,
  userId: number,
  username: string,
  photos: Array<{ file_id: string; file_size?: number }>,
): Promise<void> {
  const session = await getSession(chatId);
  if (!session?.context) {
    await clearSession(chatId);
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return;
  }

  const { text } = JSON.parse(session.context) as { text: string };
  const photoFileId = photos[photos.length - 1].file_id;
  await clearSession(chatId);
  try {
    await saveFeedback(userId, username, text, photoFileId);
    await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
  } catch {
    await sendMessage(chatId, "Ошибка при сохранении фидбека. Попробуй снова.");
  }
}

export async function handleFeedbackSessionInput(
  chatId: number,
  action: string,
  text: string,
): Promise<boolean> {
  if (action !== "feedback_text") return false;

  await setSession(chatId, "feedback_photo", JSON.stringify({ text }));
  await sendInlineMessage(
    chatId,
    "Есть скриншот? Отправь следующим сообщением.",
    [[{ text: "✅ Готово, без скриншота", callback_data: "fb_done" }]],
  );
  return true;
}
