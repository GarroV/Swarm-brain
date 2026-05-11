import { supabase, ADMIN_USER_ID } from "./lib/supabase.ts";
import { sendMessage, sendInlineMessage, buildKeyboard, answerCallback } from "./lib/telegram.ts";
import { checkAllowed, autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
import { getReadAiToken } from "./lib/readai.ts";
import { handleAdd, handleAsk } from "./handlers/knowledge.ts";
import { handleVoice, handleDocument, handlePhoto, handleUrl, extractUrl } from "./handlers/media.ts";
import { handleTaskCallbacks } from "./handlers/tasks.ts";
import { handleMeetings, handleMeetingCallbacks, handleMeetingSessionInput } from "./handlers/meetings.ts";
import { handleUserCallbacks } from "./handlers/users.ts";
import { sendAllDigests } from "./handlers/digest.ts";
import { getHelpText } from "./handlers/help.ts";
import type { TgMessage, TgCallbackQuery } from "./lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

// ── Background runner — returns 200 to Telegram immediately, processes async ──

function bgRun(promise: Promise<void>, chatId: number): void {
  const safe = promise.catch(async (err) => {
    await sendMessage(chatId, `Ошибка обработки: ${err instanceof Error ? err.message : String(err)}`);
  });
  // @ts-ignore - Supabase Edge Runtime API
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(safe);
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  // ── Cron triggers ─────────────────────────────────────────────────────────────
  if (body.setup_commands === true) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [
        { command: "start", description: "Главное меню" },
        { command: "add", description: "Добавить запись в базу знаний" },
        { command: "ask", description: "Задать вопрос" },
        { command: "tasks", description: "Задачи команды" },
        { command: "meetings", description: "Встречи и транскрипты" },
        { command: "status", description: "Состояние базы знаний" },
        { command: "digest", description: "Личный дайджест" },
        { command: "help", description: "Справка" },
        { command: "reset", description: "Сбросить состояние бота" },
      ]}),
    });
    const json = await res.json();
    return new Response(JSON.stringify(json), { status: 200 });
  }

  if (body.digest_cron === true) {
    await sendAllDigests(7);
    return new Response("OK", { status: 200 });
  }

  if (body.readai_token_refresh === true) {
    await getReadAiToken();
    // Check if meetings are still coming in — alert if last one is >3 days ago
    const { data: lastMeeting } = await supabase
      .from("entries").select("created_at").eq("source", "read_ai")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastMeeting) {
      const hoursAgo = (Date.now() - new Date(lastMeeting.created_at).getTime()) / 3_600_000;
      if (hoursAgo > 72) {
        await sendMessage(
          ADMIN_USER_ID,
          `⚠️ <b>Встречи не поступают</b> — последняя была ${Math.round(hoursAgo / 24)} дн назад.\n\nПроверь вебхук в настройках Read.ai.`
        );
      }
    }
    return new Response("OK", { status: 200 });
  }

  const update = body as { message?: TgMessage; callback_query?: TgCallbackQuery };

  // ── Callback query (inline button press) ────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from.id ?? 0;
    const username = cb.from.username ?? String(userId);
    const chatId = cb.message.chat.id;

    await answerCallback(cb.id);

    if (!(await checkAllowed(userId))) return new Response("OK", { status: 200 });

    try {
      if (await handleTaskCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleMeetingCallbacks(cb, chatId, username)) {
        // handled
      } else if (await handleUserCallbacks(cb, chatId, userId)) {
        // handled
      }
    } catch (err) {
      await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new Response("OK", { status: 200 });
  }

  // ── Message ────────────────────────────────────────────────────────────────
  const message = update.message;
  if (!message) return new Response("OK", { status: 200 });

  const chatId = message.chat.id;
  const userId = message.from?.id ?? 0;
  const username = message.from?.username ?? String(userId);

  const allowed = await checkAllowed(userId, message.from?.username);
  if (!allowed) {
    await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
    return new Response("OK", { status: 200 });
  }

  await autoSyncProfile(userId, message.from?.first_name, message.from?.last_name, message.from?.username);

  try {
    if (message.voice) { bgRun(handleVoice(chatId, username, message.voice.file_id, message.voice.duration), chatId); return new Response("OK", { status: 200 }); }
    if (message.audio) { bgRun(handleVoice(chatId, username, message.audio.file_id, 0), chatId); return new Response("OK", { status: 200 }); }
    if (message.document) { bgRun(handleDocument(chatId, username, message.document), chatId); return new Response("OK", { status: 200 }); }
    if (message.photo?.length) { bgRun(handlePhoto(chatId, username, message.photo), chatId); return new Response("OK", { status: 200 }); }

    const text = message.text?.trim();
    if (!text) return new Response("OK", { status: 200 });

    const BUTTON_LABELS = new Set(["📥 Добавить", "❓ Спросить", "📋 Задачи", "ℹ️ Помощь", "👥 Пользователи", "🎙 Встречи", "🎙 Read.ai"]);
    const isButtonPress = BUTTON_LABELS.has(text);
    const isCommand = text.startsWith("/") || isButtonPress;

    if (!isCommand) {
      const url = extractUrl(text);
      if (url && text.length < 300) { await handleUrl(chatId, username, url); return new Response("OK", { status: 200 }); }

      const session = await getSession(chatId);
      const action = session?.action ?? null;

      if (action === "waiting_add") {
        await clearSession(chatId);
        await handleAdd(chatId, username, text);
      } else if (action === "waiting_ask") {
        await clearSession(chatId);
        await handleAsk(chatId, text);
      } else if (action && await handleMeetingSessionInput(chatId, action, text)) {
        // meeting session handled
      } else {
        if (text.length >= 3) await handleAsk(chatId, text);
      }
      return new Response("OK", { status: 200 });
    }

    // Commands
    const [command, ...rest] = text.split(/\s+/);
    const argText = isButtonPress ? "" : rest.join(" ");
    await clearSession(chatId);

    if (command === "/reset") {
      await clearSession(chatId);
      await sendMessage(chatId, "🔄 Сброс выполнен. Бот готов к работе.");
    } else if (command === "/start") {
      await clearSession(chatId);
      await sendMessage(chatId, "<b>Swarm Brain</b>\n\nКомандная база знаний.\n\n📥 <b>Добавить</b> — записать текст в базу\n❓ <b>Спросить</b> — задать вопрос по базе\n\nТакже можно отправить голосовое или файл — содержимое будет сохранено.", buildKeyboard());
      // Register bot commands in side menu (idempotent)
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands: [
          { command: "start", description: "Главное меню" },
          { command: "add", description: "Добавить запись в базу знаний" },
          { command: "ask", description: "Задать вопрос" },
          { command: "meetings", description: "Список встреч" },
          { command: "status", description: "Состояние базы знаний" },
          { command: "help", description: "Справка" },
          { command: "reset", description: "Сбросить состояние бота" },
        ]}),
      });
    } else if (command === "/help" || text === "ℹ️ Помощь") {
      await sendMessage(chatId, getHelpText(), buildKeyboard());
    } else if (command === "/add" || text === "📥 Добавить") {
      await handleAdd(chatId, username, argText);
    } else if (command === "/ask" || text === "❓ Спросить") {
      await handleAsk(chatId, argText.trim() ? argText : "");
    } else if (command === "/meetings") {
      const { data: meetings } = await supabase
        .from("entries")
        .select("id, metadata, created_at, source")
        .or("source.in.(read_ai,voice),entry_type.in.(transcript,meeting)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!meetings?.length) {
        await sendMessage(chatId, "Встреч пока нет.");
      } else {
        await sendMessage(chatId, `<b>📋 Встречи (${meetings.length})</b>`);
        for (const m of (meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string; source: string }>)) {
          const title = (m.metadata?.title as string) ?? "Без названия";
          const entryDate = m.metadata?.entry_date as string | undefined;
          const dateStr = entryDate
            ? new Date(`${entryDate}T12:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
            : new Date(m.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
          const unconfirmed = m.metadata?.confirmed === false ? " ⏳" : "";
          const src = m.source === "read_ai" ? "📹" : m.source === "voice" ? "🎙" : "📄";
          await sendInlineMessage(chatId, `${src} <b>${title}</b>${unconfirmed}\n📅 ${dateStr}`, [[
            { text: "🔍 Детали", callback_data: `mr_${m.id}` },
            { text: "📤 Файл", callback_data: `mexp_${m.id}` },
            { text: "🗑", callback_data: `md_${m.id}` },
          ]]);
        }
      }
    } else if (command === "/status") {
      const { data: lastMeeting } = await supabase
        .from("entries").select("metadata, created_at").eq("source", "read_ai")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { count: totalMeetings } = await supabase
        .from("entries").select("*", { count: "exact", head: true }).eq("source", "read_ai");
      const { count: pendingTasks } = await supabase
        .from("tasks").select("*", { count: "exact", head: true }).eq("status", "pending");
      const { count: openTasks } = await supabase
        .from("tasks").select("*", { count: "exact", head: true }).eq("status", "open");

      let statusMsg = `<b>📊 Статус Swarm Brain</b>\n\n`;
      statusMsg += `🎙 Встреч в базе: <b>${totalMeetings ?? 0}</b>\n`;
      if (lastMeeting) {
        const lastDate = new Date(lastMeeting.created_at);
        const hoursAgo = Math.round((Date.now() - lastDate.getTime()) / 3_600_000);
        const title = (lastMeeting.metadata?.title as string) ?? "Без названия";
        const freshness = hoursAgo < 24 ? `${hoursAgo} ч назад ✅` : hoursAgo < 72 ? `${Math.round(hoursAgo / 24)} дн назад ⚠️` : `${Math.round(hoursAgo / 24)} дн назад ❌`;
        statusMsg += `📅 Последняя: <b>${title}</b> — ${freshness}\n`;
      } else {
        statusMsg += `📅 Последняя встреча: <b>не найдена</b> ❌\n`;
      }
      statusMsg += `\n⏳ Задач на подтверждении: <b>${pendingTasks ?? 0}</b>`;
      statusMsg += `\n✅ Активных задач: <b>${openTasks ?? 0}</b>`;
      await sendMessage(chatId, statusMsg);
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
