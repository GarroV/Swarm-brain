import { supabase } from "../lib/supabase.ts";
import { getReadAiToken, readAiGet, READ_AI_API, READ_AI_AUTH_URL } from "../lib/readai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession, saveEntry } from "../lib/storage.ts";
import { chatComplete } from "../lib/openai.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export async function handleConnect(chatId: number): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Нажми кнопку — откроется браузер для авторизации Read.ai. После входа вернись в Telegram.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🔗 Подключить Read.ai", url: READ_AI_AUTH_URL }]] },
    }),
  });
}

export async function handleMeetings(chatId: number, hoursBack = 24): Promise<void> {
  const token = await getReadAiToken();
  if (!token) {
    await sendMessage(chatId, "Read.ai не подключён. Используй /connect для авторизации.");
    return;
  }

  await sendMessage(chatId, "Загружаю список встреч...");

  const startTime = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  const data = await readAiGet(`/meetings?page_size=15&start_time=${encodeURIComponent(startTime)}`) as Record<string, unknown>;
  const meetings = (data.meetings ?? data.results ?? data.data ?? []) as Array<Record<string, unknown>>;

  if (!meetings.length) {
    await sendMessage(chatId, `Встреч за последние ${hoursBack} часов не найдено.`);
    return;
  }

  const keyboard = meetings.map((m) => {
    const ts = (m.created_at ?? m.date ?? m.start_time ?? "") as string;
    const date = ts ? new Date(ts) : new Date();
    const dateStr = date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const duration = m.duration ? ` · ${Math.round((m.duration as number) / 60)} мин` : "";
    const title = (m.title as string | undefined) ?? "Без названия";
    return [{ text: `${title} · ${dateStr}${duration}`, callback_data: `meeting_${m.id}` }];
  });

  await sendInlineMessage(
    chatId,
    `<b>Встречи за последние ${hoursBack} часов:</b>\n\nВыбери встречи для добавления в базу знаний:`,
    keyboard
  );
}

