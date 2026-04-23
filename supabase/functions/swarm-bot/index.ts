import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_USER_ID = 744230399;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TgMessage {
  chat: { id: number };
  from?: { id?: number; username?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
}

interface TgCallbackQuery {
  id: string;
  from: { id?: number; username?: string };
  message: { chat: { id: number }; message_id: number };
  data: string;
}

// ── Read.ai token management ──────────────────────────────────────────────────

const READ_AI_TOKEN_URL = "https://authn.read.ai/oauth2/token";
const READ_AI_API = "https://api.read.ai/v1";
const READ_AI_AUTH_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/read-ai-auth?start=1";

async function getReadAiToken(): Promise<string | null> {
  const { data } = await supabase.from("oauth_tokens").select("*").eq("service", "read_ai").maybeSingle();
  if (!data?.access_token) return null;

  if (new Date(data.expires_at) > new Date(Date.now() + 60_000)) return data.access_token;

  const res = await fetch(READ_AI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      client_id: data.client_id,
    }),
  });
  const tokenData = await res.json();
  if (!res.ok) return null;

  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 600) * 1000).toISOString();
  await supabase.from("oauth_tokens").update({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("service", "read_ai");

  return tokenData.access_token;
}

async function readAiGet(path: string): Promise<unknown> {
  const token = await getReadAiToken();
  if (!token) throw new Error("Read.ai не подключён. Используй /connect");
  const res = await fetch(`${READ_AI_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? "Read.ai API error");
  return data;
}

async function answerCallback(callbackId: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });
}

async function sendInlineMessage(chatId: number, text: string, keyboard: unknown[][]): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }),
  });
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

function buildKeyboard(admin: boolean) {
  const rows = [
    [{ text: "📝 Добавить" }, { text: "❓ Спросить" }],
    [{ text: "ℹ️ Помощь" }, { text: "📋 Задачи" }],
  ];
  if (admin) rows.push([{ text: "👥 Пользователи" }, { text: "🎙 Read.ai" }]);
  return { keyboard: rows, resize_keyboard: true, persistent: true };
}

async function sendMessage(
  chatId: number,
  text: string,
  reply_markup?: object
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup }),
  });
}

async function getTelegramFileUrl(fileId: string): Promise<string> {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("Не удалось получить файл от Telegram");
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

// ── OpenAI helpers ────────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "OpenAI embeddings error");
  return data.data[0].embedding;
}

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
  return data.choices[0].message.content;
}

async function transcribeAudio(fileId: string): Promise<string> {
  const fileUrl = await getTelegramFileUrl(fileId);
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Whisper error");
  return data.text;
}

async function describeImage(fileId: string): Promise<string> {
  const fileUrl = await getTelegramFileUrl(fileId);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Опиши подробно содержимое этого изображения на русском языке. Если есть текст — выпиши его полностью." },
          { type: "image_url", image_url: { url: fileUrl } },
        ],
      }],
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Vision error");
  return data.choices[0].message.content;
}

// ── URL fetching ──────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/i;

function extractUrl(text: string): string | null {
  return text.match(URL_REGEX)?.[0] ?? null;
}

async function fetchUrlContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SwarmBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/")) throw new Error("Ресурс не является текстовой страницей");

  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000);
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function saveEntry(content: string, addedBy: string, source: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const embedding = await getEmbedding(content);
  const { error } = await supabase.from("entries").insert({ content, embedding, added_by: addedBy, source, metadata });
  if (error) throw new Error(error.message);
}

// ── Session ───────────────────────────────────────────────────────────────────

async function getSession(chatId: number): Promise<string | null> {
  const { data } = await supabase.from("sessions").select("action").eq("chat_id", chatId).maybeSingle();
  return data?.action ?? null;
}

async function setSession(chatId: number, action: string): Promise<void> {
  await supabase.from("sessions").upsert({ chat_id: chatId, action });
}

async function clearSession(chatId: number): Promise<void> {
  await supabase.from("sessions").delete().eq("chat_id", chatId);
}

// ── Access control ────────────────────────────────────────────────────────────

function isSuperAdmin(userId: number): boolean {
  return userId === ADMIN_USER_ID;
}

async function isAdmin(userId: number): Promise<boolean> {
  if (isSuperAdmin(userId)) return true;
  const { data } = await supabase.from("allowed_users").select("is_admin").eq("telegram_id", userId).maybeSingle();
  return data?.is_admin === true;
}

async function checkAllowed(userId: number): Promise<boolean> {
  if (isSuperAdmin(userId)) return true;
  const { data } = await supabase.from("allowed_users").select("telegram_id").eq("telegram_id", userId).maybeSingle();
  return !!data;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleAdd(chatId: number, username: string, text: string): Promise<void> {
  if (!text.trim()) {
    await setSession(chatId, "waiting_add");
    await sendMessage(chatId, "Напиши текст, который нужно сохранить в базу знаний:");
    return;
  }
  await saveEntry(text, username, "telegram");
  await sendMessage(chatId, "Запись добавлена в базу знаний.");
}

const TASK_KEYWORDS = /задач|таск|task|сделать|выполнить|поручен|назначен|дедлайн|deadline|кто должен/i;

async function smartTaskSearch(chatId: number, question: string): Promise<boolean> {
  if (!TASK_KEYWORDS.test(question)) return false;

  // Extract person or tag from question via GPT
  const raw = await chatComplete(
    "Из вопроса извлеки фильтр для поиска задач. Верни JSON: {\"person\": \"Имя или null\", \"tag\": \"тег/страна или null\", \"period\": \"week/null\"}\nТолько JSON.",
    question
  );

  let person: string | null = null;
  let tag: string | null = null;
  let period: string | null = null;

  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim()) as { person?: string | null; tag?: string | null; period?: string | null };
    person = parsed.person && parsed.person !== "null" ? parsed.person : null;
    tag = parsed.tag && parsed.tag !== "null" ? parsed.tag : null;
    period = parsed.period && parsed.period !== "null" ? parsed.period : null;
  } catch { /* ignore */ }

  let query = supabase.from("tasks").select("*").not("status", "in", '("done","cancelled")').order("due_date");

  if (person) query = query.ilike("assignees", `%${person}%`);
  if (tag) query = query.ilike("tags", `%${tag}%`);
  if (period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data: tasks } = await query.limit(10);

  if (!tasks?.length) return false;

  const taskLines = tasks.map((t: { title: string; assignees: string[]; due_date: string | null; tags: string[]; status: string }) => {
    const assignees = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` · до ${t.due_date}` : "";
    const tags = t.tags?.length ? ` · ${t.tags.join(", ")}` : "";
    return `• ${t.title} (${assignees}${due}${tags})`;
  }).join("\n");

  await sendMessage(chatId, `<b>Задачи по запросу:</b>\n\n${taskLines}`);
  return true;
}

async function handleAsk(chatId: number, question: string): Promise<void> {
  if (!question.trim()) {
    await setSession(chatId, "waiting_ask");
    await sendMessage(chatId, "Напиши свой вопрос:");
    return;
  }

  // Check if question is about tasks
  const handledByTasks = await smartTaskSearch(chatId, question);
  if (handledByTasks) return;

  const embedding = await getEmbedding(question);
  const { data: entries, error } = await supabase.rpc("match_entries", {
    query_embedding: embedding,
    match_threshold: 0.4,
    match_count: 5,
  });

  if (error) { await sendMessage(chatId, `Ошибка поиска: ${error.message}`); return; }
  if (!entries?.length) { await sendMessage(chatId, "В базе знаний не найдено релевантной информации."); return; }

  const context = entries.map((e: { content: string }, i: number) => `[${i + 1}] ${e.content}`).join("\n\n");
  const answer = await chatComplete(
    "Ты помощник командной базы знаний. Отвечай строго на основе контекста. Если ответа нет — так и скажи. Отвечай на русском языке.",
    `Контекст:\n\n${context}\n\nВопрос: ${question}`
  );
  await sendMessage(chatId, answer);
}

async function handleVoice(chatId: number, username: string, fileId: string, duration: number): Promise<void> {
  await sendMessage(chatId, `Транскрибирую голосовое (${duration} сек)...`);
  const transcript = await transcribeAudio(fileId);
  await saveEntry(transcript, username, "voice");
  await sendMessage(chatId, `Транскрипция сохранена:\n\n<i>${transcript}</i>`);
}

async function handleDocument(chatId: number, username: string, doc: NonNullable<TgMessage["document"]>): Promise<void> {
  const mime = doc.mime_type ?? "";
  const name = doc.file_name ?? "файл";

  if (mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime)) {
    await sendMessage(chatId, `Читаю файл <b>${name}</b>...`);
    const fileUrl = await getTelegramFileUrl(doc.file_id);
    const res = await fetch(fileUrl);
    const text = await res.text();
    if (!text.trim()) { await sendMessage(chatId, "Файл пустой."); return; }
    await saveEntry(text.slice(0, 30000), username, "document", { file_name: name, mime });
    await sendMessage(chatId, `Файл <b>${name}</b> сохранён (${text.length} символов).`);
    return;
  }

  if (mime === "application/pdf") {
    await sendMessage(chatId, `Обрабатываю PDF <b>${name}</b>...`);
    const fileUrl = await getTelegramFileUrl(doc.file_id);
    const pdfRes = await fetch(fileUrl);
    const pdfBuffer = await pdfRes.arrayBuffer();

    // Extract readable text streams from PDF binary
    const raw = new TextDecoder("latin1").decode(pdfBuffer);
    const streams: string[] = [];
    const streamMatches = raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
    for (const m of streamMatches) {
      const chunk = m[1].replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ").trim();
      if (chunk.length > 20) streams.push(chunk);
    }

    // Also try to extract text from BT...ET blocks
    const btMatches = raw.matchAll(/BT([\s\S]*?)ET/g);
    const btTexts: string[] = [];
    for (const m of btMatches) {
      const tjMatches = m[1].matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const t of tjMatches) btTexts.push(t[1]);
    }

    const extracted = btTexts.length > 0
      ? btTexts.join(" ").trim()
      : streams.join("\n").trim();

    if (!extracted || extracted.length < 50) {
      // Fallback: ask GPT to describe what it can from metadata
      await sendMessage(chatId, "Не удалось извлечь текст из PDF (возможно, скан). Сохраняю как ссылку на файл. Вставь текст вручную через /add если нужна полная индексация.");
      return;
    }

    await saveEntry(extracted.slice(0, 30000), username, "pdf", { file_name: name });
    await sendMessage(chatId, `PDF <b>${name}</b> обработан и сохранён (${extracted.length} символов).`);
    return;
  }

  await sendMessage(chatId, `Формат <code>${mime || name}</code> пока не поддерживается.\n\nПоддерживаемые форматы: TXT, MD, CSV, JSON, PDF.`);
}

async function handlePhoto(chatId: number, username: string, photos: NonNullable<TgMessage["photo"]>): Promise<void> {
  await sendMessage(chatId, "Анализирую изображение...");
  const largest = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
  const description = await describeImage(largest.file_id);
  await saveEntry(description, username, "image");
  await sendMessage(chatId, `Изображение обработано и сохранено:\n\n<i>${description.slice(0, 500)}${description.length > 500 ? "..." : ""}</i>`);
}

async function handleUrl(chatId: number, username: string, url: string): Promise<void> {
  await sendMessage(chatId, `Загружаю страницу...`);
  const content = await fetchUrlContent(url);
  if (!content || content.length < 50) { await sendMessage(chatId, "Не удалось извлечь текст со страницы."); return; }
  await saveEntry(content, username, "url", { url });
  await sendMessage(chatId, `Страница сохранена (${content.length} символов):\n<code>${url}</code>`);
}

async function handleUsers(chatId: number, adminId: number, argText: string): Promise<void> {
  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const targetArg = parts[1];

  if (!sub || sub === "list") {
    const { data, error } = await supabase
      .from("allowed_users")
      .select("telegram_id, username, is_admin")
      .neq("telegram_id", ADMIN_USER_ID)
      .order("created_at");
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

    const ids = (data ?? []).map((u: { telegram_id: number }) => u.telegram_id);
    const { data: profiles } = await supabase.from("user_profiles").select("*").in("telegram_id", [ADMIN_USER_ID, ...ids]);
    const profileMap = Object.fromEntries((profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]));

    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null, is_admin: true, isSuperAdmin: true },
      ...(data ?? []).map((u: { telegram_id: number; username: string | null; is_admin: boolean }) => ({ ...u, isSuperAdmin: false })),
    ];

    const lines = allUsers.map((u) => {
      const p = profileMap[u.telegram_id];
      const fullName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
      const displayName = fullName || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
      const crown = u.isSuperAdmin || u.is_admin ? " 👑" : "";
      return `• ${displayName}${crown}`;
    });

    await sendInlineMessage(
      chatId,
      `<b>Пользователи (${allUsers.length}):</b>\n\n${lines.join("\n")}`,
      allUsers.map((u) => [{ text: u.isSuperAdmin || u.is_admin ? `👑 ${profileMap[u.telegram_id]?.first_name ?? `ID ${u.telegram_id}`}` : `👤 ${profileMap[u.telegram_id]?.first_name ?? `ID ${u.telegram_id}`}`, callback_data: `pu_${u.telegram_id}` }])
    );
    return;
  }

  if (sub === "add") {
    if (!targetArg || isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users add [telegram_id]"); return; }
    const { error } = await supabase.from("allowed_users").insert({ telegram_id: Number(targetArg), added_by: adminId });
    if (error) {
      await sendMessage(chatId, error.code === "23505" ? `Пользователь ${targetArg} уже в списке.` : `Ошибка: ${error.message}`);
      return;
    }
    await sendMessage(chatId, `Пользователь ${targetArg} добавлен.`);
    return;
  }

  if (sub === "remove") {
    if (!targetArg || isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users remove [telegram_id]"); return; }
    if (Number(targetArg) === ADMIN_USER_ID) { await sendMessage(chatId, "Нельзя удалить администратора."); return; }
    const { error, count } = await supabase.from("allowed_users").delete({ count: "exact" }).eq("telegram_id", Number(targetArg));
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    await sendMessage(chatId, count === 0 ? `Пользователь ${targetArg} не найден.` : `Пользователь ${targetArg} удалён.`);
    return;
  }

  if (sub === "promote") {
    if (!targetArg || isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users promote [telegram_id]"); return; }
    if (Number(targetArg) === ADMIN_USER_ID) { await sendMessage(chatId, "Суперадмин уже имеет все права."); return; }
    const { error } = await supabase.from("allowed_users").update({ is_admin: true }).eq("telegram_id", Number(targetArg));
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    await sendMessage(chatId, `Пользователь ${targetArg} назначен администратором 👑`);
    return;
  }

  if (sub === "demote") {
    if (!targetArg || isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users demote [telegram_id]"); return; }
    if (Number(targetArg) === ADMIN_USER_ID) { await sendMessage(chatId, "Нельзя снять права суперадмина."); return; }
    const { error } = await supabase.from("allowed_users").update({ is_admin: false }).eq("telegram_id", Number(targetArg));
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    await sendMessage(chatId, `Права администратора сняты с пользователя ${targetArg}.`);
    return;
  }

  if (sub === "profile") {
    await handleUsersProfile(chatId, targetArg ?? "");
    return;
  }

  await sendMessage(chatId, "Подкоманды: /users list · /users add [id] · /users remove [id] · /users promote [id] · /users demote [id] · /users profile [id]");
}

// ── Task management ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "🔲 Открыта",
  in_progress: "🔄 В работе",
  done: "✅ Готово",
  cancelled: "❌ Отменено",
};

type Task = {
  id: string;
  title: string;
  assignees: string[];
  due_date: string | null;
  tags: string[];
  status: string;
  created_at: string;
  meeting_id: string | null;
};

function buildTaskQuery(filter: string) {
  const f = filter.trim();

  if (f === "done") {
    return supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false });
  }
  if (f === "all") {
    return supabase.from("tasks").select("*").order("due_date", { ascending: true });
  }

  let q = supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled")')
    .order("due_date", { ascending: true });

  if (f.startsWith("@")) {
    q = q.ilike("assignees", `%${f.slice(1)}%`);
  } else if (f === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  } else if (f) {
    q = q.ilike("tags", `%${f}%`);
  }

  return q;
}

async function handleTasks(chatId: number, filter: string): Promise<void> {
  const sub = filter.trim().toLowerCase();

  if (sub === "export" || sub.startsWith("export ")) {
    await handleTasksExport(chatId, sub.replace("export", "").trim());
    return;
  }

  const { data: tasks, error } = await buildTaskQuery(filter).limit(15);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
  if (!tasks?.length) { await sendMessage(chatId, "Задач не найдено."); return; }

  const label = filter.trim() ? ` · ${filter.trim()}` : "";
  await sendMessage(chatId, `<b>Задачи${label}:</b> ${tasks.length} шт.`);

  for (const task of tasks as Task[]) {
    await sendTaskCard(chatId, task);
  }
}

async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const assignees = task.assignees?.length ? task.assignees.join(", ") : "—";
  const due = task.due_date ? `📅 ${task.due_date}` : "";
  const tags = task.tags?.length ? `🏷 ${task.tags.join(", ")}` : "";
  const status = STATUS_LABEL[task.status] ?? task.status;

  const text = [
    `${status} <b>${task.title}</b>`,
    `👤 ${assignees}`,
    [due, tags].filter(Boolean).join("  "),
  ].filter(Boolean).join("\n");

  const isActive = task.status !== "done" && task.status !== "cancelled";
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (isActive) {
    keyboard.push([
      { text: "🔄 В работе", callback_data: `ts_${task.id}_in_progress` },
      { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
      { text: "⏸ Отмена", callback_data: `ts_${task.id}_cancelled` },
    ]);
  }
  keyboard.push([{ text: "🗑 Удалить", callback_data: `td_${task.id}` }]);

  await sendInlineMessage(chatId, text, keyboard);
}

async function handleTasksExport(chatId: number, filter: string): Promise<void> {
  const { data: tasks, error } = await buildTaskQuery(filter || "").limit(100);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
  if (!tasks?.length) { await sendMessage(chatId, "Задач для экспорта не найдено."); return; }

  const lines = ["Задача\tИсполнители\tДедлайн\tТеги\tСтатус\tСоздана"];
  for (const t of tasks as Task[]) {
    lines.push([
      t.title,
      (t.assignees ?? []).join("; "),
      t.due_date ?? "",
      (t.tags ?? []).join("; "),
      t.status,
      t.created_at.slice(0, 10),
    ].join("\t"));
  }

  const csv = lines.join("\n");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/plain" }), `tasks_${new Date().toISOString().slice(0, 10)}.tsv`);
  form.append("caption", `Экспорт задач · ${tasks.length} шт.`);

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
}

async function handleTaskStatusChange(
  chatId: number,
  username: string,
  taskId: string,
  newStatus: string
): Promise<void> {
  const { data: task } = await supabase.from("tasks").select("title, status").eq("id", taskId).maybeSingle();
  if (!task) { await sendMessage(chatId, "Задача не найдена."); return; }

  await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", taskId);
  await supabase.from("task_history").insert({
    task_id: taskId,
    changed_by: username,
    old_status: task.status,
    new_status: newStatus,
  });

  await sendMessage(chatId, `${STATUS_LABEL[newStatus]} <b>${task.title}</b>`);
}

// ── User profiles ─────────────────────────────────────────────────────────────

const PROFILE_FIELDS: Record<string, string> = {
  first_name: "Имя",
  last_name:  "Фамилия",
  role:       "Роль",
  markets:    "Рынки (через запятую)",
  phone:      "Телефон",
  email:      "Email",
  notes:      "Заметки",
};

async function showProfile(chatId: number, targetId: number): Promise<void> {
  const { data: user } = await supabase
    .from("allowed_users").select("telegram_id, username, is_admin").eq("telegram_id", targetId).maybeSingle();
  if (!user) { await sendMessage(chatId, "Пользователь не найден."); return; }

  const { data: profile } = await supabase
    .from("user_profiles").select("*").eq("telegram_id", targetId).maybeSingle();

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "—";
  const markets = profile?.markets?.join(", ") || "—";

  const lines = [
    `<b>👤 ${name}</b>${user.is_admin ? " 👑" : ""}`,
    `🔖 @${user.username ?? "—"} (${targetId})`,
    `💼 ${profile?.role || "—"}`,
    `🌍 ${markets}`,
    `📞 ${profile?.phone || "—"}`,
    `📧 ${profile?.email || "—"}`,
    profile?.notes ? `📝 ${profile.notes}` : "",
  ].filter(Boolean).join("\n");

  const keyboard = Object.entries(PROFILE_FIELDS).map(([field, label]) => [
    { text: `✏️ ${label}`, callback_data: `pe_${targetId}_${field}` },
  ]);

  await sendInlineMessage(chatId, lines, keyboard);
}

async function handleUsersProfile(chatId: number, argText: string): Promise<void> {
  const targetArg = argText.trim();
  if (!targetArg || isNaN(Number(targetArg))) {
    await sendMessage(chatId, "Использование: /users profile [telegram_id]");
    return;
  }
  await showProfile(chatId, Number(targetArg));
}

async function handleProfileEdit(
  chatId: number,
  targetId: number,
  field: string,
  value: string
): Promise<void> {
  const label = PROFILE_FIELDS[field] ?? field;
  const updateData: Record<string, unknown> = {
    telegram_id: targetId,
    updated_at: new Date().toISOString(),
  };

  if (field === "markets") {
    updateData[field] = value.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    updateData[field] = value.trim();
  }

  await supabase.from("user_profiles").upsert(updateData);
  await sendMessage(chatId, `✅ ${label} обновлено.`);
  await showProfile(chatId, targetId);
}

async function handleConnect(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `Для подключения Read.ai открой ссылку в браузере и авторизуйся:\n\n<a href="${READ_AI_AUTH_URL}">${READ_AI_AUTH_URL}</a>\n\nПосле авторизации вернись в Telegram — бот готов к работе.`
  );
}

async function handleMeetings(chatId: number, hoursBack = 24): Promise<void> {
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

async function handleMeetingCallback(chatId: number, username: string, meetingId: string): Promise<void> {
  await sendMessage(chatId, "Обрабатываю встречу...");

  const meeting = await readAiGet(`/meetings/${meetingId}`) as Record<string, unknown>;

  const title = (meeting.title as string | undefined) ?? "Встреча";
  const summaryObj = meeting.summary as Record<string, unknown> | undefined;
  const summary = (summaryObj?.summary_text ?? summaryObj?.overview ?? "") as string;
  const transcript = (meeting.transcript ?? summaryObj?.transcript ?? "") as string;
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

  await saveEntry(contentParts, username, "read_ai", { meeting_id: meetingId, title });
  await sendMessage(chatId, `<b>📋 ${title}</b>\n\n${gptResult}`);
}

function getHelpText(admin: boolean): string {
  const base =
    "<b>Команды Swarm:</b>\n\n" +
    "/add [текст] — добавить запись\n" +
    "/ask [вопрос] — задать вопрос по базе знаний\n" +
    "/tasks — все открытые задачи\n" +
    "/tasks @Имя — задачи человека\n" +
    "/tasks Болгария — задачи по тегу/стране\n" +
    "/tasks week — задачи на этой неделе\n" +
    "/meetings — встречи из Read.ai\n" +
    "/help — справка\n\n" +
    "<b>Автоматически обрабатывается:</b>\n" +
    "🎤 Голосовые сообщения — транскрибация\n" +
    "📎 Файлы (TXT, MD, CSV, JSON, PDF) — извлечение текста\n" +
    "🖼 Фото — описание через ИИ\n" +
    "🔗 Ссылки — загрузка содержимого страницы";

  return admin
    ? base + "\n\n<b>Управление пользователями:</b>\n/users list · /users add [id] · /users remove [id]\n\n<b>Read.ai:</b>\n/connect — подключить Read.ai\n/meetings — встречи за 24 часа"
    : base;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let update: { message?: TgMessage; callback_query?: TgCallbackQuery };
  try { update = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  // ── Callback query (inline button press) ────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from.id ?? 0;
    const username = cb.from.username ?? String(userId);
    const chatId = cb.message.chat.id;

    await answerCallback(cb.id);

    if (!(await checkAllowed(userId))) return new Response("OK", { status: 200 });

    try {
      if (cb.data.startsWith("meeting_")) {
        await handleMeetingCallback(chatId, username, cb.data.replace("meeting_", ""));
      } else if (cb.data.startsWith("ts_")) {
        const parts = cb.data.split("_");
        const taskId = parts[1];
        const newStatus = parts.slice(2).join("_");
        await handleTaskStatusChange(chatId, username, taskId, newStatus);
      } else if (cb.data.startsWith("md_")) {
        const parts = cb.data.replace("md_", "").split("_");
        const entryId = parts[0];
        const meetingId = parts[1] || null;

        const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
        const title = (entry?.metadata?.title as string) ?? "Встреча";

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
      } else if (cb.data.startsWith("mr_")) {
        const entryId = cb.data.replace("mr_", "");
        const { data: entry } = await supabase.from("entries").select("content, metadata, created_at").eq("id", entryId).maybeSingle();
        if (!entry) { await sendMessage(chatId, "Встреча не найдена."); return; }

        const title = (entry.metadata?.title as string) ?? "Встреча";
        const meetingId = entry.metadata?.meeting_id as string | undefined;
        const date = new Date(entry.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

        // Get related tasks
        let tasksText = "";
        if (meetingId) {
          const { data: tasks } = await supabase.from("tasks").select("title, assignees, due_date, status").eq("meeting_id", meetingId);
          if (tasks?.length) {
            tasksText = "\n\n<b>✅ Задачи:</b>\n" + tasks.map((t: { title: string; assignees: string[]; due_date: string | null; status: string }) => {
              const who = t.assignees?.join(", ");
              const due = t.due_date ? ` · до ${t.due_date}` : "";
              const done = t.status === "done" ? " ✓" : "";
              return `• ${t.title}${who ? ` (${who})` : ""}${due}${done}`;
            }).join("\n");
          }
        }

        // Extract summary section from content (first part before transcript)
        const contentPreview = entry.content.split("Стенограмма:")[0].trim().slice(0, 2000);

        await sendInlineMessage(
          chatId,
          `<b>📋 ${title}</b>\n<i>${date}</i>\n\n${contentPreview}${tasksText}`,
          [[{ text: "🗑 Удалить встречу и все задачи", callback_data: `md_${entryId}_${meetingId ?? ""}` }]]
        );
      } else if (cb.data.startsWith("pu_")) {
        const targetId = Number(cb.data.replace("pu_", ""));
        await showProfile(chatId, targetId);
      } else if (cb.data.startsWith("pe_")) {
        // Profile edit: pe_{targetId}_{field}
        const parts = cb.data.split("_");
        const targetId = Number(parts[1]);
        const field = parts.slice(2).join("_");
        const label = PROFILE_FIELDS[field] ?? field;
        await setSession(chatId, `profile_${targetId}_${field}`);
        await sendMessage(chatId, `Введи новое значение для <b>${label}</b>:`);
      } else if (cb.data.startsWith("td_")) {
        const taskId = cb.data.replace("td_", "");
        const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
        await supabase.from("task_history").delete().eq("task_id", taskId);
        await supabase.from("tasks").delete().eq("id", taskId);
        await sendMessage(chatId, `🗑 Удалено: <b>${task?.title ?? taskId}</b>`);
      }
    } catch (err) {
      await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new Response("OK", { status: 200 });
  }

  const message = update.message;
  if (!message) return new Response("OK", { status: 200 });

  const chatId = message.chat.id;
  const userId = message.from?.id ?? 0;
  const username = message.from?.username ?? String(userId);

  const allowed = await checkAllowed(userId);
  if (!allowed) {
    await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
    return new Response("OK", { status: 200 });
  }

  const admin = await isAdmin(userId);

  try {
    // ── Voice / audio ─────────────────────────────────────────────────────────
    if (message.voice) {
      await handleVoice(chatId, username, message.voice.file_id, message.voice.duration);
      return new Response("OK", { status: 200 });
    }

    if (message.audio) {
      await handleVoice(chatId, username, message.audio.file_id, 0);
      return new Response("OK", { status: 200 });
    }

    // ── Document ──────────────────────────────────────────────────────────────
    if (message.document) {
      await handleDocument(chatId, username, message.document);
      return new Response("OK", { status: 200 });
    }

    // ── Photo ─────────────────────────────────────────────────────────────────
    if (message.photo?.length) {
      await handlePhoto(chatId, username, message.photo);
      return new Response("OK", { status: 200 });
    }

    // ── Text ──────────────────────────────────────────────────────────────────
    const text = message.text?.trim();
    if (!text) return new Response("OK", { status: 200 });

    const BUTTON_LABELS = new Set(["📝 Добавить", "❓ Спросить", "ℹ️ Помощь", "👥 Пользователи", "📋 Задачи", "🎙 Read.ai"]);
    const isButtonPress = BUTTON_LABELS.has(text);
    const isCommand = text.startsWith("/") || isButtonPress;

    if (!isCommand) {
      // Check if it's a URL
      const url = extractUrl(text);
      if (url && text.length < 300) {
        await handleUrl(chatId, username, url);
        return new Response("OK", { status: 200 });
      }

      // Check pending session
      const session = await getSession(chatId);
      if (session === "waiting_add") {
        await clearSession(chatId);
        await saveEntry(text, username, "telegram");
        await sendMessage(chatId, "Запись добавлена в базу знаний.");
      } else if (session === "waiting_ask") {
        await clearSession(chatId);
        await handleAsk(chatId, text);
      } else if (session?.startsWith("profile_")) {
        await clearSession(chatId);
        const parts = session.split("_");
        const targetId = Number(parts[1]);
        const field = parts.slice(2).join("_");
        await handleProfileEdit(chatId, targetId, field, text);
      } else {
        await sendMessage(chatId, "Используй /add или /ask для работы с базой знаний.");
      }
      return new Response("OK", { status: 200 });
    }

    // Commands
    const [command, ...rest] = text.split(/\s+/);
    const argText = isButtonPress ? "" : rest.join(" ");
    await clearSession(chatId);

    if (command === "/start") {
      await sendMessage(chatId, "<b>Добро пожаловать в Swarm!</b>\n\nКомандная база знаний с семантическим поиском.\n\n" + getHelpText(admin), buildKeyboard(admin));
    } else if (command === "/help" || text === "ℹ️ Помощь") {
      await sendMessage(chatId, getHelpText(admin), buildKeyboard(admin));
    } else if (command === "/add" || text === "📝 Добавить") {
      await handleAdd(chatId, username, argText);
    } else if (command === "/ask" || text === "❓ Спросить") {
      await handleAsk(chatId, argText.trim() ? argText : "");
    } else if (command === "/users" || text === "👥 Пользователи") {
      if (!admin) { await sendMessage(chatId, "Эта команда доступна только администратору."); }
      else { await handleUsers(chatId, userId, argText); }
    } else if (command === "/tasks" || text === "📋 Задачи") {
      await handleTasks(chatId, argText);
    } else if (text === "🎙 Read.ai" || command === "/readai") {
      const { data: meetings } = await supabase
        .from("entries")
        .select("id, metadata, created_at")
        .eq("source", "read_ai")
        .order("created_at", { ascending: false })
        .limit(10);

      if (!meetings?.length) {
        await sendMessage(chatId, "Встреч пока нет. Они появятся автоматически после завершения созвона в Read.ai.");
      } else {
        await sendMessage(chatId, `<b>🎙 Встречи из Read.ai:</b>`);
        for (const m of meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string }>) {
          const title = (m.metadata?.title as string) ?? "Встреча";
          const date = new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          const duration = m.metadata?.duration ? ` · ${Math.round((m.metadata.duration as number) / 60)} мин` : "";
          await sendInlineMessage(
            chatId,
            `📋 <b>${title}</b>\n${date}${duration}`,
            [[{ text: "🔍 Подробнее", callback_data: `mr_${m.id}` }]]
          );
        }
      }
    } else if (command === "/connect") {
      if (!admin) { await sendMessage(chatId, "Эта команда доступна только администратору."); }
      else { await handleConnect(chatId); }
    } else if (command === "/meetings") {
      if (!admin) { await sendMessage(chatId, "Эта команда доступна только администратору."); }
      else { await handleMeetings(chatId, argText ? parseInt(argText) || 24 : 24); }
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
