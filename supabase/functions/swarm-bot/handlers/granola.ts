import { supabase } from "../lib/supabase.ts";
import { chatComplete, getEmbedding } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const GRANOLA_API = "https://public-api.granola.ai/v1";

type GranolaNote = {
  id: string;
  title: string;
  created_at: string;
  calendar_event?: { scheduled_start_time?: string; scheduled_end_time?: string };
  attendees?: Array<{ name?: string; email?: string }>;
};

async function getUserApiKey(telegramId: number): Promise<string | null> {
  const { data } = await supabase
    .from("user_integrations")
    .select("api_key")
    .eq("telegram_id", telegramId)
    .eq("service", "granola")
    .maybeSingle();
  return data?.api_key ?? null;
}

async function fetchGranolaNote(apiKey: string, noteId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${GRANOLA_API}/notes/${noteId}?include=transcript`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  return await res.json() as Record<string, unknown>;
}

async function fetchNotesSince(apiKey: string, createdAfter: string): Promise<GranolaNote[]> {
  const res = await fetch(
    `${GRANOLA_API}/notes?created_after=${encodeURIComponent(createdAfter)}&limit=50`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) return [];
  const data = await res.json() as { notes: GranolaNote[] };
  return data.notes ?? [];
}

function buildNoteContent(note: Record<string, unknown>): string {
  const title = (note.title as string) || "Встреча";
  const parts: string[] = [`Встреча: ${title}`];

  const calEvent = note.calendar_event as Record<string, unknown> | undefined;
  if (calEvent?.scheduled_start_time) {
    const date = new Date(calEvent.scheduled_start_time as string).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    parts.push(`Дата: ${date}`);
  }

  const attendees = (note.attendees as Array<{ name?: string; email?: string }> | undefined) ?? [];
  if (attendees.length) {
    const names = attendees.map((a) => a.name || a.email || "").filter(Boolean).join(", ");
    parts.push(`Участники: ${names}`);
  }

  const summaryMd = (note.summary_markdown as string) || (note.summary_text as string) || "";
  if (summaryMd) parts.push(`Саммари:\n${summaryMd}`);

  type TranscriptEntry = { text?: string; speaker?: { source?: string; name?: string } };
  const transcript = note.transcript as TranscriptEntry[] | undefined;
  if (transcript?.length) {
    const lines = transcript
      .map((t) => {
        const speaker = t.speaker?.name || t.speaker?.source || "";
        return speaker ? `${speaker}: ${t.text ?? ""}` : (t.text ?? "");
      })
      .filter(Boolean)
      .join("\n");
    parts.push(`Стенограмма:\n${lines.slice(0, 8000)}`);
  }

  return parts.join("\n\n");
}

async function getProcessedIds(telegramId: number): Promise<Set<string>> {
  const [savedRes, integrationRes] = await Promise.all([
    supabase.from("entries").select("metadata").eq("source", "granola")
      .eq("metadata->>added_by_telegram_id", String(telegramId)),
    supabase.from("user_integrations").select("skipped_note_ids")
      .eq("telegram_id", telegramId).eq("service", "granola").maybeSingle(),
  ]);

  const saved = new Set<string>(
    (savedRes.data ?? [])
      .map((e: { metadata: Record<string, unknown> }) => e.metadata?.granola_note_id as string)
      .filter(Boolean)
  );

  const skipped: string[] = integrationRes.data?.skipped_note_ids ?? [];
  skipped.forEach((id) => saved.add(id));
  return saved;
}

async function markSkipped(telegramId: number, noteId: string): Promise<void> {
  const { data } = await supabase.from("user_integrations")
    .select("skipped_note_ids").eq("telegram_id", telegramId).eq("service", "granola").maybeSingle();
  const existing: string[] = data?.skipped_note_ids ?? [];
  if (existing.includes(noteId)) return;
  await supabase.from("user_integrations")
    .update({ skipped_note_ids: [...existing, noteId] })
    .eq("telegram_id", telegramId).eq("service", "granola");
}

async function saveGranolaNote(noteId: string, telegramId: number, username: string, chatId: number, isPrivate = false): Promise<void> {
  await sendMessage(chatId, "Сохраняю в базу знаний...");

  const apiKey = await getUserApiKey(telegramId);
  if (!apiKey) {
    await sendMessage(chatId, "Granola не подключена. Используй /connect granola <ключ>");
    return;
  }

  const note = await fetchGranolaNote(apiKey, noteId);
  if (!note) {
    await sendMessage(chatId, "Не удалось получить заметку из Granola.");
    return;
  }

  const title = (note.title as string) || "Встреча";
  const content = buildNoteContent(note);

  const [tezises, embedding] = await Promise.all([
    chatComplete(
      "Ты помощник команды. Создай структурированные тезисы встречи строго по тексту — " +
      "не домысливай и не добавляй информацию которой нет в тексте.\n" +
      "Формат: ### Тема\n- тезис\n- тезис\n\n" +
      "Темы называй широко: 'Персонал', 'IT / Технические проблемы', 'Поставки', 'Финансы / Эквайринг', " +
      "'Строительство', 'Маркетинг', 'Операции', 'Региональные новости' и т.п. " +
      "Только то что реально обсуждалось. Без выдумок.",
      content.slice(0, 12000)
    ),
    getEmbedding(content.slice(0, 8000)),
  ]);

  const calEvent = note.calendar_event as Record<string, unknown> | undefined;
  const entryDate = calEvent?.scheduled_start_time
    ? (calEvent.scheduled_start_time as string).split("T")[0]
    : null;

  const { error } = await supabase.from("entries").insert({
    content,
    summary: tezises,
    embedding,
    added_by: username,
    source: "granola",
    metadata: {
      granola_note_id: noteId,
      title,
      entry_date: entryDate,
      web_url: note.web_url,
      confirmed: false,
      added_by_telegram_id: telegramId,
    },
    is_private: isPrivate,
    owner_id: isPrivate ? telegramId : null,
  });

  if (error) {
    await sendMessage(chatId, `Ошибка сохранения: ${error.message}`);
    return;
  }

  const label = isPrivate ? "🔒 Встреча добавлена в личное хранилище" : "📥 Встреча добавлена";
  await sendMessage(chatId, `${label}: <b>${title}</b>\n\nПроверь тезисы через /meetings`);
}

async function sendNotesList(chatId: number, telegramId: number, createdAfter: string, periodLabel: string): Promise<void> {
  await sendMessage(chatId, `Загружаю заметки Granola (${periodLabel})...`);

  const apiKey = await getUserApiKey(telegramId);
  if (!apiKey) {
    await sendMessage(chatId, "Granola не подключена. Используй /connect granola <ключ>");
    return;
  }

  const [allNotes, processedIds] = await Promise.all([
    fetchNotesSince(apiKey, createdAfter),
    getProcessedIds(telegramId),
  ]);

  const notes = allNotes.filter((n) => !processedIds.has(n.id));
  if (!notes.length) {
    await sendMessage(chatId, `Все заметки за ${periodLabel} уже в базе или пропущены.`);
    return;
  }

  await sendMessage(chatId, `<b>📓 Granola — ${periodLabel}</b>\nНайдено: ${notes.length}. Выбери что добавить в базу:`);

  for (const note of notes) {
    const title = note.title || "Встреча";
    const ts = note.calendar_event?.scheduled_start_time ?? note.created_at;
    const date = new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const attendeeNames = (note.attendees ?? [])
      .map((a) => a.name || a.email || "").filter(Boolean).slice(0, 4).join(", ");

    const text = `📓 <b>${title}</b>\n📅 ${date}${attendeeNames ? `\n👥 ${attendeeNames}` : ""}`;
    await sendInlineMessage(chatId, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🔒 В личное", callback_data: `gcp_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
  }
}