export async function handleMeetingCallback(chatId: number, username: string, meetingId: string): Promise<void> {
  await sendMessage(chatId, "Обрабатываю встречу...");

  const meeting = await readAiGet(`/meetings/${meetingId}`) as Record<string, unknown>;

  const toString = (v: unknown): string => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(toString).join(" ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const title = toString(meeting.title) || "Встреча";
  const summaryObj = meeting.summary as Record<string, unknown> | undefined;
  const summary = toString(summaryObj?.summary_text ?? summaryObj?.overview ?? "");
  const transcript = toString(meeting.transcript ?? summaryObj?.transcript ?? "");
  const actionItems = (summaryObj?.action_items ?? meeting.action_items ?? []) as Array<Record<string, unknown>>;

  const contentParts = [
    `Встреча: ${title}`,
    summary ? `Краткое содержание: ${summary}` : "",
    actionItems.length
      ? `Задачи: ${actionItems.map((a) => a.text ?? a.description ?? JSON.stringify(a)).join("; ")}`
      : "",
    transcript ? `Транскрипция:\n${transcript.slice(0, 8000)}` : "",
  ].filter(Boolean).join("\n\n");

  const gptResult = await chatComplete(
    "Ты помощник для обработки встреч. На основе данных встречи сформируй структурированный итог:\n" +
    "1. 🔑 Ключевые тезисы (3-7 пунктов)\n" +
    "2. ✅ Задачи с ответственными и дедлайнами (если есть)\n" +
    "Отвечай на русском языке. Будь конкретным.",
    contentParts
  );

  const entryId = await saveEntry(contentParts, username, "read_ai", { meeting_id: meetingId, title });
  await sendMessage(chatId, `<b>📋 ${title}</b>\n\n${gptResult}`);
  // DISABLED: await analyzeAndCreateTasks(contentParts, chatId, entryId);
}

export async function handleMeetingCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  username: string
): Promise<boolean> {
  const data = cb.data;

  if (data.startsWith("meeting_")) {
    await handleMeetingCallback(chatId, username, data.replace("meeting_", ""));
    return true;
  }
  if (data.startsWith("md_")) {
    const entryId = data.replace("md_", "");

    const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
    const title = (entry?.metadata?.title as string) ?? "Встреча";
    const meetingId = entry?.metadata?.meeting_id as string | null ?? null;

    if (meetingId) {
      const { data: taskIds } = await supabase.from("tasks").select("id").eq("meeting_id", meetingId);
      if (taskIds?.length) {
        const ids = taskIds.map((t: { id: string }) => t.id);
        await supabase.from("task_history").delete().in("task_id", ids);
        await supabase.from("tasks").delete().eq("meeting_id", meetingId);
      }
    }
    await supabase.from("entries").delete().eq("id", entryId);

    await sendMessage(chatId, `🗑 Удалено: <b>${title}</b> и все связанные задачи.`);
    return true;
  }
  if (data.startsWith("rai_")) {
    const sub = data.replace("rai_", "");
    if (sub === "saved") {
      const { data: meetings } = await supabase
        .from("entries").select("id, metadata, created_at, source, entry_type")
        .or("source.in.(read_ai,voice),entry_type.in.(transcript,meeting)")
        .order("created_at", { ascending: false }).limit(15);
      if (!meetings?.length) {
        await sendMessage(chatId, "Сохранённых встреч пока нет.");
      } else {
        await sendMessage(chatId, `<b>📋 Встречи из Read.ai:</b>`);
        for (const m of meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string }>) {
          const title = (m.metadata?.title as string) ?? "Встреча";
          const date = new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
          const duration = m.metadata?.duration ? ` · ${Math.round((m.metadata.duration as number) / 60)} мин` : "";
          const tags = (m.metadata?.tags as string[] | undefined)?.length ? `\n🏷 ${(m.metadata.tags as string[]).join(", ")}` : "";
          const meetingId = (m.metadata?.meeting_id as string | undefined) ?? m.id;
          const row1 = [{ text: "🔍 Подробнее", callback_data: `mr_${m.id}` }];
          const row2 = [
            { text: "🌍 Теги/страны", callback_data: `mtag_${meetingId}` },
            { text: "👤 Участники", callback_data: `massign_${meetingId}` },
          ];
          await sendInlineMessage(chatId, `📋 <b>${title}</b>\n📅 ${date}${duration}${tags}`, [row1, row2]);
        }
      }
    } else if (sub === "import") {
      await handleMeetings(chatId, 48);
    } else if (sub === "connect") {
      await handleConnect(chatId);
    }
    return true;
  }
  if (data.startsWith("mr_")) {
    const entryId = data.replace("mr_", "");
    const { data: entry } = await supabase.from("entries").select("content, metadata, created_at").eq("id", entryId).maybeSingle();
    if (!entry) { await sendMessage(chatId, "Встреча не найдена."); return true; }

    const title = (entry.metadata?.title as string) ?? "Встреча";
    const meetingId = entry.metadata?.meeting_id as string | undefined;
    const tags = (entry.metadata?.tags as string[] | undefined);
    const date = new Date(entry.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    let tasksText = "";
    if (meetingId) {
      const { data: tasks } = await supabase.from("tasks").select("title, assignees, due_date, status").eq("meeting_id", meetingId).limit(8);
      if (tasks?.length) {
        tasksText = "\n\n<b>✅ Задачи:</b>\n" + tasks.map((t: { title: string; assignees: string[]; due_date: string | null; status: string }) => {
          const who = t.assignees?.join(", ");
          const due = t.due_date ? ` · до ${t.due_date}` : "";
          const done = t.status === "done" ? " ✓" : "";
          return `• ${t.title}${who ? ` (${who})` : ""}${due}${done}`;
        }).join("\n");
      }
    }

    const tagsLine = tags?.length ? `\n🏷 ${tags.join(", ")}` : "";
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const contentPreview = escHtml((entry.content ?? "").split("Стенограмма:")[0].trim().slice(0, 1200));

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    keyboard.push([{ text: "✏️ Переименовать", callback_data: `mrename_${entryId}` }]);
    if (meetingId) {
      keyboard.push([
        { text: "🌍 Теги/страны", callback_data: `mtag_${meetingId}` },
        { text: "👤 Участники", callback_data: `massign_${meetingId}` },
      ]);
    }
    keyboard.push([{ text: "🗑 Удалить встречу и все задачи", callback_data: `md_${entryId}` }]);

    await sendInlineMessage(
      chatId,
      `<b>📋 ${title}</b>\n<i>${date}</i>${tagsLine}\n\n${contentPreview}${tasksText}`,
      keyboard
    );
    return true;
  }
  if (data.startsWith("mrename_")) {
    const entryId = data.replace("mrename_", "");
    await setSession(chatId, `meeting_rename_${entryId}`);
    await sendMessage(chatId, "Введи новое название встречи:");
    return true;
  }
  if (data.startsWith("mtag_")) {
    const meetingId = data.replace("mtag_", "");
    await setSession(chatId, `meeting_tag_${meetingId}`);
    await sendMessage(chatId, "Введи теги/страны через запятую (например: <i>Словения, Болгария, Sales</i>):");
    return true;
  }
  if (data.startsWith("massign_")) {
    const meetingId = data.replace("massign_", "");
    const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    type Profile = { telegram_id: number; first_name?: string; last_name?: string };
    const profileMap: Record<number, Profile> = Object.fromEntries(
      (profiles ?? []).map((p: Profile) => [p.telegram_id, p])
    );
    const seen = new Set<number>();
    const buttons = ((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>)
      .filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; })
      .map((u) => {
        const p = profileMap[u.telegram_id];
        const label = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
        return [{ text: `👤 ${label}`, callback_data: `mau_${meetingId}_${u.telegram_id}` }];
      });
    await sendInlineMessage(chatId, "Кто участвовал в встрече? Можно выбрать несколько:", buttons);
    return true;
  }
  if (data.startsWith("mau_")) {
    const rest = data.replace("mau_", "");
    const sep = rest.lastIndexOf("_");
    const meetingId = rest.slice(0, sep);
    const targetTgId = Number(rest.slice(sep + 1));
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
    const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
    const assigneeName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : (au?.username ? `@${au.username}` : `ID ${targetTgId}`);
    const { data: meetingTasks } = await supabase.from("tasks").select("id, assignees").eq("meeting_id", meetingId);
    for (const t of (meetingTasks ?? []) as Array<{ id: string; assignees: string[] }>) {
      const existing = t.assignees ?? [];
      if (!existing.includes(assigneeName)) {
        await supabase.from("tasks").update({ assignees: [...existing, assigneeName], status: "pending" }).eq("id", t.id);
      }
    }
    await sendMessage(chatId, `✅ <b>${assigneeName}</b> добавлен(а) к задачам встречи.`);
    return true;
  }
  if (data.startsWith("mexp_")) {
    // Export meeting as file from admin panel
    const entryId = data.replace("mexp_", "");
    const { data: entry } = await supabase.from("entries").select("content, metadata, created_at").eq("id", entryId).maybeSingle();
    if (!entry) { await sendMessage(chatId, "Встреча не найдена."); }
    else {
      const rawTitle = ((entry.metadata as Record<string, unknown>)?.title as string | undefined) ?? "meeting";
      const safeTitle = rawTitle.replace(/[^\wа-яёА-ЯЁ\s-]/g, "").trim().replace(/\s+/g, "_");
      const dateStr = new Date(entry.created_at as string).toISOString().slice(0, 10);
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("document", new Blob([entry.content as string], { type: "text/plain; charset=utf-8" }), `${safeTitle}_${dateStr}.txt`);
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    }
    return true;
  }
  if (data.startsWith("mc_")) {
    // Confirm meeting from read-ai-webhook
    const entryId = data.replace("mc_", "");
    const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
    if (!entry) { await sendMessage(chatId, "Встреча не найдена."); }
    else {
      await supabase.from("entries").update({ metadata: { ...(entry.metadata as Record<string, unknown>), confirmed: true } }).eq("id", entryId);
      const title = ((entry.metadata as Record<string, unknown>)?.title as string) ?? "Встреча";
      await sendMessage(chatId, `✅ Встреча сохранена: <b>${title}</b>`);
    }
    return true;
  }
  if (data.startsWith("met_")) {
    // Edit meeting title (from confirmation flow)
    const entryId = data.replace("met_", "");
    await setSession(chatId, `meeting_title_${entryId}`);
    await sendMessage(chatId, "Введи название встречи:");
    return true;
  }
  if (data.startsWith("med_")) {
    // Edit meeting date (from confirmation flow)
    const entryId = data.replace("med_", "");
    await setSession(chatId, `meeting_date_${entryId}`);
    await sendMessage(chatId, "Введи дату встречи (например: 7 мая 2025 или 2025-05-07):");
    return true;
  }
  return false;
}

