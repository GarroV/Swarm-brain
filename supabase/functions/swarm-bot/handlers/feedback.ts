import { supabase } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage, getTelegramFileUrl } from "../lib/telegram.ts";
import { uploadToStorage, setSession, clearSession, getSession } from "../lib/storage.ts";
import {
  FEEDBACK_CATEGORIES,
  feedbackCategoryLabel,
  isFeedbackCategory,
} from "../../_shared/feedback-categories.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const BOT_NAME = Deno.env.get("BOT_NAME") ?? "bot";

async function getFeedbackChannelId(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "feedback_channel_id")
    .maybeSingle();
  return data?.value ? String(data.value) : null;
}

/** Компактная клавиатура выбора раздела — по 2 в ряд (плотно, в стиле бота). */
function categoryKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < FEEDBACK_CATEGORIES.length; i += 2) {
    rows.push(
      FEEDBACK_CATEGORIES.slice(i, i + 2).map((c) => ({
        text: c.label,
        callback_data: `fbcat_${c.code}`,
      })),
    );
  }
  return rows;
}

/** Пост в фидбек-канал — только пинг, БЕЗ inline-кнопок. Скрин отдаём durable-ссылкой. */
async function postToChannel(
  channelId: string,
  text: string,
  screenshotUrl?: string,
): Promise<void> {
  const method = screenshotUrl ? "sendPhoto" : "sendMessage";
  const payload = screenshotUrl
    ? { chat_id: channelId, photo: screenshotUrl, caption: text, parse_mode: "HTML" }
    : { chat_id: channelId, text, parse_mode: "HTML" };

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    // Telegram migrated group → supergroup: update stored chat_id and retry
    if (json?.parameters?.migrate_to_chat_id) {
      const newId = String(json.parameters.migrate_to_chat_id);
      await supabase.from("app_settings").update({ value: newId }).eq("key", "feedback_channel_id");
      await postToChannel(newId, text, screenshotUrl);
      return;
    }
    throw new Error(`${method} failed ${res.status}: ${JSON.stringify(json)}`);
  }
}

/** Скачать фото из Telegram и переложить в swarm_drive → durable public URL. */
async function screenshotToStorage(photoFileId: string): Promise<string | undefined> {
  try {
    const tgUrl = await getTelegramFileUrl(photoFileId);
    const res = await fetch(tgUrl);
    if (!res.ok) return undefined;
    const buffer = await res.arrayBuffer();
    const { url } = await uploadToStorage("feedback.jpg", buffer, "image/jpeg", "feedback");
    return url ?? undefined;
  } catch {
    return undefined; // скрин — не критично; фидбек сохраняем и без него
  }
}

async function saveFeedback(
  telegramId: number,
  username: string,
  text: string,
  category: string,
  screenshotUrl?: string,
  photoFileId?: string,
): Promise<void> {
  const { error } = await supabase.from("feedback").insert({
    telegram_id: telegramId,
    username,
    text,
    category,
    source: "bot",
    screenshot_url: screenshotUrl ?? null,
    photo_file_id: photoFileId ?? null,
  });
  if (error) throw new Error(`feedback insert failed: ${error.message}`);

  const channelId = await getFeedbackChannelId();
  if (!channelId) return;

  const date = new Date().toLocaleString("ru-RU", {
    day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const channelText =
    `<b>[${BOT_NAME}]</b> 🐛 ${feedbackCategoryLabel(category)} · @${username} · ${date}\n\n${text}`;
  await postToChannel(channelId, channelText, screenshotUrl);
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
  // Legacy: кнопка «Прочитано» в старых сообщениях канала — теперь помечаем read, НЕ удаляем.
  if (cb.data.startsWith("fb_read_")) {
    const feedbackId = cb.data.slice("fb_read_".length);
    await supabase
      .from("feedback")
      .update({ status: "read", resolved_at: new Date().toISOString() })
      .eq("id", feedbackId);
    return true;
  }

  // Выбор раздела → переходим к шагу скриншота.
  if (cb.data.startsWith("fbcat_")) {
    const category = cb.data.slice("fbcat_".length);
    if (!isFeedbackCategory(category)) return true;

    const session = await getSession(chatId);
    if (session?.action !== "feedback_category" || !session.context) {
      await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
      return true;
    }
    const { text } = JSON.parse(session.context) as { text: string };
    await setSession(chatId, "feedback_photo", JSON.stringify({ text, category }));
    await sendInlineMessage(
      chatId,
      "Есть скриншот? Отправь следующим сообщением.",
      [[{ text: "✅ Готово, без скриншота", callback_data: "fb_done" }]],
    );
    return true;
  }

  if (cb.data !== "fb_done") return false;

  const session = await getSession(chatId);
  if (session?.action !== "feedback_photo" || !session.context) {
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return true;
  }

  const { text, category } = JSON.parse(session.context) as { text: string; category: string };
  await clearSession(chatId);
  try {
    await saveFeedback(userId, username, text, category);
    await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
  } catch (err) {
    await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
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
  if (session?.action !== "feedback_photo" || !session.context) {
    await clearSession(chatId);
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return;
  }

  const { text, category } = JSON.parse(session.context) as { text: string; category: string };
  const photoFileId = photos[photos.length - 1].file_id;
  await clearSession(chatId);
  try {
    const screenshotUrl = await screenshotToStorage(photoFileId);
    await saveFeedback(userId, username, text, category, screenshotUrl, photoFileId);
    await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
  } catch (err) {
    await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Retention: удалить давно закрытый фидбек (done/wontfix старше N дней) вместе со
 * скринами в swarm_drive. Незакрытый (new/triaged) НЕ трогаем. Дёргается pg_cron
 * через {feedback_retention_cron:true}. Возвращает число удалённых строк.
 */
const FEEDBACK_RETENTION_DAYS = 90;
export async function cleanupOldFeedback(): Promise<number> {
  const cutoff = new Date(Date.now() - FEEDBACK_RETENTION_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from("feedback")
    .select("id, screenshot_url")
    .in("status", ["done", "wontfix"])
    .lt("resolved_at", cutoff);
  if (error || !data?.length) return 0;

  const paths = (data as Array<{ screenshot_url: string | null }>)
    .map((f) => f.screenshot_url)
    .filter((u): u is string => Boolean(u))
    .map((u) => u.split("/swarm_drive/")[1])
    .filter((p): p is string => Boolean(p));
  if (paths.length) await supabase.storage.from("swarm_drive").remove(paths);

  const ids = (data as Array<{ id: string }>).map((f) => f.id);
  await supabase.from("feedback").delete().in("id", ids);
  return ids.length;
}

export async function handleFeedbackSessionInput(
  chatId: number,
  action: string,
  text: string,
): Promise<boolean> {
  // Шаг 1: получили текст → просим выбрать раздел.
  if (action === "feedback_text") {
    await setSession(chatId, "feedback_category", JSON.stringify({ text }));
    await sendInlineMessage(chatId, "Какой раздел? Выбери:", categoryKeyboard());
    return true;
  }
  // Пользователь в шаге выбора раздела прислал текст вместо кнопки — переспросим.
  if (action === "feedback_category") {
    await sendInlineMessage(chatId, "Выбери раздел кнопкой ниже:", categoryKeyboard());
    return true;
  }
  return false;
}
