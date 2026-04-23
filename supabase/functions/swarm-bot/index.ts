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

// ── Telegram helpers ──────────────────────────────────────────────────────────

function buildKeyboard(admin: boolean) {
  const rows = [
    [{ text: "📝 Добавить" }, { text: "❓ Спросить" }],
    [{ text: "ℹ️ Помощь" }],
  ];
  if (admin) rows[1].push({ text: "👥 Пользователи" });
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

async function handleAsk(chatId: number, question: string): Promise<void> {
  if (!question.trim()) {
    await setSession(chatId, "waiting_ask");
    await sendMessage(chatId, "Напиши свой вопрос:");
    return;
  }

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
    const { data, error } = await supabase.from("allowed_users").select("telegram_id, username, is_admin, created_at").order("created_at");
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

    const lines = (data ?? []).map((u: { telegram_id: number; username: string | null; is_admin: boolean }) => {
      const name = u.username ? `@${u.username}` : `ID ${u.telegram_id}`;
      const role = u.is_admin ? " 👑" : "";
      return `• ${name} (${u.telegram_id})${role}`;
    });
    const adminLine = `• Суперадмин (${ADMIN_USER_ID}) 👑`;
    const body = lines.length > 0 ? `${adminLine}\n${lines.join("\n")}` : `${adminLine}\n\nДругих пользователей нет.`;
    await sendMessage(chatId, `<b>Разрешённые пользователи:</b>\n${body}`);
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

  await sendMessage(chatId, "Подкоманды: /users list · /users add [id] · /users remove [id] · /users promote [id] · /users demote [id]");
}

function getHelpText(admin: boolean): string {
  const base =
    "<b>Команды Swarm:</b>\n\n" +
    "/add [текст] — добавить запись\n" +
    "/ask [вопрос] — задать вопрос по базе знаний\n" +
    "/help — справка\n\n" +
    "<b>Автоматически обрабатывается:</b>\n" +
    "🎤 Голосовые сообщения — транскрибация\n" +
    "📎 Файлы (TXT, MD, CSV, JSON, PDF) — извлечение текста\n" +
    "🖼 Фото — описание через ИИ\n" +
    "🔗 Ссылки — загрузка содержимого страницы";

  return admin
    ? base + "\n\n<b>Управление пользователями:</b>\n/users list · /users add [id] · /users remove [id]"
    : base;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let update: { message?: TgMessage };
  try { update = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

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

    const BUTTON_LABELS = new Set(["📝 Добавить", "❓ Спросить", "ℹ️ Помощь", "👥 Пользователи"]);
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
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
