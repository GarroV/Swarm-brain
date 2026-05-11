import { supabase } from "../lib/supabase.ts";
import { getEmbedding } from "../lib/openai.ts";
import { saveEntry, generateSummary, getSession, setSession, clearSession } from "../lib/storage.ts";
import { sendMessage } from "../lib/telegram.ts";
import type { KbEntry } from "../lib/types.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const KNOWLEDGE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "Semantic search of the knowledge base. Use for any question about stored content. Include Russian and English terms in query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — include both Russian and English variants of key terms" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "export_entry",
      description: "Export the full raw content of an entry as a downloadable file. Use when user asks to 'скинь файлом', 'выгрузи', 'скачать транскрипцию', 'export', 'пришли исходник', 'полный текст', 'дословно'. Also call this when search results contain [Полный текст: export_entry(id=...)]. First use search_knowledge to find the entry id, then call export_entry with that id.",
      parameters: {
        type: "object",
        properties: {
          entry_id: { type: "string", description: "Entry id from search results (the id: prefix value)" },
        },
        required: ["entry_id"],
      },
    },
  },
];

/* === DISABLED: extra knowledge tools (search_by_country, get_countries_list, get_digest, get_entries_by_country, get_recent_meetings, list_meetings_by_country, update_entry) — kept for future re-enable === */
export const KNOWLEDGE_TOOLS_DISABLED = [
  {
    type: "function" as const,
    function: {
      name: "search_by_country",
      description: "Find knowledge base entries for a specific country or market. Use when a specific country is mentioned.",
      parameters: {
        type: "object",
        properties: {
          country: { type: "string", description: "Country name in English: Serbia, Bulgaria, Croatia, Montenegro, Moldova, Hungary, Romania, Estonia, Slovenia, Cyprus, Belarus, Russia, Spain, etc." },
          wants_full_text: { type: "boolean", description: "true = return raw text; false = return summaries" },
        },
        required: ["country"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_countries_list",
      description: "Get list of all countries/markets in the knowledge base with entry counts. Use for 'which countries', 'what markets', 'по каким странам есть данные'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_digest",
      description: "Get overview of the most recent knowledge base entries grouped by type. Use for 'что нового', 'общий обзор', 'что есть в базе', 'а еще что'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_entries_by_country",
      description: "Get the latest entry for each country as a country-by-country news feed. Use for 'новости по странам', 'последнее по рынкам', 'дай данные по всем странам'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_meetings",
      description: "Get recent meetings sorted by date. Use for: 'что последнее', 'последние встречи', 'что приходило от рид аи', 'последнее от read.ai', 'новые встречи'. Can filter by source (read_ai, voice, telegram) or leave empty for all.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Filter by source: 'read_ai', 'voice', 'telegram', or empty for all" },
          limit: { type: "number", description: "Number of results, default 10" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_meetings_by_country",
      description: "Get compact list of meetings (title + date + id) for a country. Use when user asks 'какие встречи были', 'список встреч', 'покажи встречи по X' — do NOT return summaries, just names and dates.",
      parameters: {
        type: "object",
        properties: {
          country: { type: "string", description: "Country in English: Serbia, Croatia, Bulgaria, etc. Empty string = all countries." },
        },
        required: ["country"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_entry",
      description: "Update metadata of a knowledge base entry. Use when user asks to fix/change a date, title, year, or tags of a specific entry. First search to find the entry id, then call this to update it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Entry id from search results" },
          entry_date: { type: "string", description: "New date in YYYY-MM-DD format, e.g. 2026-04-29" },
          title: { type: "string", description: "New title for the entry (stored in metadata.title)" },
          countries: { type: "array", items: { type: "string" }, description: "New countries list e.g. ['Serbia', 'Montenegro']" },
        },
        required: ["id"],
      },
    },
  },
];
/* === END DISABLED === */
void KNOWLEDGE_TOOLS_DISABLED;

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {

      case "search_knowledge": {
        const query = String(args.query ?? "");

        const embPromise = getEmbedding(query)
          .then(emb => supabase.rpc("match_entries", {
            query_embedding: `[${emb.join(",")}]`,
            match_threshold: 0.1,
            match_count: 8,
          }).then(r => (r.data ?? []) as KbEntry[]))
          .catch(() => [] as KbEntry[]);

        const words = query.toLowerCase().split(/[\s,.!?]+/).filter(w => w.length > 2).slice(0, 6);
        const kwPromise = words.length
          ? supabase.from("entries").select("id, content, summary, source")
              .or(words.map(w => `source.ilike.%${w}%,content.ilike.%${w}%,summary.ilike.%${w}%`).join(","))
              .limit(5).then(r => (r.data ?? []) as KbEntry[]).catch(() => [] as KbEntry[])
          : Promise.resolve([] as KbEntry[]);

        const [vec, kw] = await Promise.all([embPromise, kwPromise]);
        const seen = new Set<string>();
        const combined: KbEntry[] = [];
        for (const e of [...vec, ...kw]) {
          if (e?.id && !seen.has(e.id)) { seen.add(e.id); combined.push(e); }
        }
        if (!combined.length) return "Ничего не найдено по запросу.";
        return combined.slice(0, 5).map((e: KbEntry) => {
          const isShort = (e.content ?? "").length <= 500;
          const text = isShort
            ? (e.content ?? "")
            : (e.summary || (e.content ?? "").slice(0, 500)) +
              `\n[Полный текст: export_entry(id=${e.id})]`;
          return `[id:${e.id}] ${e.source ?? ""}:\n${text}`;
        }).join("\n\n") || "Ничего не найдено.";
      }

      case "search_by_country": {
        const country = String(args.country ?? "");
        const wantsFullText = Boolean(args.wants_full_text ?? false);

        // Primary: semantic vector search — works regardless of how country is stored in DB
        let entries: KbEntry[] = [];
        try {
          const emb = await getEmbedding(country);
          const { data: vecData } = await supabase.rpc("match_entries", {
            query_embedding: `[${emb.join(",")}]`,
            match_threshold: 0.1,
            match_count: 8,
          });
          entries = (vecData ?? []) as KbEntry[];
        } catch { /* fall through */ }

        // Fallback: fuzzy array match via RPC
        if (!entries.length) {
          const { data: fuzzy } = await supabase.rpc("search_entries_by_country", { country_query: country }).catch(() => ({ data: null }));
          entries = (fuzzy ?? []) as KbEntry[];
        }

        // Fallback: exact contains
        if (!entries.length) {
          const { data: exact } = await supabase.from("entries").select("id, content, summary, source")
            .contains("countries", [country]).order("created_at", { ascending: false }).limit(5);
          entries = (exact ?? []) as KbEntry[];
        }

        if (!entries.length) return `Нет записей по стране ${country}.`;
        return entries.slice(0, 5).map((e, i) => {
          const text = wantsFullText
            ? (e.content ?? "").slice(0, 3000)
            : (e.summary || (e.content ?? "").slice(0, 1500));
          return `[${i + 1}] id:${e.id} source:${e.source ?? ""}\n${text}`;
        }).join("\n\n---\n\n");
      }

      case "get_countries_list": {
        const { data } = await supabase.from("entries").select("countries").not("countries", "eq", "{}");
        const count: Record<string, number> = {};
        for (const r of (data ?? []) as Array<{ countries: string[] }>) {
          for (const c of (r.countries ?? [])) { count[c] = (count[c] ?? 0) + 1; } // r is typed above
        }
        if (!Object.keys(count).length) return "В базе нет записей с указанием страны.";
        return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}: ${n} записей`).join("\n");
      }

      case "get_digest": {
        const { data } = await supabase.from("entries")
          .select("entry_type, source, summary, countries, entry_date, created_at")
          .order("created_at", { ascending: false }).limit(30);
        if (!data?.length) return "База знаний пустая.";
        type DRow = { entry_type?: string; source: string; summary?: string; countries?: string[]; entry_date?: string; created_at: string };
        const byType: Record<string, DRow[]> = {};
        for (const r of data as DRow[]) { const t = r.entry_type ?? "note"; byType[t] = byType[t] ?? []; byType[t].push(r); }
        return Object.entries(byType).map(([type, items]) => {
          const lines = items.slice(0, 3).map(r => {
            const date = r.entry_date ?? r.created_at.slice(0, 10);
            const ctrs = r.countries?.length ? ` [${r.countries.join(", ")}]` : "";
            return `• ${date}${ctrs}: ${(r.summary ?? r.source ?? "").slice(0, 120)}`;
          }).join("\n");
          return `${type} (${items.length}):\n${lines}`;
        }).join("\n\n");
      }

      case "get_entries_by_country": {
        const { data } = await supabase.from("entries")
          .select("countries, source, summary, entry_date, created_at")
          .not("countries", "eq", "{}").order("created_at", { ascending: false }).limit(100);
        if (!data?.length) return "Нет записей с указанием стран.";
        type GRow = { countries: string[]; source: string; summary?: string; entry_date?: string; created_at: string };
        const byCountry: Record<string, GRow> = {};
        for (const r of data as GRow[]) {
          for (const c of (r.countries ?? [])) { if (!byCountry[c]) byCountry[c] = r; }
        }
        return Object.entries(byCountry).sort((a, b) => a[0].localeCompare(b[0])).map(([c, r]) => {
          const date = r.entry_date ?? r.created_at.slice(0, 10);
          return `${c} (${date}): ${(r.summary ?? r.source ?? "").slice(0, 120)}`;
        }).join("\n");
      }

      case "get_recent_meetings": {
        const source = String(args.source ?? "").trim();
        const limit = Math.min(Number(args.limit ?? 10), 20);
        let q = supabase.from("entries")
          .select("id, metadata, entry_date, created_at, source, content, summary, entry_type")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (source) {
          // Explicit source filter (e.g. "read_ai", "voice", "granola")
          q = q.eq("source", source);
        } else {
          // Default: all meeting/transcript entries regardless of source tool
          // Catches both old entries (source=read_ai/voice) and new ones from any tool
          q = q.or("source.in.(read_ai,voice),entry_type.in.(transcript,meeting)");
        }
        const { data } = await q;
        if (!data?.length) return "Записей не найдено.";
        type RRow = { id: string; metadata?: Record<string, unknown>; entry_date?: string; created_at: string; source?: string; entry_type?: string; content?: string; summary?: string };
        return (data as RRow[]).map((e, i) => {
          const title = String(e.metadata?.title ?? e.content?.split("\n")[0].slice(0, 70) ?? "Запись");
          const date = e.entry_date ?? e.created_at?.slice(0, 10) ?? "?";
          const preview = (e.summary ?? e.content ?? "").slice(0, 120);
          return `${i + 1}. [${date}] ${title} (${e.entry_type ?? e.source}) — id:${e.id}\n   ${preview}`;
        }).join("\n\n");
      }

      case "list_meetings_by_country": {
        const country = String(args.country ?? "").toLowerCase();
        const { data } = await supabase
          .from("entries")
          .select("id, metadata, entry_date, created_at, countries, content")
          .order("entry_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(50);
        if (!data?.length) return "Встреч не найдено.";
        type MRow = { id: string; metadata?: Record<string, unknown>; entry_date?: string; created_at: string; countries?: string[]; content?: string };
        const filtered = country
          ? (data as MRow[]).filter(e =>
              (e.countries ?? []).some((c: string) => c.toLowerCase().includes(country) || country.includes(c.toLowerCase())) ||
              (e.content ?? "").toLowerCase().includes(country) ||
              String(e.metadata?.title ?? "").toLowerCase().includes(country)
            )
          : (data as MRow[]);
        if (!filtered.length) return `Встреч по ${country} не найдено.`;
        return filtered.slice(0, 15).map((e, i) => {
          const title = String(e.metadata?.title ?? e.content?.split("\n")[0].slice(0, 70) ?? "Встреча");
          const date = e.entry_date ?? e.created_at?.slice(0, 10) ?? "?";
          return `${i + 1}. [${date}] ${title} — id:${e.id}`;
        }).join("\n");
      }

      case "update_entry": {
        const id = String(args.id ?? "");
        if (!id) return "Укажи id записи.";
        const { data: existing } = await supabase.from("entries").select("metadata, countries, entry_date").eq("id", id).maybeSingle();
        if (!existing) return `Запись ${id} не найдена.`;
        const updates: Record<string, unknown> = {};
        if (args.entry_date) updates.entry_date = String(args.entry_date);
        if (args.title) updates.metadata = { ...(existing.metadata ?? {}), title: String(args.title) };
        if (args.countries) updates.countries = args.countries;
        if (!Object.keys(updates).length) return "Нечего обновлять — передай хотя бы одно поле.";
        const { error } = await supabase.from("entries").update(updates).eq("id", id);
        if (error) return `Ошибка обновления: ${error.message}`;
        const changed = Object.keys(updates).join(", ");
        return `✅ Запись обновлена (${changed}).`;
      }

      default: return "Неизвестный инструмент.";
    }
  } catch (err) {
    return `Ошибка: ${err instanceof Error ? err.message : "unknown"}`;
  }
}

export async function handleAdd(chatId: number, username: string, text: string): Promise<void> {
  if (!text.trim()) {
    await setSession(chatId, "waiting_add");
    await sendMessage(chatId, "Напиши текст, который нужно сохранить в базу знаний:");
    return;
  }
  const summary = await generateSummary(text);
  const entryId = await saveEntry(text, username, "telegram", {}, summary ?? undefined);
  await sendMessage(chatId, summary
    ? `✅ Сохранено.\n\n<b>Тезисы:</b>\n${summary}`
    : "✅ Запись добавлена в базу знаний.");
  // DISABLED: await analyzeAndCreateTasks(text, chatId, entryId);
}

const TASK_KEYWORDS = /задач|таск|task|сделать|выполнить|поручен|назначен|дедлайн|deadline|кто должен/i;

type Task = { title: string; assignees: string[]; due_date: string | null; tags: string[]; status: string };

async function smartTaskSearch(chatId: number, question: string): Promise<boolean> {
  if (!TASK_KEYWORDS.test(question)) return false;

  // Extract person or tag from question via GPT
  const raw = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Из вопроса извлеки фильтр для поиска задач. Верни JSON: {\"person\": \"Имя или null\", \"tag\": \"тег/страна или null\", \"period\": \"week/null\"}\nТолько JSON." },
        { role: "user", content: question },
      ],
      max_tokens: 200,
    }),
  }).then(r => r.json() as Promise<{ choices: Array<{ message: { content: string } }> }>)
    .then(d => d.choices[0]?.message?.content ?? "{}");

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

  if (period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data: allTasks } = await query.limit(100);
  let tasks = (allTasks ?? []) as Task[];
  if (person) {
    const pl = person.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(pl)));
  }
  if (tag) {
    const tl = tag.toLowerCase();
    tasks = tasks.filter(t => t.tags?.some(tg => tg.toLowerCase().includes(tl)));
  }
  tasks = tasks.slice(0, 10);

  if (!tasks.length) return false;

  const taskLines = tasks.map((t: Task) => {
    const assignees = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` · до ${t.due_date}` : "";
    const tags = t.tags?.length ? ` · ${t.tags.join(", ")}` : "";
    return `• ${t.title} (${assignees}${due}${tags})`;
  }).join("\n");

  await sendMessage(chatId, `<b>Задачи по запросу:</b>\n\n${taskLines}`);
  return true;
}

export async function handleAsk(chatId: number, question: string): Promise<void> {
  if (!question.trim()) {
    await setSession(chatId, "waiting_ask");
    await sendMessage(chatId, "Напиши свой вопрос:");
    return;
  }

  // Task queries go to the dedicated task system
  if (TASK_KEYWORDS.test(question)) {
    const handled = await smartTaskSearch(chatId, question);
    if (handled) return;
  }

  // Load previous answer for referential follow-ups ("эту встречу", "её", etc.)
  const prevSession = await getSession(chatId);
  const prevAnswer = prevSession?.action === "last_answer" ? (prevSession.context ?? null) : null;

  const searchPhrases = [
    "🧠 Коллективный разум в работе..",
    "🐝 47 пчёл-аналитиков в работе..",
    "🍯 Улей проснулся..",
    "📡 Улей получил запрос..",
    "🌀 Рой сканирует архивы..",
    "⚡ Жужжание усиливается..",
  ];
  await sendMessage(chatId, searchPhrases[Math.floor(Math.random() * searchPhrases.length)]);

  const messages: Record<string, unknown>[] = [
    {
      role: "system",
      content:
        "Ты помощник командной базы знаний команды. " +
        "Используй инструменты чтобы найти или изменить информацию в базе. " +
        "Если пользователь говорит 'эту', 'её', 'этот' — он имеет в виду запись из предыдущего ответа. " +
        "Если результат поиска содержит [Полный текст: export_entry(id=...)] и пользователь " +
        "просит исходник, полный текст или дословно — вызови export_entry с этим id. " +
        "Не выдавай длинный текст в сообщении — отправляй файлом через export_entry. " +
        "Если пользователь просит скинуть файлом, выгрузить, скачать транскрипцию или исходник — " +
        "сначала найди запись через search_knowledge (получи её id), " +
        "затем вызови export_entry с этим id. " +
        "Отвечай ТОЛЬКО на основе данных из инструментов — не придумывай информацию. " +
        "Если данных нет — честно скажи. Отвечай на русском языке.",
    },
    ...(prevAnswer ? [{ role: "assistant" as const, content: prevAnswer }] : []),
    { role: "user", content: question },
  ];

  let finalAnswer = "";
  let exportFile: { content: string; filename: string } | null = null;

  for (let round = 0; round < 6; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools: KNOWLEDGE_TOOLS,
        tool_choice: round === 0 ? "required" : "auto",
        max_tokens: 2000,
      }),
    });

    if (!res.ok) { finalAnswer = "Ошибка при обращении к AI. Попробуй ещё раз."; break; }

    const data = await res.json() as {
      choices: Array<{ finish_reason: string; message: Record<string, unknown> }>;
    };

    const choice = data.choices[0];
    const msg = choice.message;
    const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;

    if (choice.finish_reason === "stop" || !toolCalls?.length) {
      finalAnswer = String(msg.content ?? "В базе знаний нет информации по этому вопросу.");
      break;
    }

    messages.push(msg);

    for (const tc of toolCalls) {
      let result: string;
      try {
        if (tc.function.name === "export_entry") {
          const tcArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const entryId = String(tcArgs.entry_id ?? "").replace(/^id:/, "");
          const { data: entry } = await supabase
            .from("entries")
            .select("content, metadata, source, created_at")
            .eq("id", entryId)
            .maybeSingle();
          if (!entry) {
            result = "Запись не найдена.";
          } else {
            const rawTitle = ((entry.metadata as Record<string, unknown>)?.title as string | undefined)
              ?? (entry.source as string | undefined)
              ?? "entry";
            const safeTitle = rawTitle.replace(/[^\wа-яёА-ЯЁ\s-]/g, "").trim().replace(/\s+/g, "_");
            const dateStr = new Date(entry.created_at as string).toISOString().slice(0, 10);
            exportFile = { content: entry.content as string, filename: `${safeTitle}_${dateStr}.txt` };
            result = "Файл готов к отправке.";
          }
        } else {
          result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments) as Record<string, unknown>);
        }
      } catch { result = "Ошибка выполнения инструмента."; }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  if (exportFile) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", new Blob([exportFile.content], { type: "text/plain; charset=utf-8" }), exportFile.filename);
    if (finalAnswer && finalAnswer !== "В базе знаний нет информации по этому вопросу.") {
      form.append("caption", finalAnswer.slice(0, 1024));
    }
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    return;
  }

  const answer = finalAnswer || "В базе знаний нет информации по этому вопросу.";
  await sendMessage(chatId, answer);

  // Save answer as context so follow-up references ("эту", "её") resolve correctly
  await setSession(chatId, "last_answer", answer.slice(0, 800));
}