export async function handleMeetingSessionInput(
  chatId: number,
  action: string,
  text: string
): Promise<boolean> {
  if (action.startsWith("meeting_title_")) {
    await clearSession(chatId);
    const entryId = action.replace("meeting_title_", "");
    const newTitle = text.trim();
    const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
    if (!entry) { await sendMessage(chatId, "Встреча не найдена."); }
    else {
      await supabase.from("entries").update({ metadata: { ...(entry.metadata as Record<string, unknown>), title: newTitle } }).eq("id", entryId);
      await sendMessage(chatId, `✅ Название: <b>${newTitle}</b>`, {
        inline_keyboard: [[
          { text: "✅ Сохранить", callback_data: `mc_${entryId}` },
          { text: "📅 Дата", callback_data: `med_${entryId}` },
        ]],
      });
    }
    return true;
  }
  if (action.startsWith("meeting_date_")) {
    await clearSession(chatId);
    const entryId = action.replace("meeting_date_", "");
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Верни ТОЛЬКО дату в этом формате, без пояснений. Если не можешь распознать — верни "null".`,
      text.trim()
    );
    const dateVal = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!dateVal) { await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз."); }
    else {
      const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
      if (!entry) { await sendMessage(chatId, "Встреча не найдена."); }
      else {
        await supabase.from("entries").update({ metadata: { ...(entry.metadata as Record<string, unknown>), entry_date: dateVal } }).eq("id", entryId);
        const dateFmt = new Date(`${dateVal}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
        await sendMessage(chatId, `📅 Дата: <b>${dateFmt}</b>`, {
          inline_keyboard: [[
            { text: "✅ Сохранить", callback_data: `mc_${entryId}` },
            { text: "✏️ Название", callback_data: `met_${entryId}` },
          ]],
        });
      }
    }
    return true;
  }
  return false;
}
