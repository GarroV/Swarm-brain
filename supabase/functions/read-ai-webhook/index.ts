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

interface ExtractedTask {
  title: string;
  assignees: string[];
  due_date: string | null;
  tags: string[];
}

async function extractTasks(content: string, meetingId: string): Promise<ExtractedTask[]> {
  const raw = await chatComplete(
    "Извлеки задачи из данных встречи. Верни JSON:\n" +
    "{\"tasks\": [{\"title\": \"...\", \"assignees\": [\"Имя\"], \"due_date\": \"YYYY-MM-DD или null\", \"tags\": [\"страна\", \"тема\"]}]}\n\n" +
    "assignees — конкретные имена людей (пусто если не указан).\n" +
    "tags — страны, команды, проекты упомянутые в контексте задачи.\n" +
    "due_date — только если явно указана дата, иначе null.\n" +
    "Только JSON.",
    content,
    true
  );

  try {
    const parsed = JSON.parse(raw) as { tasks?: ExtractedTask[] };
    const extracted = parsed.tasks ?? [];

    for (const task of extracted) {
      await supabase.from("tasks").insert({
        title: task.title,
        assignees: task.assignees ?? [],
        due_date: task.due_date ?? null,
        tags: task.tags ?? [],
        meeting_id: meetingId,
        created_by: "read_ai",
        status: "open",
      });
    }

    return extracted;
  } catch {
    return [];
  }
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
    const meeting = (payload.meeting ?? payload) as Record<string, unknown>;
    const title = (meeting.title ?? "Встреча") as string;
    const summary = (meeting.summary ?? meeting.overview ?? "") as string;
    const transcript = (meeting.transcript ?? meeting.transcription ?? "") as string;
    const chapters = (meeting.chapters ?? meeting.topics ?? []) as Array<Record<string, unknown>>;
    const actionItems = (meeting.action_items ?? meeting.tasks ?? []) as Array<Record<string, unknown>>;
    const keyQuestions = (meeting.key_questions ?? []) as Array<Record<string, unknown>>;
    const meetingId = (meeting.id ?? meeting.meeting_id ?? crypto.randomUUID()) as string;
    const duration = meeting.duration as number | undefined;

    // Build full content for knowledge base
    const parts: string[] = [`Встреча: ${title}`];
    if (summary) parts.push(`Сводка: ${summary}`);
    if (chapters.length) {
      parts.push(`Темы:\n${chapters.map((c) => `• ${c.title ?? c.topic ?? c.name ?? ""}`).join("\n")}`);
    }
    if (actionItems.length) {
      parts.push(`Задачи:\n${actionItems.map((a) => {
        const text = (a.text ?? a.description ?? a.title ?? "") as string;
        const owner = (a.owner ?? a.assignee ?? "") as string;
        const due = (a.due_date ?? a.deadline ?? "") as string;
        return `• ${text}${owner ? ` (${owner})` : ""}${due ? ` — до ${due}` : ""}`;
      }).join("\n")}`);
    }
    if (keyQuestions.length) {
      parts.push(`Ключевые вопросы:\n${keyQuestions.map((q) => `• ${q.text ?? q.question ?? ""}`).join("\n")}`);
    }
    if (transcript) parts.push(`Стенограмма:\n${transcript.slice(0, 8000)}`);

    const fullContent = parts.join("\n\n");

    // Run GPT summary + task extraction in parallel
    const [gptSummary, savedTasks] = await Promise.all([
      chatComplete(
        "Сформируй итог встречи:\n1. 🔑 Ключевые тезисы (3-7 пунктов)\n2. ✅ Задачи с ответственными и дедлайнами\nОтвечай на русском. Будь конкретным.",
        fullContent
      ),
      extractTasks(fullContent, meetingId),
    ]);

    // Save to knowledge base
    const embedding = await getEmbedding(fullContent);
    await supabase.from("entries").insert({
      content: fullContent,
      embedding,
      added_by: "read_ai",
      source: "read_ai",
      metadata: { meeting_id: meetingId, title, duration },
    });

    // Build Telegram notification
    const durationStr = duration ? ` · ${Math.round(duration / 60)} мин` : "";
    let message = `<b>📋 ${title}${durationStr}</b>\n\n${gptSummary}`;

    if (savedTasks.length) {
      message += `\n\n<i>Добавлено ${savedTasks.length} задач в /tasks</i>`;
    }
    message += "\n\n<i>Сохранено в базу знаний.</i>";

    await sendTelegram(message);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendTelegram(`⚠️ Ошибка обработки встречи из Read.ai: ${msg}`);
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
