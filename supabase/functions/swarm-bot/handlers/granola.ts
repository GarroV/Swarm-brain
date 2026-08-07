import { supabase } from "../lib/supabase.ts";
import { chatComplete, getEmbedding } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession, getSession, extractEntryMeta } from "../lib/storage.ts";
import { applyGeneralSentinel, specificCountries } from "../../_shared/meta-extract.ts";
import { getUserGroupId } from "../lib/workspace.ts";
import { TEZISY_PROMPT } from "../../_shared/tezisy-prompt.ts";
import { findDuplicateMeeting, parseMeetingContent, type MeetingAttendee } from "../../_shared/meeting-dedup.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const GRANOLA_API = "https://public-api.granola.ai/v1";
const WEB_URL = "https://swarm-brain.pages.dev";

// Единый промпт тезисов — общий канон из _shared/tezisy-prompt.ts (DRY с рекордером/read-ai),
// чтобы тезисы выглядели одинаково независимо от точки входа.
const GRANOLA_TEZISY_PROMPT = TEZISY_PROMPT;

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
  const [savedRes, pendingRes, integrationRes] = await Promise.all([
    // Опубликованные (legacy pending + опубликованные) в entries — по granola_note_id.
    supabase.from("entries").select("metadata").eq("source", "granola")
      .eq("metadata->>added_by_telegram_id", String(telegramId)),
    // Pending в приёмной meetings (новый путь): identity_key = "granola:<note_id>".
    supabase.from("meetings").select("identity_key").eq("source", "granola"),
    supabase.from("user_integrations").select("skipped_note_ids")
      .eq("telegram_id", telegramId).eq("service", "granola").maybeSingle(),
  ]);

  const saved = new Set<string>(
    (savedRes.data ?? [])
      .map((e: { metadata: Record<string, unknown> }) => e.metadata?.granola_note_id as string)
      .filter(Boolean)
  );

  for (const m of (pendingRes.data ?? []) as Array<{ identity_key?: string }>) {
    const key = m.identity_key ?? "";
    if (key.startsWith("granola:")) saved.add(key.slice("granola:".length));
  }

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

type GranolaPreviewCache = { content: string; title: string; tezises: string };

