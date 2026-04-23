import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_CHAT_ID = 744230399;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
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

async function saveEntry(content: string, metadata: Record<string, unknown>): Promise<void> {
  const embedding = await getEmbedding(content);
  await supabase.from("entries").insert({
    content,
    embedding,
    added_by: "read_ai",
    source: "read_ai",
    metadata,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    // Extract meeting data from Read.ai webhook payload
    const meeting = (payload.meeting ?? payload) as Record<string, unknown>;
    const title = (meeting.title ?? "Встреча") as string;
    const summary = (meeting.summary ?? meeting.overview ?? "") as string;
    const transcript = (meeting.transcript ?? meeting.transcription ?? "") as string;
    const chapters = (meeting.chapters ?? meeting.topics ?? []) as Array<Record<string, unknown>>;
    const actionItems = (meeting.action_items ?? meeting.tasks ?? []) as Array<Record<string, unknown>>;
    const keyQuestions = (meeting.key_questions ?? []) as Array<Record<string, unknown>>;
    const meetingId = (meeting.id ?? meeting.meeting_id ?? "") as string;
    const duration = meeting.duration as number | undefined;

    // Build full content for storage
    const parts: string[] = [`Встреча: ${title}`];

    if (summary) parts.push(`Сводка: ${summary}`);

    if (chapters.length) {
      const chaptersText = chapters
        .map((c) => `• ${c.title ?? c.topic ?? c.name ?? JSON.stringify(c)}`)
        .join("\n");
      parts.push(`Главы/темы:\n${chaptersText}`);
    }

    if (actionItems.length) {
      const tasksText = actionItems
        .map((a) => {
          const text = (a.text ?? a.description ?? a.title ?? JSON.stringify(a)) as string;
          const owner = a.owner ?? a.assignee ?? a.assigned_to;
          const due = a.due_date ?? a.deadline;
          return `• ${text}${owner ? ` (${owner})` : ""}${due ? ` — до ${due}` : ""}`;
        })
        .join("\n");
      parts.push(`Задачи:\n${tasksText}`);
    }

    if (keyQuestions.length) {
      const questionsText = keyQuestions
        .map((q) => `• ${q.text ?? q.question ?? JSON.stringify(q)}`)
        .join("\n");
      parts.push(`Ключевые вопросы:\n${questionsText}`);
    }

    if (transcript) parts.push(`Стенограмма:\n${transcript.slice(0, 8000)}`);

    const fullContent = parts.join("\n\n");

    // Generate structured summary via GPT
    const gptSummary = await chatComplete(
      "Ты помощник для обработки встреч. На основе данных встречи сформируй итог:\n" +
      "1. 🔑 Ключевые тезисы (3-7 пунктов)\n" +
      "2. ✅ Задачи с ответственными и дедлайнами (если есть)\n" +
      "Если тезисы или задачи уже есть в данных — используй их, не придумывай новые.\n" +
      "Отвечай на русском языке. Будь конкретным и кратким.",
      fullContent
    );

    // Save to knowledge base
    await saveEntry(fullContent, {
      meeting_id: meetingId,
      title,
      duration,
      source: "read_ai_webhook",
    });

    // Notify admin in Telegram
    const durationStr = duration ? ` · ${Math.round(duration / 60)} мин` : "";
    await sendTelegram(
      `<b>📋 ${title}${durationStr}</b>\n\n${gptSummary}\n\n<i>Сохранено в базу знаний.</i>`
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendTelegram(`⚠️ Ошибка обработки встречи из Read.ai: ${msg}`);
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
