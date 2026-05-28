import { supabase, ADMIN_USER_ID } from "./lib/supabase.ts";
import { sendMessage, sendInlineMessage, buildKeyboard, answerCallback } from "./lib/telegram.ts";
import { checkAllowed, autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
import { getReadAiToken } from "./lib/readai.ts";
import { handleAdd, handleAsk } from "./handlers/knowledge.ts";
import { handleVoice, handleDocument, handlePhoto, handleUrl, extractUrl } from "./handlers/media.ts";
import { handleTaskCallbacks, handleTasks, handleAddTask, handleTaskSessionInput } from "./tasks/index.ts";
import { handleMeetings, handleMeetingCallbacks, handleMeetingSessionInput } from "./handlers/meetings.ts";
import { handleUsers, handleUserCallbacks, handleUserSessionInput } from "./handlers/users.ts";
import { handleGranolaCallbacks, handleGranolaCommand, handleGranolaSessionInput, pollGranolaForUser } from "./handlers/granola.ts";
import { sendAllDigests, generatePersonalDigest } from "./handlers/digest.ts";
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
        { command: "addtask", description: "Добавить задачу" },
        { command: "meetings", description: "Встречи на подтверждение" },
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

    await autoSyncProfile(userId, cb.from.first_name, cb.from.last_name, cb.from.username);

    try {
      if (await handleTaskCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleMeetingCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleUserCallbacks(cb, chatId, userId)) {
        // handled
      } else if (await handleGranolaCallbacks(cb, chatId, userId, username)) {
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
    if (message.voice) { await handleVoice(chatId, username, message.voice.file_id, message.voice.duration); return new Response("OK", { status: 200 }); }
    if (message.audio) { await handleVoice(chatId, username, message.audio.file_id, 0); return new Response("OK", { status: 200 }); }
    if (message.document) { await handleDocument(chatId, username, message.document); return new Response("OK", { status: 200 }); }
    if (message.photo?.length) { await handlePhoto(chatId, username, message.photo); return new Response("OK", { status: 200 }); }

    const text = message.text?.trim();
    if (!text) return new Response("OK", { status: 200 });

    const BUTTON_LABELS = new Set(["📥 Добавить", "❓ Спросить", "📋 Задачи", "ℹ️ Помощь", "👥 Пользователи", "🎙 Встречи", "🎙 Read.ai"]);
    const isButtonPress = BUTTON_LABELS.has(text);
    const isCommand = text.startsWith("/") || isButtonPress;

    if (!isCommand) {
      const url = extractUrl(text);
      if (url && text.length < 300) {
        const analyze = /посмотри|проанализируй|прочитай|загрузи|открой|что тут|что здесь|что это|summarize|analyze/i.test(text);
        await handleUrl(chatId, username, url, text, analyze);
        return new Response("OK", { status: 200 });
      }

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
      } else if (action && await handleUserSessionInput(chatId, userId, action, text)) {
        // user session handled
      } else if (action && await handleTaskSessionInput(chatId, userId, action, text, session?.context ?? undefined)) {
        // task session handled
      } else if (action && await handleGranolaSessionInput(chatId, userId, action, text)) {
        // granola session handled
      } else {
        // Route "добавь в базу: ..." directly to handleAdd — bypass GPT entirely
        const saveMatch = text.match(/^(добавь\s+в\s+баз[уе]|сохрани\s+в\s+баз[уе]|занеси\s+в\s+баз[уе]|добавь\s+в\s+знания)\s*:?\s*/i);
        if (saveMatch) {
          const content = text.slice(saveMatch[0].length).trim();
          await handleAdd(chatId, username, content || text);
        } else if (text.length >= 3) {
          await handleAsk(chatId, text);
        }
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
          { command: "tasks", description: "Задачи команды" },
          { command: "addtask", description: "Добавить задачу" },
          { command: "meetings", description: "Встречи на подтверждение" },
          { command: "users", description: "Управление командой" },
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
    } else if (command === "/users" || text === "👥 Пользователи") {
      await handleUsers(chatId, userId, argText);
    } else if (command === "/tasks" || text === "📋 Задачи") {
      await handleTasks(chatId, userId, argText);
    } else if (command === "/addtask") {
      await handleAddTask(chatId);
    } else if (command === "/meetings" || text === "🎙 Встречи") {
      await pollGranolaForUser(chatId, userId);
      const { data: meetings } = await supabase
        .from("entries")
        .select("id, metadata, created_at, source")
        .in("source", ["read_ai", "granola"])
        .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!meetings?.length) {
        await sendMessage(chatId, "✅ Все встречи подтверждены, новых нет.");
      } else {
        await sendMessage(chatId, `<b>📋 Встречи — ожидают проверки (${meetings.length})</b>\nОткрой каждую, проверь тезисы и подтверди:`);
        for (const m of (meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string; source: string }>)) {
          const title = (m.metadata?.title as string) ?? "Без названия";
          const entryDate = (m.metadata?.entry_date as string) ?? m.created_at.split("T")[0];
          const dateStr = new Date(`${entryDate}T12:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
          const src = m.source === "granola" ? "📓" : "📹";
          await sendInlineMessage(chatId, `${src} <b>${title}</b>\n📅 ${dateStr}`, [[
            { text: "🔍 Тезисы", callback_data: `mr_${m.id}` },
            { text: "🗑", callback_data: `md_${m.id}` },
          ]]);
        }
      }
    } else if (command === "/granola") {
      await handleGranolaCommand(chatId, userId);
    } else if (command === "/connect") {
      const [service, apiKey] = argText.trim().split(/\s+/);
      if (!service || !apiKey) {
        await sendMessage(chatId, "Использование: <code>/connect granola ВАШ_КЛЮЧ</code>");
      } else if (service.toLowerCase() !== "granola") {
        await sendMessage(chatId, `Неизвестный сервис: <code>${service}</code>. Доступно: granola`);
      } else {
        await sendMessage(chatId, "Проверяю ключ...");
        const testRes = await fetch("https://public-api.granola.ai/v1/notes?limit=1", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!testRes.ok) {
          await sendMessage(chatId, "❌ Ключ не подошёл. Проверь правильность и попробуй снова.");
        } else {
          await supabase.from("user_integrations").upsert(
            { telegram_id: userId, service: "granola", api_key: apiKey, last_polled_at: new Date().toISOString() },
            { onConflict: "telegram_id,service" }
          );
          await sendMessage(chatId, "✅ <b>Granola подключена!</b>\n\nТеперь новые встречи будут прилетать автоматически раз в час.\nИли используй /granola для ручного импорта.");
        }
      }
    } else if (command === "/disconnect") {
      const service = argText.trim().toLowerCase();
      if (!service) {
        await sendMessage(chatId, "Использование: <code>/disconnect granola</code>");
      } else {
        const { error } = await supabase.from("user_integrations")
          .delete().eq("telegram_id", userId).eq("service", service);
        if (error) {
          await sendMessage(chatId, `Ошибка: ${error.message}`);
        } else {
          await sendMessage(chatId, `✅ <b>${service}</b> отключена.`);
        }
      }
    } else if (command === "/digest") {
      bgRun(generatePersonalDigest(chatId, userId), chatId);
    } else if (command === "/status") {
      const [
        { count: totalMeetings },
        { data: unconfirmed },
        { data: lastMeeting },
        { count: openTasks },
        { count: overdueTasks },
      ] = await Promise.all([
        supabase.from("entries").select("*", { count: "exact", head: true }).in("source", ["read_ai", "granola"]),
        supabase.from("entries").select("id, metadata, created_at").eq("source", "read_ai").eq("metadata->>confirmed", "false").order("created_at", { ascending: false }),
        supabase.from("entries").select("metadata, created_at, source").in("source", ["read_ai", "granola"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "open").lt("due_date", new Date().toISOString().split("T")[0]),
      ]);

      let statusMsg = `<b>📊 Статус Swarm Brain</b>\n\n`;

      statusMsg += `<b>🎙 Встречи</b>\n`;
      statusMsg += `Всего в базе: <b>${totalMeetings ?? 0}</b>\n`;

      const unconfirmedList = (unconfirmed ?? []) as Array<{ id: string; metadata: Record<string, unknown>; created_at: string }>;
      if (unconfirmedList.length > 0) {
        statusMsg += `⏳ Ожидают подтверждения: <b>${unconfirmedList.length}</b>\n`;
        for (const m of unconfirmedList.slice(0, 3)) {
          const title = (m.metadata?.title as string) ?? "Без названия";
          const date = new Date(m.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
          statusMsg += `  • ${title} (${date})\n`;
        }
        if (unconfirmedList.length > 3) statusMsg += `  и ещё ${unconfirmedList.length - 3}...\n`;
      } else {
        statusMsg += `✅ Все встречи подтверждены\n`;
      }

      if (lastMeeting) {
        const hoursAgo = Math.round((Date.now() - new Date((lastMeeting as { created_at: string }).created_at).getTime()) / 3_600_000);
        const title = ((lastMeeting as { metadata: Record<string, unknown> }).metadata?.title as string) ?? "Без названия";
        const src = (lastMeeting as { source: string }).source === "granola" ? "Granola" : "Read.ai";
        const freshness = hoursAgo < 24 ? `${hoursAgo} ч назад` : `${Math.round(hoursAgo / 24)} дн назад`;
        statusMsg += `Последняя: <b>${title}</b> · ${src} · ${freshness}\n`;
      }

      statusMsg += `\n<b>✅ Задачи</b>\n`;
      statusMsg += `Открытых: <b>${openTasks ?? 0}</b>`;
      if ((overdueTasks ?? 0) > 0) statusMsg += `  ⚠️ Просрочено: <b>${overdueTasks}</b>`;

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