async function offerNextGranolaNote(chatId: number, telegramId: number): Promise<void> {
  const apiKey = await getUserApiKey(telegramId);
  if (!apiKey) return;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [allNotes, processedIds] = await Promise.all([
    fetchNotesSince(apiKey, since),
    getProcessedIds(telegramId),
  ]);

  const remaining = allNotes.filter((n) => !processedIds.has(n.id));
  if (!remaining.length) return;

  const note = remaining[0];
  const title = note.title || "Встреча";
  const ts = note.calendar_event?.scheduled_start_time ?? note.created_at;
  const date = new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const attendeeNames = (note.attendees ?? [])
    .map((a) => a.name || a.email || "").filter(Boolean).slice(0, 4).join(", ");

  const counter = remaining.length > 1 ? ` · ещё ${remaining.length - 1}` : "";
  const text = `➡️ Следующая встреча${counter}:\n📓 <b>${title}</b>\n📅 ${date}${attendeeNames ? `\n👥 ${attendeeNames}` : ""}`;
  await sendInlineMessage(chatId, text, [[
    { text: "🔍 Тезисы", callback_data: `gp_${note.id}` },
    { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
  ]]);
}

type PreparedGranolaEntry = {
  title: string;
  content: string;
  tezises: string;
  entryDate: string | null;
  /** Время начала "HH:MM" (из строки "Дата: …, HH:MM" в контенте) — для дедупа. */
  startTime: string | null;
  /** Участники встречи (из строки "Участники: …") — для дедупа. */
  attendees: MeetingAttendee[];
  countries: string[];
  embedding: number[];
};

// Собирает поля записи из заметки Granola (контент → тезисы → страны → эмбеддинг).
// Возвращает null, если заметку не удалось получить. Общий код для ручного сохранения
// (saveGranolaNote, confirmed:true) и авто-импорта (ingest, confirmed:false).
async function prepareGranolaEntry(
  noteId: string,
  telegramId: number,
  cached?: GranolaPreviewCache,
): Promise<PreparedGranolaEntry | null> {
  let title: string;
  let content: string;

  if (cached) {
    title = cached.title;
    content = cached.content;
  } else {
    const apiKey = await getUserApiKey(telegramId);
    if (!apiKey) return null;

    const note = await fetchGranolaNote(apiKey, noteId);
    if (!note) return null;

    title = (note.title as string) || "Встреча";
    content = buildNoteContent(note);
  }

  // Тезисы (если нет кэша) и метаданные — два независимых LLM-вызова, считаем параллельно.
  // Последовательно они упирали авто-импорт в idle-timeout функции (150с).
  const [tezises, entryMeta] = await Promise.all([
    cached
      ? Promise.resolve(cached.tezises)
      : chatComplete(GRANOLA_TEZISY_PROMPT, content.slice(0, 12000)),
    extractEntryMeta(content.slice(0, 4000)),
  ]);

  // Extract entry_date from content (content always has it in "Дата: ..." line)
  const entryDateMatch = content.match(/Дата: .*?(\d{2}\.\d{2}\.\d{4})/);
  let entryDate: string | null = null;
  if (entryDateMatch) {
    const [dd, mm, yyyy] = entryDateMatch[1].split(".");
    entryDate = `${yyyy}-${mm}-${dd}`;
  }

  // Время начала + участники для дедупа — парсим из того же контента ("Дата: …, HH:MM" + "Участники: …").
  const timeMatch = content.match(/Дата:[^\n]*?(\d{1,2}:\d{2})/);
  const startTime = timeMatch ? timeMatch[1] : null;
  const attendees: MeetingAttendee[] = parseMeetingContent(content).attendees.map((name) => ({ name }));

  // Единый санитайзер (порог 2+, схлоп в РОВНО ["General"], без микса [A,B,General]) —
  // общий applyGeneralSentinel, как в storage/read-ai. Раньше здесь была инлайн-копия со
  // старым порогом >=3 и countries.push("General") → granola хранила миксы и двойные теги.
  const countries = applyGeneralSentinel(entryMeta.countries);
  const specific = specificCountries(countries);

  // Embed tezisy + countries (not raw 10k content) — same strategy as saveEntry
  const embeddingText = [
    tezises ?? "",
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
  ].filter(Boolean).join("\n").slice(0, 8000);
  const embedding = await getEmbedding(embeddingText || content.slice(0, 8000));

  return { title, content, tezises, entryDate, startTime, attendees, countries, embedding };
}

async function saveGranolaNote(
  noteId: string,
  telegramId: number,
  username: string,
  chatId: number,
  isPrivate = false,
  cached?: GranolaPreviewCache,
): Promise<boolean> {
  const groupId = await getUserGroupId(telegramId);
  if (!groupId) {
    await sendMessage(chatId, "Ошибка: пользователь не привязан к воркспейсу.");
    return false;
  }
  await sendMessage(chatId, "Импортирую встречу…");

  const prepared = await prepareGranolaEntry(noteId, telegramId, cached);
  if (!prepared) {
    await sendMessage(chatId, "Не удалось получить заметку из Granola.");
    return false;
  }
  const { title, tezises, entryDate, startTime, attendees } = prepared;
  void username; void isPrivate; // приватность решается при публикации; в вычитку все — единообразно

  // Эта встреча уже опубликована в базе (другой участник / рекордер / повторно)? Не дублируем.
  const dup = await findDuplicateMeeting(supabase, { groupId, entryDate, startedAt: startTime, attendees });
  if (dup) {
    await markSkipped(telegramId, noteId);
    await sendMessage(chatId, `Эта встреча уже в базе: <b>${dup.title}</b> — повторно не импортирую.`);
    return false;
  }

  // Ручная выгрузка «не жди бота» — импорт СЕЙЧАС в общую приёмную (очередь вычитки), не сразу
  // в базу: единый флоу для всех источников. started_at собираем из даты+времени тезисов.
  const nowIso = new Date().toISOString();
  const startedIso = entryDate ? `${entryDate}T${startTime ?? "00:00"}:00` : null;
  const { error } = await supabase.from("meetings").insert({
    source: "granola",
    identity_kind: "external",
    identity_key: `granola:${noteId}`,
    title,
    started_at: startedIso,
    attendees,
    group_id: groupId,
    draft_notes_md: tezises,
    status: "awaiting_review",
    recorders: [{ telegram_id: telegramId, claimed_at: nowIso, role: "transcribe" }],
  });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      await markSkipped(telegramId, noteId);
      await sendMessage(chatId, `Уже в очереди вычитки: <b>${title}</b>.`);
      return true;
    }
    await sendMessage(chatId, `Ошибка импорта: ${error.message}`);
    return false;
  }

  await sendMessage(chatId, `✅ В очереди вычитки: <b>${title}</b>\nОткрой <a href="${WEB_URL}">Swarm Brain</a> → Встречи → «на вычитке», проверь и опубликуй.`);
  return true;
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
      { text: "🔍 Тезисы", callback_data: `gp_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
  }
}

export async function pollGranolaForUser(chatId: number, telegramId: number): Promise<number> {
  const { data: integration } = await supabase
    .from("user_integrations")
    .select("api_key, last_polled_at, skipped_note_ids")
    .eq("telegram_id", telegramId)
    .eq("service", "granola")
    .maybeSingle();
  if (!integration?.api_key) return 0;

  // Always look back 48h — deduplication via savedIds/skippedIds prevents re-showing processed notes
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const notes = await fetchNotesSince(integration.api_key, since);
  if (!notes.length) return 0;

  const [savedRes] = await Promise.all([
    supabase.from("entries").select("metadata").eq("source", "granola")
      .eq("metadata->>added_by_telegram_id", String(telegramId)),
  ]);
  const savedIds = new Set<string>(
    (savedRes.data ?? [])
      .map((e: { metadata: Record<string, unknown> }) => e.metadata?.granola_note_id as string)
      .filter(Boolean)
  );
  const skippedIds = new Set<string>(integration.skipped_note_ids ?? []);
  const newNotes = notes.filter((n) => !savedIds.has(n.id) && !skippedIds.has(n.id));

  if (newNotes.length) {
    await sendMessage(chatId, `📓 <b>Новые встречи Granola (${newNotes.length})</b>\nНайдены встречи, которых ещё нет в базе:`);
    for (const note of newNotes) {
      const title = note.title || "Встреча";
      const ts = note.calendar_event?.scheduled_start_time ?? note.created_at;
      const date = new Date(ts).toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const attendeeNames = (note.attendees ?? [])
        .map((a) => a.name || a.email || "").filter(Boolean).slice(0, 4).join(", ");
      const text = `📓 <b>${title}</b>\n📅 ${date}${attendeeNames ? `\n👥 ${attendeeNames}` : ""}`;
      await sendInlineMessage(chatId, text, [[
        { text: "🔍 Тезисы", callback_data: `gp_${note.id}` },
        { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
      ]]);
    }
  }

  // Update cursor so the hourly poller doesn't re-send the same notifications
  await supabase.from("user_integrations")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("telegram_id", telegramId).eq("service", "granola");

  return newNotes.length;
}

// Сколько новых заметок импортировать за один прогон на пользователя. Каждая = LLM-тезисы +
// извлечение метаданных + эмбеддинг (~12-15с даже с распараллеливанием), а у функции idle-timeout
// 150с — поэтому держим запас. Остаток подхватится на следующем часу (дедуп по granola_note_id).
const MAX_GRANOLA_INGEST_PER_USER = 6;

// Авто-импорт новых заметок Granola как черновиков «на согласовании» (confirmed:false).
// Зеркало вебхука Read.ai: создаёт запись entry + шлёт те же кнопки ревью (mc_/met_/med_/md_),
// поэтому встреча сразу видна И в Telegram, И в вебе («на согласовании»). Дедуп — через
// getProcessedIds (уже сохранённые granola_note_id + skipped). Окно — фиксированные 48ч
// (как pollGranolaForUser): дедуп защищает от повторов, а сбойную вставку подхватит след. прогон.
async function ingestNewGranolaNotesForUser(integration: {
  telegram_id: number;
  api_key: string;
}): Promise<number> {
  const groupId = await getUserGroupId(integration.telegram_id);
  if (!groupId) return 0; // пользователь не привязан к воркспейсу — пропускаем

  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const notes = await fetchNotesSince(integration.api_key, since);
  if (!notes.length) return 0;

  const processedIds = await getProcessedIds(integration.telegram_id);
  const newNotes = notes
    .filter((n) => !processedIds.has(n.id))
    .slice(0, MAX_GRANOLA_INGEST_PER_USER);

  let created = 0;
  for (const note of newNotes) {
    const prepared = await prepareGranolaEntry(note.id, integration.telegram_id);
    if (!prepared) continue;
    const { title, tezises, entryDate, startTime, attendees } = prepared;

    // Кросс-источниковый дедуп: эта встреча уже опубликована в базе (другой участник / рекордер)?
    // Если да — не плодим черновик, помечаем заметку обработанной.
    const dup = await findDuplicateMeeting(supabase, {
      groupId, entryDate, startedAt: startTime, attendees,
    });
    if (dup) {
      console.log("granola ingest skip duplicate", integration.telegram_id, note.id, "→", dup.id, `(${dup.source})`);
      await markSkipped(integration.telegram_id, note.id);
      continue;
    }

    // Единая приёмная meetings (как рекордер), НЕ entries. Тезисы готовы из Granola →
    // draft_notes_md, транскрибация не нужна. Импортёр в recorders → увидит встречу в своей
    // очереди вычитки (agent-meetings own-scoped). Публикация — общий POST /agent-meetings/:id/publish.
    const nowIso = new Date().toISOString();
    const startedIso = note.calendar_event?.scheduled_start_time ?? note.created_at ?? null;
    const meetingAttendees: MeetingAttendee[] = (note.attendees ?? []).map((a) => ({ name: a.name, email: a.email }));

    const { data: inserted, error } = await supabase.from("meetings").insert({
      source: "granola",
      identity_kind: "external",
      identity_key: `granola:${note.id}`,
      title,
      started_at: startedIso,
      attendees: meetingAttendees,
      group_id: groupId,
      draft_notes_md: tezises,
      status: "awaiting_review",
      recorders: [{ telegram_id: integration.telegram_id, claimed_at: nowIso, role: "transcribe" }],
    }).select("id").single();
    if (error || !inserted) {
      // Повторный импорт того же note (unique identity_key) → 23505: помечаем обработанным.
      if ((error as { code?: string } | null)?.code === "23505") {
        await markSkipped(integration.telegram_id, note.id);
        continue;
      }
      console.error("granola ingest insert error", integration.telegram_id, note.id, error?.message);
      continue;
    }
    created++;

    const ts = note.calendar_event?.scheduled_start_time ?? note.created_at;
    const date = new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const attendeeNames = (note.attendees ?? [])
      .map((a) => a.name || a.email || "").filter(Boolean).slice(0, 4).join(", ");
    let text = `📓 <b>Новая встреча Granola</b>\n<b>${title}</b>\n📅 ${date}`;
    if (attendeeNames) text += `\n👥 ${attendeeNames}`;
    text += `\n\nДобавлена в очередь вычитки. Открой <a href="${WEB_URL}">Swarm Brain</a> → Встречи → «на вычитке», проверь тезисы и опубликуй.`;
    await sendMessage(integration.telegram_id, text);
  }

  return created;
}

// Часовой крон (cron → swarm-bot { granola_poll:true }): импортирует новые заметки Granola
// у всех подключённых пользователей. Заменяет standalone-функцию granola-poller, которая
// только слала уведомление в Telegram и ничего не клала в БД.
export async function ingestNewGranolaNotesAllUsers(): Promise<number> {
  const { data: integrations } = await supabase
    .from("user_integrations")
    .select("telegram_id, api_key")
    .eq("service", "granola");
  if (!integrations?.length) return 0;

  let total = 0;
  for (const integration of integrations as Array<{ telegram_id: number; api_key: string }>) {
    try {
      total += await ingestNewGranolaNotesForUser(integration);
    } catch (err) {
      console.error("granola ingest error", integration.telegram_id, err);
    }
    // Курсор двигаем для информативности; на корректность дедупа он не влияет (окно фикс. 48ч).
    await supabase.from("user_integrations")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("telegram_id", integration.telegram_id).eq("service", "granola");
  }
  return total;
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
  if (data.startsWith("gp_")) {
    const noteId = data.replace("gp_", "");
    await sendMessage(chatId, "Загружаю тезисы...");

    const apiKey = await getUserApiKey(userId);
    if (!apiKey) { await sendMessage(chatId, "Granola не подключена."); return true; }

    const note = await fetchGranolaNote(apiKey, noteId);
    if (!note) { await sendMessage(chatId, "Не удалось загрузить заметку из Granola."); return true; }

    const title = (note.title as string) || "Встреча";
    const content = buildNoteContent(note);
    const tezises = await chatComplete(GRANOLA_TEZISY_PROMPT, content.slice(0, 12000));

    await setSession(chatId, `granola_preview_${noteId}`, JSON.stringify({ content, title, tezises }));

    await sendMessage(chatId, `📓 <b>${title}</b>\n\n${tezises}`);
    await sendInlineMessage(chatId, "Сохранить в базу знаний?", [
      [
        { text: "✅ В базу", callback_data: `gc_${noteId}` },
        { text: "🔒 В личное", callback_data: `gcp_${noteId}` },
      ],
      [
        { text: "✏️ Переписать", callback_data: `gedit_${noteId}` },
        { text: "🗑 Пропустить", callback_data: `gd_${noteId}` },
      ],
    ]);
    return true;
  }
  if (data.startsWith("gedit_")) {
    const noteId = data.replace("gedit_", "");
    const session = await getSession(chatId);
    if (!session?.action.startsWith("granola_preview_")) {
      await sendMessage(chatId, "Данные встречи истекли. Открой заново через /granola");
      return true;
    }
    await setSession(chatId, `granola_edit_preview_${noteId}`, session.context);
    await sendMessage(
      chatId,
      "Напиши инструкцию: что изменить в тезисах.\n\n" +
      "<i>Например: «убери раздел Финансы», «сделай тезисы короче», «добавь задачу на Васю»</i>"
    );
    return true;
  }
  if (data.startsWith("gc_")) {
    const noteId = data.replace("gc_", "");
    const session = await getSession(chatId);
    let cached: GranolaPreviewCache | undefined;
    if (session?.action === `granola_preview_${noteId}` && session.context) {
      cached = JSON.parse(session.context) as GranolaPreviewCache;
      await clearSession(chatId);
    }
    const saved = await saveGranolaNote(noteId, userId, username, chatId, false, cached);
    if (saved) await offerNextGranolaNote(chatId, userId);
    return true;
  }
  if (data.startsWith("gcp_")) {
    const noteId = data.replace("gcp_", "");
    const session = await getSession(chatId);
    let cached: GranolaPreviewCache | undefined;
    if (session?.action === `granola_preview_${noteId}` && session.context) {
      cached = JSON.parse(session.context) as GranolaPreviewCache;
      await clearSession(chatId);
    }
    const saved = await saveGranolaNote(noteId, userId, username, chatId, true, cached);
    if (saved) await offerNextGranolaNote(chatId, userId);
    return true;
  }
  if (data.startsWith("gd_")) {
    await markSkipped(userId, data.replace("gd_", ""));
    await clearSession(chatId);
    await sendMessage(chatId, "🗑 Пропущено.");
    await offerNextGranolaNote(chatId, userId);
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
  if (action.startsWith("granola_edit_preview_")) {
    const noteId = action.replace("granola_edit_preview_", "");
    const session = await getSession(chatId);
    if (!session?.context) {
      await clearSession(chatId);
      await sendMessage(chatId, "Данные встречи истекли. Открой заново через /granola");
      return true;
    }

    const cached = JSON.parse(session.context) as GranolaPreviewCache;
    await sendMessage(chatId, "Обновляю...");

    const raw = await chatComplete(
      "Ты помощник команды. Измени тезисы и/или название встречи согласно инструкции пользователя.\n" +
      "Не домысливай — только то что есть в исходном тексте или в текущих данных.\n" +
      "Верни ТОЛЬКО JSON без markdown: {\"title\": \"новое название или null если не менять\", \"tezises\": \"новые тезисы\"}\n" +
      "Тезисы — в формате: ### Тема\n- тезис\n- тезис\n\n" +
      `Инструкция: ${text.trim()}\n\n` +
      `Текущее название: ${cached.title}\n` +
      `Текущие тезисы:\n${cached.tezises}`,
      cached.content.slice(0, 6000)
    );

    let newTitle = cached.title;
    let newTezises = cached.tezises;
    try {
      const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim()) as { title?: string | null; tezises?: string };
      if (parsed.title) newTitle = parsed.title;
      if (parsed.tezises) newTezises = parsed.tezises;
    } catch {
      newTezises = raw;
    }

    const updatedCache: GranolaPreviewCache = { ...cached, title: newTitle, tezises: newTezises };
    await setSession(chatId, `granola_preview_${noteId}`, JSON.stringify(updatedCache));

    await sendMessage(chatId, `📓 <b>${newTitle}</b>\n\n${newTezises}`);
    await sendInlineMessage(chatId, "Сохранить в базу знаний?", [
      [
        { text: "✅ В базу", callback_data: `gc_${noteId}` },
        { text: "🔒 В личное", callback_data: `gcp_${noteId}` },
      ],
      [
        { text: "✏️ Переписать", callback_data: `gedit_${noteId}` },
        { text: "🗑 Пропустить", callback_data: `gd_${noteId}` },
      ],
    ]);
    return true;
  }

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
