import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("READ_AI_WEBHOOK_SECRET") ?? "";
const ADMIN_CHAT_ID = 744230399;

async function verifySignature(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true;
  const signature = req.headers.get("x-readai-signature") ?? req.headers.get("x-hub-signature-256") ?? "";
  if (!signature) return true; // allow if no signature header (backwards compat)
  const keyData = Uint8Array.from(atob(WEBHOOK_SECRET), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(atob(signature.replace(/^sha256=/, "")), c => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(body));
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


async function sendTelegramInline(text: string, keyboard: Array<Array<{ text: string; callback_data: string }>>): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }),
  });
}

async function sendTelegram(text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
  return (data as { data: Array<{ embedding: number[] }> }).data[0].embedding;
}

async function chatComplete(system: string, user: string, json = false): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 2000,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "OpenAI error");
  return (data as { choices: Array<{ message: { content: string } }> }).choices[0].message.content;
}

async function extractAndSaveTasks(content: string, meetingId: string): Promise<number> {
  const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, markets, role");
  type ProfileRow = { first_name?: string; last_name?: string; markets?: string[]; role?: string };

  // Build canonical name map: any variant → canonical full name
  const canonicalNames = (profiles ?? []).map((p: ProfileRow) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    return name || null;
  }).filter(Boolean) as string[];

  const teamList = (profiles ?? []).map((p: ProfileRow) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const markets = p.markets?.length ? ` (рынки: ${p.markets.join(", ")})` : " (рынки: не указаны)";
    const role = p.role ? ` [${p.role}]` : "";
    return name ? `${name}${role}${markets}` : null;
  }).filter(Boolean).join("\n");

  const raw = await chatComplete(
    "Извлеки задачи из транскрипта встречи. Верни JSON:\n" +
    "{\"tasks\": [{\"title\": \"...\", \"assignee\": \"Полное имя или null\", \"due_date\": \"YYYY-MM-DD или null\", \"tags\": [\"страна\", \"тема\"]}]}\n\n" +
    "Список команды (имя [роль] рынки):\n" + (teamList || "неизвестна") + "\n\n" +
    "ПРАВИЛА назначения:\n" +
    "1. assignee — ОДИН человек, кто лично должен выполнить задачу\n" +
    "2. Участие в встрече НЕ означает ответственность за задачу\n" +
    "3. Если задача про страну/рынок — назначь того у кого эта страна в рынках\n" +
    "4. Если в тексте прямо сказано 'Имя, сделай X' — назначь это имя\n" +
    "5. Если ответственный неясен — assignee: null\n" +
    "6. Используй ТОЧНЫЕ имена из списка команды выше\n" +
    "tags — страны и темы задачи. Только JSON.",
    content,
    true
  );

  try {
    const parsed = JSON.parse(raw) as { tasks?: Array<{ title: string; assignee?: string | null; assignees?: string[]; due_date: string | null; tags: string[] }> };
    const tasks = parsed.tasks ?? [];

    // Resolve assignee string → canonical name from profiles
    const resolveAssignee = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      const lower = raw.toLowerCase();
      const match = canonicalNames.find(n =>
        n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase().split(" ").pop()!)
      );
      return match ?? null;
    };

    for (const task of tasks) {
      const assigneeRaw = task.assignee ?? (task.assignees?.[0] ?? null);
      const assignee = resolveAssignee(assigneeRaw);
      await supabase.from("tasks").insert({
        title: task.title,
        assignees: assignee ? [assignee] : [],
        due_date: task.due_date ?? null,
        tags: task.tags ?? [],
        meeting_id: meetingId,
        status: "pending",
      });
    }
    return tasks.length;
  } catch {
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  const body = await req.text();
  if (!await verifySignature(req, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    // Read.ai webhook payload is flat (no "meeting" wrapper):
    // { session_id, trigger, transcript, chapter_summaries, request_id, title, participants, ... }
    const meetingId = (payload.session_id ?? payload.id ?? crypto.randomUUID()) as string;
    const title = (payload.title ?? payload.meeting_title ?? "Встреча") as string;
    const startTime = payload.start_time as string | undefined;
    const endTime = payload.end_time as string | undefined;
    const duration = payload.duration as number | undefined ??
      (startTime && endTime ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000) * 60 : undefined);

    // Convert Read.ai transcript (array of speaker blocks) to readable text
    const toStr = (v: unknown): string => {
      if (!v) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const o = item as Record<string, unknown>;
          const speaker = (o.speaker ?? o.name ?? o.speaker_name ?? "") as string;
          // words can be array of {text} objects or plain string
          const wordsRaw = o.words ?? o.text ?? o.content ?? "";
          const text = Array.isArray(wordsRaw)
            ? (wordsRaw as Array<{ text?: string; word?: string }>).map(w => w.text ?? w.word ?? "").join(" ")
            : String(wordsRaw);
          return speaker ? `${speaker}: ${text}` : text;
        }
        return String(item);
      }).filter(Boolean).join("\n");
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    };

    // transcript is top-level in payload per Read.ai docs
    const transcript = toStr(payload.transcript ?? "");
    const chapters = (payload.chapter_summaries ?? payload.chapters ?? payload.topics ?? []) as Array<Record<string, unknown>>;
    const actionItems = (payload.action_items ?? payload.tasks ?? []) as Array<Record<string, unknown>>;
    const participants = (payload.participants ?? []) as Array<Record<string, unknown>>;
    const summary = toStr(payload.summary ?? payload.overview ?? "");

    // Build full content for knowledge base
    const parts: string[] = [`Встреча: ${title}`];
    if (summary) parts.push(`Сводка: ${summary}`);
    if (chapters.length) {
      parts.push(`Темы:\n${chapters.map((c) => `• ${c.title ?? c.topic ?? c.name ?? ""}`).join("\n")}`);
    }
    if (actionItems.length) {
      parts.push(`Задачи:\n${actionItems.map((a) => {
        const text = toStr(a.text ?? a.description ?? a.title ?? "");
        const owner = toStr(a.owner ?? a.assignee ?? "");
        const due = toStr(a.due_date ?? a.deadline ?? "");
        return `• ${text}${owner ? ` (${owner})` : ""}${due ? ` — до ${due}` : ""}`;
      }).join("\n")}`);
    }
    if (transcript) parts.push(`Стенограмма:\n${transcript.slice(0, 8000)}`);
    const fullContent = parts.join("\n\n");

    // Use transcript as primary source for tezises; fall back to summary+chapters if no transcript
    const tezisSource = transcript
      ? `Встреча: ${title}\n\nСтенограмма:\n${transcript.slice(0, 12000)}`
      : fullContent.slice(0, 6000);

    // Generate structured tezises + extract metadata + embedding + tasks in parallel
    const [tezises, embedding, taskCount] = await Promise.all([
      chatComplete(
        "Ты помощник команды. Создай структурированные тезисы встречи строго по тексту стенограммы — " +
        "не домысливай и не добавляй информацию которой нет в тексте.\n" +
        "Формат: ### Тема\n- тезис\n- тезис\n\n" +
        "Темы называй широко: 'Персонал', 'IT / Технические проблемы', 'Поставки', 'Финансы / Эквайринг', " +
        "'Строительство', 'Маркетинг', 'Операции', 'Региональные новости' и т.п. " +
        "Только то что реально обсуждалось. Без выдумок.",
        tezisSource
      ),
      getEmbedding(fullContent),
      extractAndSaveTasks(fullContent, meetingId),
    ]);

    // Extract meeting date for display
    const meetingDateStr = startTime
      ? new Date(startTime).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "неизвестна";
    const entryDateIso = startTime ? startTime.split("T")[0] : null;

    // Save to knowledge base with confirmed: false (awaiting user confirmation)
    const { data: savedEntry } = await supabase.from("entries").insert({
      content: fullContent,
      summary: tezises,
      embedding,
      added_by: "read_ai",
      source: "read_ai",
      metadata: { meeting_id: meetingId, title, duration, confirmed: false, entry_date: entryDateIso },
    }).select("id").single();

    const entryId = (savedEntry as { id: string } | null)?.id ?? meetingId;

    // Build confirmation notification
    const durationStr = duration ? ` · ${Math.round(duration / 60)} мин` : "";
    const participantsStr = participants
      .map((p) => (p.name ?? p.first_name ?? "") as string)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");

    let text = `📋 <b>Новая встреча получена</b>\n`;
    text += `<b>${title}</b>${durationStr}\n`;
    text += `📅 ${meetingDateStr}`;
    if (participantsStr) text += `\n👥 ${participantsStr}`;
    if (taskCount > 0) {
      const word = taskCount === 1 ? "задача" : taskCount < 5 ? "задачи" : "задач";
      text += `\n📌 ${taskCount} ${word} извлечено`;
    }
    text += `\n\nПроверьте и подтвердите:`;

    await sendTelegramInline(text, [
      [
        { text: "✅ Сохранить", callback_data: `mc_${entryId}` },
        { text: "✏️ Название", callback_data: `met_${entryId}` },
        { text: "📅 Дата", callback_data: `med_${entryId}` },
      ],
      [{ text: "🗑 Удалить", callback_data: `md_${entryId}` }],
    ]);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendTelegram(`⚠️ Ошибка обработки встречи: ${msg}`);
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});