export async function handleGranolaCommand(chatId: number, telegramId: number): Promise<void> {
  const apiKey = await getUserApiKey(telegramId);
  if (!apiKey) {
    await sendMessage(chatId,
      "📓 <b>Granola не подключена</b>\n\nЧтобы подключить — отправь:\n<code>/connect granola ВАШ_КЛЮЧ</code>\n\n" +
      "Ключ можно найти в настройках Granola → API."
    );
    return;
  }

  await sendInlineMessage(
    chatId,
    "📓 <b>Импорт из Granola</b>\n\nЗа какой период показать заметки?",
    [
      [{ text: "Сегодня", callback_data: "gran_today" }, { text: "7 дней", callback_data: "gran_7d" }],
      [{ text: "30 дней", callback_data: "gran_30d" }, { text: "Свой период", callback_data: "gran_custom" }],
    ]
  );
}

export async function handleGranolaCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
): Promise<boolean> {
  const data = cb.data;

  if (data === "gran_today") {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    await sendNotesList(chatId, userId, since.toISOString(), "сегодня");
    return true;
  }
  if (data === "gran_7d") {
    await sendNotesList(chatId, userId, new Date(Date.now() - 7 * 86_400_000).toISOString(), "последние 7 дней");
    return true;
  }
  if (data === "gran_30d") {
    await sendNotesList(chatId, userId, new Date(Date.now() - 30 * 86_400_000).toISOString(), "последние 30 дней");
    return true;
  }
  if (data === "gran_custom") {
    await setSession(chatId, "granola_custom_period");
    await sendMessage(chatId, "Введи дату начала периода (например: <i>1 мая 2026</i> или <i>2026-05-01</i>):");
    return true;
  }
  if (data.startsWith("gc_")) {
    await saveGranolaNote(data.replace("gc_", ""), userId, username, chatId);
    return true;
  }
  if (data.startsWith("gcp_")) {
    await saveGranolaNote(data.replace("gcp_", ""), userId, username, chatId, true);
    return true;
  }
  if (data.startsWith("gd_")) {
    await markSkipped(userId, data.replace("gd_", ""));
    await sendMessage(chatId, "🗑 Пропущено.");
    return true;
  }

  return false;
}

export async function handleGranolaSessionInput(
  chatId: number,
  telegramId: number,
  action: string,
  text: string,
): Promise<boolean> {
  if (action !== "granola_custom_period") return false;
  await clearSession(chatId);

  const today = new Date().toISOString().split("T")[0];
  const parsed = await chatComplete(
    `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Верни ТОЛЬКО дату, без пояснений. Если не можешь распознать — верни "null".`,
    text.trim()
  );

  const dateVal = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
  if (!dateVal) {
    await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз — /granola");
    return true;
  }

  const label = new Date(`${dateVal}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });
  await sendNotesList(chatId, telegramId, new Date(`${dateVal}T00:00:00.000Z`).toISOString(), `с ${label}`);
  return true;
}
