import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_USER_ID = 744230399;
const GOOGLE_CLIENT_EMAIL = Deno.env.get("GOOGLE_CLIENT_EMAIL") ?? "";
const GOOGLE_PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");

const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Google Drive ──────────────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });
  const toSign = `${header}.${payload}`;

  const pemKey = GOOGLE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${toSign}.${sigB64}` }),
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function getOrCreateDriveFolder(name: string, parentId: string, token: string): Promise<string> {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as { files: Array<{ id: string }> };
  if (data.files?.length) return data.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const created = await createRes.json() as { id: string };
  return created.id;
}

async function uploadToDrive(fileName: string, buffer: ArrayBuffer, mimeType: string, subFolder: string): Promise<string | null> {
  if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_CLIENT_EMAIL) return null;
  try {
    const token = await getGoogleAccessToken();
    const folderId = await getOrCreateDriveFolder(subFolder, GOOGLE_DRIVE_FOLDER_ID, token);

    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const boundary = "boundary_swarm";
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const bodyEnd = `\r\n--${boundary}--`;
    const bodyBytes = new TextEncoder().encode(body);
    const endBytes = new TextEncoder().encode(bodyEnd);
    const fileBytes = new Uint8Array(buffer);
    const combined = new Uint8Array(bodyBytes.length + fileBytes.length + endBytes.length);
    combined.set(bodyBytes); combined.set(fileBytes, bodyBytes.length); combined.set(endBytes, bodyBytes.length + fileBytes.length);

    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: combined,
    });
    const result = await res.json() as { webViewLink?: string };
    return result.webViewLink ?? null;
  } catch { return null; }
}

interface TgMessage {
  chat: { id: number };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
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
  if (!res.ok) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_USER_ID,
        text: `⚠️ <b>Read.ai отключился</b> — токен истёк и не обновился.\n\nНажми /connect чтобы переподключить.`,
        parse_mode: "HTML",
      }),
    });
    return null;
  }

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


async function editMessageKeyboard(chatId: number, messageId: number, keyboard: unknown[][]): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }),
  });
}

async function sendInlineMessage(chatId: number, text: string, keyboard: unknown[][]): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { description?: string };
    throw new Error(`Telegram API: ${err.description ?? res.status}`);
  }
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

function buildKeyboard() {
  return {
    keyboard: [
      [{ text: "📥 Добавить" }, { text: "❓ Спросить" }, { text: "📋 Задачи" }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
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

// Lightweight completion for classification — small output, low cost
// ── GPT Tool definitions ──────────────────────────────────────────────────────

const KNOWLEDGE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "Semantic search of the knowledge base. Use for specific questions about meeting content, decisions, people, products, data. Include Russian and English terms in query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — include both Russian and English variants of key terms" },
          wants_full_text: { type: "boolean", description: "true = return raw transcript/original text; false = return summaries/theses" },
        },
        required: ["query"],
      },
    },
  },
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
];

type KbEntry = { id: string; content: string; summary?: string | null; source?: string | null };

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {

      case "search_knowledge": {
        const query = String(args.query ?? "");
        const wantsFullText = Boolean(args.wants_full_text ?? false);

        const embPromise = getEmbedding(query)
          .then(emb => supabase.rpc("match_entries", {
            query_embedding: `[${emb.join(",")}]`,
            match_threshold: wantsFullText ? 0.05 : 0.1,
            match_count: wantsFullText ? 15 : 8,
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
        const entries: KbEntry[] = [];
        for (const e of [...vec, ...kw]) {
          if (e?.id && !seen.has(e.id)) { seen.add(e.id); entries.push(e); }
        }
        if (!entries.length) return "Ничего не найдено по запросу.";
        return entries.slice(0, 5).map((e, i) => {
          const text = wantsFullText
            ? (e.content ?? "").slice(0, 3000)
            : (e.summary || (e.content ?? "").slice(0, 1500));
          return `[${i + 1}] ${e.source ?? ""}\n${text}`;
        }).join("\n\n---\n\n");
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
          return `[${i + 1}] ${e.source ?? ""}\n${text}`;
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

      default: return "Неизвестный инструмент.";
    }
  } catch (err) {
    return `Ошибка: ${err instanceof Error ? err.message : "unknown"}`;
  }
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

async function extractEntryMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
  try {
    const raw = await chatComplete(
      "Проанализируй текст и верни JSON (только JSON, без markdown):\n" +
      '{"countries":["Serbia","Bulgaria"...],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null"}\n\n' +
      "countries — страны/рынки упомянутые в тексте. СТРОГО короткое официальное название на английском без 'Republic of', 'Kingdom of' и т.п.: Serbia (не Republic of Serbia), Montenegro (не Montenegro Republic), Moldova (не Republic of Moldova). Только ISO-подобные короткие имена.\n" +
      "entry_type — transcript (расшифровка звонка), summary (саммари/тезисы), meeting (заметки встречи), document (файл/отчёт), note (заметка/факт).\n" +
      "entry_date — дата события из текста (не сегодняшняя), null если нет.",
      text.slice(0, 4000)
    );
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries : [],
      entry_type: parsed.entry_type ?? "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch { return { countries: [], entry_type: "note", entry_date: null }; }
}

async function saveEntry(content: string, addedBy: string, source: string, metadata: Record<string, unknown> = {}, summary?: string, groupId?: string): Promise<string> {
  // Embed summary if provided, otherwise embed content (with multilingual keywords for non-Russian)
  let indexContent = summary ?? content;
  if (!summary) {
    const isLikelyNonRussian = content.length > 100 && (content.match(/[a-zA-Z]/g) ?? []).length > content.length * 0.3;
    if (isLikelyNonRussian) {
      try {
        const keywords = await chatComplete(
          "Из текста извлеки ключевые слова, названия, темы и перепиши их на русском языке одной строкой через запятую. Только ключевые слова, без пояснений.",
          content.slice(0, 3000)
        );
        indexContent = `[Ключевые слова: ${keywords}]\n\n${content}`;
      } catch { /* ignore */ }
    }
  }

  // Extract structured metadata in parallel with embedding
  const [embedding, entryMeta] = await Promise.all([
    getEmbedding(indexContent.slice(0, 8000)),
    extractEntryMeta(summary ?? content),
  ]);

  const { data, error } = await supabase.from("entries").insert({
    content,
    summary: summary ?? null,
    embedding,
    added_by: addedBy,
    source,
    metadata,
    countries: entryMeta.countries,
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: groupId ?? null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// ── Session ───────────────────────────────────────────────────────────────────

async function getSession(chatId: number): Promise<{ action: string; context?: string } | null> {
  const { data } = await supabase.from("sessions")
    .select("action, context, updated_at")
    .eq("chat_id", chatId).maybeSingle();
  if (!data) return null;
  // Auto-expire sessions older than 30 minutes
  const age = Date.now() - new Date(data.updated_at ?? 0).getTime();
  if (age > 30 * 60 * 1000) {
    await supabase.from("sessions").delete().eq("chat_id", chatId);
    return null;
  }
  return data;
}

async function setSession(chatId: number, action: string, context?: string): Promise<void> {
  await supabase.from("sessions").upsert({ chat_id: chatId, action, context: context ?? null });
}

async function clearSession(chatId: number): Promise<void> {
  await supabase.from("sessions").delete().eq("chat_id", chatId);
}

// ── Access control ────────────────────────────────────────────────────────────

async function checkAllowed(userId: number, username?: string): Promise<boolean> {
  if (userId === ADMIN_USER_ID) return true;
  const { data } = await supabase.from("allowed_users").select("telegram_id").eq("telegram_id", userId).maybeSingle();
  if (data) return true;
  if (username) {
    const { data: pending } = await supabase.from("allowed_users")
      .select("id").eq("username", username).is("telegram_id", null).maybeSingle();
    if (pending) {
      await supabase.from("allowed_users").update({ telegram_id: userId }).eq("id", pending.id);
      return true;
    }
  }
  return false;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function generateSummary(text: string): Promise<string | null> {
  if (text.length < 80) return null;
  try {
    return await chatComplete(
      "Сделай краткие тезисы из текста. Только конкретные факты: имена, цифры, решения, даты. Без общих фраз. 3–7 пунктов. Маркированный список на русском.",
      text.slice(0, 6000)
    );
  } catch { return null; }
}

async function handleAdd(chatId: number, username: string, text: string): Promise<void> {
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
  await analyzeAndCreateTasks(text, chatId, entryId);
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

  // Task queries go to the dedicated task system
  if (TASK_KEYWORDS.test(question)) {
    const handled = await smartTaskSearch(chatId, question);
    if (handled) return;
  }

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
        "Используй инструменты чтобы найти нужную информацию в базе. " +
        "Отвечай ТОЛЬКО на основе данных из инструментов — не придумывай информацию. " +
        "Если данных нет — честно скажи. Отвечай на русском языке.",
    },
    { role: "user", content: question },
  ];

  let finalAnswer = "";

  for (let round = 0; round < 4; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools: KNOWLEDGE_TOOLS,
        tool_choice: round === 0 ? "required" : "auto",
        max_tokens: 1500,
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
        result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments) as Record<string, unknown>);
      } catch { result = "Ошибка выполнения инструмента."; }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  await sendMessage(chatId, finalAnswer || "В базе знаний нет информации по этому вопросу.");
  await setSession(chatId, "clarify_ready", question);
}


async function handleVoice(chatId: number, username: string, fileId: string, duration: number): Promise<void> {
  await sendMessage(chatId, `Транскрибирую голосовое (${duration} сек)...`);
  const transcript = await transcribeAudio(fileId);
  const summary = await generateSummary(transcript);
  const entryId = await saveEntry(transcript, username, "voice", {}, summary ?? undefined);
  await sendMessage(chatId, summary
    ? `✅ Сохранено.\n\n<b>Тезисы:</b>\n${summary}`
    : `✅ Транскрипция сохранена:\n\n<i>${transcript.slice(0, 500)}</i>`);
  await analyzeAndCreateTasks(transcript, chatId, entryId);
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
    const CHUNK = 3000, OVL = 200;
    const chunks: string[] = [];
    for (let p = 0; p < text.length; p += CHUNK - OVL) chunks.push(text.slice(p, p + CHUNK));
    let firstId = "";
    for (let i = 0; i < chunks.length; i++) {
      const eid = await saveEntry(chunks[i], username, "document", { file_name: name, mime, chunk: i + 1, total_chunks: chunks.length });
      if (i === 0) firstId = eid;
    }
    await sendMessage(chatId, `Файл <b>${name}</b> сохранён (${text.length} символов, ${chunks.length} частей).`);
    await analyzeAndCreateTasks(text.slice(0, 6000), chatId, firstId);
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
      await sendMessage(chatId, "Не удалось извлечь текст из PDF — возможно, это скан. Попробуй скопировать текст вручную через /add.");
      return;
    }

    // Chunk large documents into ~3000-char pieces with 200-char overlap
    const CHUNK_SIZE = 3000;
    const OVERLAP = 200;
    const chunks: string[] = [];
    let pos = 0;
    while (pos < extracted.length) {
      chunks.push(extracted.slice(pos, pos + CHUNK_SIZE));
      pos += CHUNK_SIZE - OVERLAP;
    }

    await sendMessage(chatId, `📄 <b>${name}</b> — ${extracted.length} символов, разбиваю на ${chunks.length} частей...`);

    let firstEntryId = "";
    for (let i = 0; i < chunks.length; i++) {
      const entryId = await saveEntry(chunks[i], username, "pdf", {
        file_name: name,
        chunk: i + 1,
        total_chunks: chunks.length,
      });
      if (i === 0) firstEntryId = entryId;
    }

    await sendMessage(chatId, `✅ PDF сохранён полностью (${chunks.length} частей).`);
    await analyzeAndCreateTasks(extracted.slice(0, 6000), chatId, firstEntryId);
    return;
  }

  await sendMessage(chatId, `Формат <code>${mime || name}</code> пока не поддерживается.\n\nПоддерживаемые форматы: TXT, MD, CSV, JSON, PDF.`);
}

async function handlePhoto(chatId: number, username: string, photos: NonNullable<TgMessage["photo"]>): Promise<void> {
  await sendMessage(chatId, "Анализирую изображение...");
  const largest = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
  const description = await describeImage(largest.file_id);
  const entryId = await saveEntry(description, username, "image");
  await sendMessage(chatId, `Изображение обработано и сохранено:\n\n<i>${description.slice(0, 500)}${description.length > 500 ? "..." : ""}</i>`);
  await analyzeAndCreateTasks(description, chatId, entryId);
}

async function handleUrl(chatId: number, username: string, url: string): Promise<void> {
  await sendMessage(chatId, `Загружаю страницу...`);
  const content = await fetchUrlContent(url);
  if (!content || content.length < 50) { await sendMessage(chatId, "Не удалось извлечь текст со страницы."); return; }
  const entryId = await saveEntry(content, username, "url", { url });
  await sendMessage(chatId, `Страница сохранена (${content.length} символов):\n<code>${url}</code>`);
  await analyzeAndCreateTasks(content, chatId, entryId);
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
    if (!targetArg) { await sendMessage(chatId, "Использование: /users add [telegram_id или @username]"); return; }
    if (targetArg.startsWith("@")) {
      const uname = targetArg.slice(1);
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: null, username: uname, added_by: adminId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `@${uname} уже в списке.` : `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(chatId, `@${uname} добавлен. ID подтянется автоматически когда напишет боту.`);
    } else {
      if (isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users add [telegram_id или @username]"); return; }
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: Number(targetArg), added_by: adminId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `Пользователь ${targetArg} уже в списке.` : `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(chatId, `Пользователь ${targetArg} добавлен.`);
    }
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
  pending: "⏳ На подтверждении",
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
  url: string | null;
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
    .not("status", "in", '("done","cancelled","pending")')
    .order("due_date", { ascending: true });

  if (f === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  return q;
}

function applyArrayFilter(tasks: Task[], filter: string): Task[] {
  const f = filter.trim();
  if (f.startsWith("@")) {
    const person = f.slice(1).toLowerCase();
    return tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(person)));
  }
  if (f && !["done", "all", "week"].includes(f)) {
    const tag = f.toLowerCase();
    return tasks.filter(t => t.tags?.some(tg => tg.toLowerCase().includes(tag)));
  }
  return tasks;
}

async function analyzeAndCreateTasks(content: string, chatId: number, entryId: string): Promise<void> {
  const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, markets");

  type Profile = { first_name?: string; last_name?: string; markets?: string[] };

  const userList = (profiles ?? []).map((p: Profile) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const markets = p.markets?.length ? ` (рынки: ${p.markets.join(", ")})` : "";
    return name ? `${name}${markets}` : null;
  }).filter(Boolean).join("; ");

  const raw = await chatComplete(
    `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
    `Члены команды и их рынки: ${userList || "неизвестны"}\n` +
    `Если в тексте упоминается страна/рынок — назначь задачу ответственному за этот рынок.\n` +
    `Верни ТОЛЬКО JSON без markdown:\n` +
    `{"tasks":[{"title":"Название задачи","assignee":"Полное имя из списка или null","due_date":"YYYY-MM-DD или null","confidence":0.9}]}\n` +
    `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
    content.slice(0, 6000)
  );

  let tasks: Array<{ title: string; assignee: string | null; due_date: string | null; confidence: number }> = [];
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    tasks = (parsed.tasks ?? []).filter((t: { confidence: number }) => t.confidence >= 0.7);
  } catch { return; }

  if (!tasks.length) return;

  const profileNames = (profiles ?? []).map((p: Profile) =>
    [p.first_name, p.last_name].filter(Boolean).join(" ")
  );

  for (const task of tasks) {
    const assignees: string[] = [];
    if (task.assignee) {
      const lower = task.assignee.toLowerCase();
      const match = profileNames.find((n: string) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()));
      if (match) assignees.push(match);
    }
    await supabase.from("tasks").insert({
      title: task.title,
      assignees,
      due_date: task.due_date ?? null,
      tags: [],
      status: "pending",
      meeting_id: entryId,
    });
  }

  const n = tasks.length;
  const word = n === 1 ? "задача" : n < 5 ? "задачи" : "задач";
  await sendMessage(chatId, `📋 Найдено <b>${n} ${word}</b> — проверь в разделе <b>📋 Задачи → ⏳ На подтверждении</b>.`);
}

async function sendPendingTaskCard(chatId: number, task: Task): Promise<void> {
  const assignees = task.assignees?.length ? task.assignees.join(", ") : "все";
  const due = task.due_date ? `\n📅 ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const text = `⏳ <b>${task.title}</b>\n👤 ${assignees}${due}`;

  await sendInlineMessage(chatId, text, [
    [
      { text: "✅ Подтвердить", callback_data: `tc_${task.id}` },
      { text: "👤 Назначить", callback_data: `ta_${task.id}` },
      { text: "🗑 Удалить", callback_data: `td_${task.id}` },
    ],
  ]);
}

async function handleTaskListCallback(chatId: number, userId: number, username: string, type: string): Promise<void> {
  if (type === "pending") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Задач на подтверждении нет. ✅"); return; }
    await sendMessage(chatId, `<b>⏳ На подтверждении: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendPendingTaskCard(chatId, t);
  } else if (type === "mine") {
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", userId).maybeSingle();
    const fullName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : "";
    const searchName = fullName || username;

    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled")')
      .order("due_date", { ascending: true }).limit(200);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const allMine = ((data ?? []) as Task[]).filter(t => t.assignees?.some(a => a.toLowerCase().includes(searchName.toLowerCase())));
    const pending = allMine.filter(t => t.status === "pending");
    const active = allMine.filter(t => t.status !== "pending").slice(0, 15);
    if (!allMine.length) { await sendMessage(chatId, "У тебя нет активных задач."); return; }
    if (pending.length > 0) await sendMessage(chatId, `<b>⏳ На подтверждении: ${pending.length} шт.</b>\nПодтверди задачи в разделе "На подтверждении".`);
    if (active.length > 0) {
      await sendMessage(chatId, `<b>👤 Мои задачи: ${active.length} шт.</b>`);
      for (const t of active) await sendTaskCard(chatId, t);
    } else if (pending.length > 0) {
      await sendMessage(chatId, "Подтверждённых задач пока нет — сначала прими задачи из раздела «На подтверждении».");
    }
  } else if (type === "open") {
    const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    type Profile = { telegram_id: number; first_name?: string; last_name?: string };
    const profileMap: Record<number, Profile> = Object.fromEntries(
      (profiles ?? []).map((p: Profile) => [p.telegram_id, p])
    );
    const seen = new Set<number>();
    const personButtons = ((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>)
      .filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; })
      .map((u) => {
        const p = profileMap[u.telegram_id];
        const label = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
        return [{ text: `👤 ${label}`, callback_data: `tl_openby_${u.telegram_id}` }];
      });
    await sendInlineMessage(chatId, "<b>📋 Все открытые — фильтр:</b>", [
      [{ text: "📋 Все", callback_data: "tl_open_all" }],
      ...personButtons,
    ]);
  } else if (type === "open_all") {
    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled","pending")')
      .order("due_date", { ascending: true }).limit(15);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Открытых задач нет."); return; }
    await sendMessage(chatId, `<b>📋 Все открытые: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type.startsWith("openby_")) {
    const targetTgId = Number(type.replace("openby_", ""));
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
    const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
    const searchName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : (au?.username ?? String(targetTgId));
    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled","pending")')
      .order("due_date", { ascending: true }).limit(200);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = ((data ?? []) as Task[]).filter(t => t.assignees?.some(a => a.toLowerCase().includes(searchName.toLowerCase()))).slice(0, 15);
    if (!tasks.length) { await sendMessage(chatId, `У ${searchName} нет активных задач.`); return; }
    await sendMessage(chatId, `<b>👤 ${searchName}: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "done") {
    const { data, error } = await supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false }).limit(15);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Выполненных задач нет."); return; }
    await sendMessage(chatId, `<b>✅ Выполненные: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "export") {
    await handleTasksExport(chatId, "");
  }
}

async function handleTasks(chatId: number, filter: string): Promise<void> {
  const sub = filter.trim().toLowerCase();

  if (!sub) {
    const { count } = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "pending");
    const pendingCount = count ?? 0;
    await sendInlineMessage(chatId, "<b>📋 Задачи</b>", [
      [{ text: `⏳ На подтверждении${pendingCount > 0 ? ` (${pendingCount})` : ""}`, callback_data: "tl_pending" }],
      [{ text: "👤 Мои задачи", callback_data: "tl_mine" }, { text: "📋 Все открытые", callback_data: "tl_open" }],
      [{ text: "✅ Выполненные", callback_data: "tl_done" }, { text: "📤 Экспорт", callback_data: "tl_export" }],
    ]);
    return;
  }

  if (sub === "export" || sub.startsWith("export ")) {
    await handleTasksExport(chatId, sub.replace("export", "").trim());
    return;
  }

  const needsJsFilter = filter.trim().startsWith("@") || (filter.trim() && !["done", "all", "week"].includes(filter.trim()));
  const { data, error } = await buildTaskQuery(filter).limit(needsJsFilter ? 200 : 15);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

  const tasks = applyArrayFilter((data ?? []) as Task[], filter).slice(0, 15);
  if (!tasks.length) { await sendMessage(chatId, "Задач не найдено."); return; }

  const label = filter.trim() ? ` · ${filter.trim()}` : "";
  await sendMessage(chatId, `<b>Задачи${label}:</b> ${tasks.length} шт.`);

  for (const task of tasks) {
    await sendTaskCard(chatId, task);
  }
}

async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const assignees = task.assignees?.length ? task.assignees.join(", ") : "—";
  const due = task.due_date ? `📅 ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const tags = task.tags?.length ? `🏷 ${task.tags.join(", ")}` : "";
  const status = STATUS_LABEL[task.status] ?? task.status;

  const text = [
    `${status} <b>${task.title}</b>`,
    `👤 ${assignees}`,
    [due, tags].filter(Boolean).join("  "),
    task.url ? `🔗 <a href="${task.url}">${task.url}</a>` : "",
  ].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [
    [{ text: "⚙️ Действия →", callback_data: `topen_${task.id}` }],
  ]);
}

async function showTaskComments(chatId: number, taskId: string): Promise<void> {
  const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
  const { data: comments } = await supabase.from("task_comments")
    .select("content, added_by, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  const title = task?.title ?? "Задача";
  const lines = (comments ?? []).map((c: { content: string; added_by: string; created_at: string }) => {
    const date = new Date(c.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<b>${c.added_by}</b> · ${date}\n${c.content}`;
  });

  const text = lines.length
    ? `💬 <b>Комментарии · ${title}</b>\n\n${lines.join("\n\n")}`
    : `💬 <b>Комментарии · ${title}</b>\n\nПока нет комментариев.`;

  await sendInlineMessage(chatId, text, [
    [{ text: "➕ Добавить комментарий", callback_data: `tca_${taskId}` }],
  ]);
}

async function handleTasksExport(chatId: number, filter: string): Promise<void> {
  const { data, error } = await buildTaskQuery(filter || "").limit(500);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
  const tasks = applyArrayFilter((data ?? []) as Task[], filter || "");
  if (!tasks.length) { await sendMessage(chatId, "Задач для экспорта не найдено."); return; }

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

async function generatePersonalDigest(chatId: number, userId: number, daysBack = 7): Promise<void> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const periodStart = new Date(Date.now() - daysBack * 86_400_000).toLocaleDateString("ru-RU");
  const periodEnd = new Date().toLocaleDateString("ru-RU");
  const periodLabel = `${periodStart} — ${periodEnd}`;

  const { data: profile } = await supabase.from("user_profiles")
    .select("first_name, last_name, role, markets")
    .eq("telegram_id", userId).maybeSingle();

  const userName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : "";
  const markets: string[] = profile?.markets ?? [];
  const role: string = profile?.role ?? "";

  await sendMessage(chatId, `⏳ Генерирую твой дайджест за ${periodLabel}...`);

  const { data: entries } = await supabase.from("entries")
    .select("content, source, created_at")
    .gte("created_at", since)
    .not("source", "eq", "digest")
    .order("created_at", { ascending: false })
    .limit(200);

  if (!entries?.length) {
    await sendMessage(chatId, "За указанный период нет записей.");
    return;
  }

  // Get all known markets to detect general (non-country-specific) entries
  const { data: allProfiles } = await supabase.from("user_profiles").select("markets");
  const allMarkets = [...new Set(
    (allProfiles ?? []).flatMap((p: { markets?: string[] }) => p.markets ?? [])
  )].filter((m): m is string => typeof m === "string").map(m => m.toLowerCase());

  const userKeywords = [...markets, role, userName].filter(Boolean).map(k => k.toLowerCase());

  type EntryRow = { content: string; source: string; created_at: string };
  const relevant = (entries as EntryRow[]).filter(e => {
    const lower = e.content.toLowerCase();
    const mentionsUserContext = userKeywords.some(k => lower.includes(k));
    const mentionsAnyMarket = allMarkets.some(m => lower.includes(m));
    // Include if: relevant to user personally OR general (doesn't mention any specific market)
    return mentionsUserContext || !mentionsAnyMarket;
  });

  if (!relevant.length) {
    await sendMessage(chatId, "За этот период нет релевантных записей.");
    return;
  }

  const entriesText = relevant.map((e: EntryRow) => {
    const date = new Date(e.created_at).toLocaleDateString("ru-RU");
    return `[${e.source} · ${date}] ${e.content.slice(0, 600)}`;
  }).join("\n\n---\n\n");

  const contextLine = [
    markets.length ? `Рынки: ${markets.join(", ")}` : "",
    role ? `Роль: ${role}` : "",
    userName ? `Имя: ${userName}` : "",
  ].filter(Boolean).join(" | ");

  const digest = await chatComplete(
    `Ты аналитик команды. Составь персональный дайджест за ${periodLabel} для сотрудника.\n` +
    `Профиль сотрудника: ${contextLine}\n\n` +
    `Включай только то, что касается его рынков, роли или упоминает его напрямую.\n\n` +
    `Структура:\n` +
    `🌍 По рынкам — ключевые события (только его рынки)\n` +
    `✅ Что сделано / решено\n` +
    `🔥 Проблемы и блокеры\n` +
    `📋 На следующий период\n\n` +
    `Будь конкретным. Отвечай на русском.`,
    entriesText.slice(0, 14000),
  );

  const digestContent = `Дайджест за ${periodLabel} · ${userName || `ID ${userId}`}\n\n${digest}`;
  await saveEntry(digestContent, "system", "digest", { period: periodLabel, days_back: daysBack, user_id: userId });

  let remaining = `<b>📊 Твой дайджест ${periodLabel}</b>\n\n${digest}`;
  while (remaining.length > 0) {
    await sendMessage(chatId, remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }
}

async function sendAllDigests(daysBack = 7): Promise<void> {
  const { data: users } = await supabase.from("user_profiles")
    .select("telegram_id, digest_enabled")
    .eq("digest_enabled", true);

  for (const u of (users ?? []) as Array<{ telegram_id: number }>) {
    try {
      await generatePersonalDigest(u.telegram_id, u.telegram_id, daysBack);
    } catch { /* skip failed user */ }
  }
}

async function startOnboarding(chatId: number): Promise<void> {
  await setSession(chatId, "onboard_role");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Давай познакомимся! Заполним твой профиль — это займёт минуту.\n\n<b>Шаг 1/4.</b> Какая у тебя роль в команде?\n\n<i>Например: Девелопер, Маркетинг, BD, Операции</i>",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_role" }]] },
    }),
  });
}

async function autoSyncProfile(userId: number, firstName?: string, lastName?: string, username?: string): Promise<void> {
  const update: Record<string, unknown> = { telegram_id: userId, updated_at: new Date().toISOString() };
  if (firstName) update.first_name = firstName;
  if (lastName !== undefined) update.last_name = lastName;
  if (username) update.username = username;
  await supabase.from("user_profiles").upsert(update, { onConflict: "telegram_id", ignoreDuplicates: false });
  if (username) {
    await supabase.from("allowed_users").update({ username }).eq("telegram_id", userId);
  }
}


// ── User profiles ─────────────────────────────────────────────────────────────

const PROFILE_FIELDS: Record<string, string> = {
  first_name: "Имя",
  last_name:  "Фамилия",
  role:       "Роль",
  markets:    "Рынки (через запятую)",
  email:      "Email",
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
    `<b>👤 ${name}</b>${user?.is_admin ? " 👑" : ""}`,
    `🔖 @${profile?.username ?? user?.username ?? "—"} (${targetId})`,
    `💼 ${profile?.role || "—"}`,
    `🌍 ${markets}`,
    profile?.email ? `📧 ${profile.email}` : "",
  ].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, lines, [[
    { text: "✏️ Редактировать", callback_data: `pe_menu_${targetId}` },
    { text: "📋 Задачи", callback_data: `ptasks_${targetId}` },
  ]]);
}

async function handleProfileTasks(chatId: number, targetId: number): Promise<void> {
  const { data: profile } = await supabase
    .from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
  const { data: user } = await supabase
    .from("allowed_users").select("username").eq("telegram_id", targetId).maybeSingle();

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const searchName = fullName || user?.username || String(targetId);

  const { data: allTasks, error } = await supabase
    .from("tasks")
    .select("*")
    .not("status", "in", '("done","cancelled")')
    .order("due_date", { ascending: true });

  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

  const nameLower = searchName.toLowerCase();
  const tasks = (allTasks ?? [])
    .filter((t: Task) => t.assignees?.some((a: string) => a.toLowerCase().includes(nameLower)))
    .slice(0, 15);

  if (!tasks.length) {
    await sendMessage(chatId, `У <b>${searchName}</b> нет активных задач.`);
    return;
  }

  await sendMessage(chatId, `<b>Задачи · ${searchName}:</b> ${tasks.length} шт.`);
  for (const task of tasks) {
    await sendTaskCard(chatId, task);
  }
}

async function showProfileEditMenu(chatId: number, targetId: number): Promise<void> {
  const keyboard = Object.entries(PROFILE_FIELDS).map(([field, label]) => [
    { text: `✏️ ${label}`, callback_data: `pe_${targetId}_${field}` },
  ]);
  keyboard.push([{ text: "← Назад", callback_data: `pu_${targetId}` }]);
  await sendInlineMessage(chatId, "Что хочешь изменить?", keyboard);
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
  await analyzeAndCreateTasks(contentParts, chatId, entryId);
}

function getHelpText(): string {
  const base =
    "<b>Swarm Brain</b>\n\n" +
    "Просто пиши — бот сам поймёт что делать:\n" +
    "• Вопрос → найдёт ответ в базе знаний\n" +
    "• Информация/заметка → сохранит в базу\n\n" +
    "<b>Медиа (обрабатывается автоматически):</b>\n" +
    "🎤 Голосовые — транскрибация\n" +
    "📎 Файлы (PDF, Excel, TXT, CSV) — извлечение текста\n" +
    "🖼 Фото — описание через ИИ\n" +
    "🔗 Ссылки — загрузка содержимого\n\n" +
    "<b>Команды:</b>\n" +
    "/add [текст] — принудительно сохранить запись\n" +
    "/ask [вопрос] — принудительно спросить\n" +
    "/tasks — задачи\n" +
    "/status — состояние системы\n" +
    "/reindex — переиндексировать базу\n" +
    "/help — эта справка";

  return base +
    "\n\n<b>Управление пользователями:</b>\n/users list · /users add [id] · /users remove [id]\n/status · /reindex" +
    "\n\n<b>Claude Desktop — подключение:</b>\n" +
    "1. Settings → Developer → Add MCP Server\n" +
    "   Name: <code>swarm-brain</code>\n" +
    "   URL: <code>https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp</code>\n" +
    "2. Projects → New Project → вставь инструкции из файла <code>SETUP_CLAUDE_DESKTOP.md</code>\n" +
    "3. Кидай транскрипты — Claude сохранит оригинал и сделает саммари автоматически";
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  // ── Cron triggers ─────────────────────────────────────────────────────────────
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
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_USER_ID,
            text: `⚠️ <b>Встречи не поступают</b> — последняя была ${Math.round(hoursAgo / 24)} дн назад.\n\nПроверь вебхук в настройках Read.ai.`,
            parse_mode: "HTML",
          }),
        });
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

    try {
      if (cb.data.startsWith("tl_")) {
        await handleTaskListCallback(chatId, userId, username, cb.data.replace("tl_", ""));
      } else if (cb.data.startsWith("tc_")) {
        const taskId = cb.data.replace("tc_", "");
        const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
        await supabase.from("tasks").update({ status: "open" }).eq("id", taskId);
        await sendMessage(chatId, `✅ Задача подтверждена: <b>${task?.title ?? ""}</b>`);
      } else if (cb.data.startsWith("tas_")) {
        // tas_{taskId}_{telegram_id}
        const rest = cb.data.replace("tas_", "");
        const sep = rest.lastIndexOf("_");
        const taskId = rest.slice(0, sep);
        const targetTgId = Number(rest.slice(sep + 1));
        const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
        const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
        const assigneeName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : (au?.username ? `@${au.username}` : `ID ${targetTgId}`);
        await supabase.from("tasks").update({ assignees: [assigneeName], status: "open" }).eq("id", taskId);
        await sendMessage(chatId, `✅ Назначено: <b>${assigneeName}</b>`);
      } else if (cb.data.startsWith("ta_")) {
        const taskId = cb.data.replace("ta_", "");

        const { data: profiles, error: profErr } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
        const { data: allowedUsers, error: auErr } = await supabase.from("allowed_users").select("telegram_id, username");

        if (profErr || auErr) {
          await sendMessage(chatId, `Ошибка БД: ${profErr?.message ?? auErr?.message}`);
        } else {
          const profileMap: Record<number, { first_name?: string; last_name?: string }> =
            Object.fromEntries((profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]));

          // Deduplicate by telegram_id
          const seen = new Set<number>();
          const allUsers: Array<{ telegram_id: number; username: string | null }> = [
            { telegram_id: ADMIN_USER_ID, username: null },
            ...((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>),
          ].filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });

          const buttons = allUsers.map((u) => {
            const p = profileMap[u.telegram_id];
            const fullName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "";
            const label = fullName || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
            // Use telegram_id in callback_data to stay within 64-byte limit
            return [{ text: label, callback_data: `tas_${taskId}_${u.telegram_id}` }];
          });

          await sendInlineMessage(chatId, "Кому назначить задачу?", buttons);
        }
      } else if (cb.data.startsWith("meeting_")) {
        await handleMeetingCallback(chatId, username, cb.data.replace("meeting_", ""));
      } else if (cb.data.startsWith("ts_")) {
        const parts = cb.data.split("_");
        const taskId = parts[1];
        const newStatus = parts.slice(2).join("_");
        await handleTaskStatusChange(chatId, username, taskId, newStatus);
      } else if (cb.data.startsWith("md_")) {
        const entryId = cb.data.replace("md_", "");

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
      } else if (cb.data.startsWith("rai_")) {
        const sub = cb.data.replace("rai_", "");
        if (sub === "saved") {
          const { data: meetings } = await supabase
            .from("entries").select("id, metadata, created_at")
            .eq("source", "read_ai").order("created_at", { ascending: false }).limit(15);
          if (!meetings?.length) {
            await sendMessage(chatId, "Сохранённых встреч пока нет.");
          } else {
            await sendMessage(chatId, `<b>📋 Встречи из Read.ai:</b>`);
            for (const m of meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string }>) {
              const title = (m.metadata?.title as string) ?? "Встреча";
              const date = new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
              const duration = m.metadata?.duration ? ` · ${Math.round((m.metadata.duration as number) / 60)} мин` : "";
              const tags = (m.metadata?.tags as string[] | undefined)?.length ? `\n🏷 ${(m.metadata.tags as string[]).join(", ")}` : "";
              await sendInlineMessage(chatId, `📋 <b>${title}</b>\n${date}${duration}${tags}`, [[{ text: "🔍 Подробнее", callback_data: `mr_${m.id}` }]]);
            }
          }
        } else if (sub === "import") {
          await handleMeetings(chatId, 48);
        } else if (sub === "connect") {
          await handleConnect(chatId);
        }
      } else if (cb.data.startsWith("mr_")) {
        const entryId = cb.data.replace("mr_", "");
        const { data: entry } = await supabase.from("entries").select("content, metadata, created_at").eq("id", entryId).maybeSingle();
        if (!entry) { await sendMessage(chatId, "Встреча не найдена."); return new Response("OK", { status: 200 }); }

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
      } else if (cb.data.startsWith("ptasks_")) {
        const targetId = Number(cb.data.replace("ptasks_", ""));
        await handleProfileTasks(chatId, targetId);
      } else if (cb.data.startsWith("pu_")) {
        const targetId = Number(cb.data.replace("pu_", ""));
        await showProfile(chatId, targetId);
      } else if (cb.data.startsWith("pe_menu_")) {
        const targetId = Number(cb.data.replace("pe_menu_", ""));
        await showProfileEditMenu(chatId, targetId);
      } else if (cb.data.startsWith("pe_")) {
        // Profile edit: pe_{targetId}_{field}
        const parts = cb.data.split("_");
        const targetId = Number(parts[1]);
        const field = parts.slice(2).join("_");
        const label = PROFILE_FIELDS[field] ?? field;
        const { data: currentProfile } = await supabase.from("user_profiles").select(field).eq("telegram_id", targetId).maybeSingle();
        const currentValue = currentProfile?.[field];
        const currentStr = Array.isArray(currentValue)
          ? currentValue.join(", ")
          : (currentValue ?? "");
        await setSession(chatId, `profile_${targetId}_${field}`, undefined);
        const hint = currentStr ? `\n\nСейчас: <i>${currentStr}</i>` : "";
        await sendMessage(chatId, `Введи новое значение для <b>${label}</b>:${hint}`);
      } else if (cb.data === "start_onboard") {
        await startOnboarding(chatId);
      } else if (cb.data.startsWith("onboard_skip_")) {
        const step = cb.data.replace("onboard_skip_", "");
        const nextStep: Record<string, string> = { role: "onboard_markets", markets: "onboard_email", email: "onboard_phone" };
        const nextMsg: Record<string, string> = {
          role: "<b>Шаг 2/4.</b> За какие рынки/страны отвечаешь?\n\n<i>Перечисли через запятую: Словения, Болгария</i>",
          markets: "<b>Шаг 3/4.</b> Рабочий email?",
          email: "<b>Шаг 4/4.</b> Номер телефона? (необязательно)",
        };
        const nextSkip: Record<string, string> = { role: "markets", markets: "email", email: "phone" };
        if (step === "phone" || !nextStep[step]) {
          await clearSession(chatId);
          await sendMessage(chatId, "Профиль можно дополнить позже через 👥 Пользователи.", buildKeyboard());
        } else {
          await setSession(chatId, nextStep[step]);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: nextMsg[step], parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: `onboard_skip_${nextSkip[step]}` }]] } }),
          });
        }
      } else if (cb.data.startsWith("mrename_")) {
        const entryId = cb.data.replace("mrename_", "");
        await setSession(chatId, `meeting_rename_${entryId}`);
        await sendMessage(chatId, "Введи новое название встречи:");
      } else if (cb.data.startsWith("mtag_")) {
        const meetingId = cb.data.replace("mtag_", "");
        await setSession(chatId, `meeting_tag_${meetingId}`);
        await sendMessage(chatId, "Введи теги/страны через запятую (например: <i>Словения, Болгария, Sales</i>):");
      } else if (cb.data.startsWith("massign_")) {
        const meetingId = cb.data.replace("massign_", "");
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
      } else if (cb.data.startsWith("mau_")) {
        const rest = cb.data.replace("mau_", "");
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
      } else if (cb.data.startsWith("topen_")) {
        const taskId = cb.data.replace("topen_", "");
        const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).maybeSingle();
        if (!task) { await sendMessage(chatId, "Задача не найдена."); return new Response("OK", { status: 200 }); }
        const isActive = task.status !== "done" && task.status !== "cancelled";
        const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
        if (isActive) {
          keyboard.push([
            { text: "🔄 В работе", callback_data: `ts_${task.id}_in_progress` },
            { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
            { text: "⏸ Отмена", callback_data: `ts_${task.id}_cancelled` },
          ]);
          keyboard.push([
            { text: "📅 Дедлайн", callback_data: `tdate_${task.id}` },
            { text: "✏️ Название", callback_data: `ttitle_${task.id}` },
            { text: "🔗 Ссылка", callback_data: `turl_${task.id}` },
          ]);
          keyboard.push([
            { text: "👤 Назначить", callback_data: `ta_${task.id}` },
            { text: "💬 Комментарии", callback_data: `tcomments_${task.id}` },
          ]);
        }
        keyboard.push([{ text: "🗑 Удалить", callback_data: `td_${task.id}` }]);
        await editMessageKeyboard(chatId, cb.message.message_id, keyboard);
      } else if (cb.data.startsWith("tdate_")) {
        const taskId = cb.data.replace("tdate_", "");
        await setSession(chatId, `task_date_${taskId}`);
        await sendMessage(chatId, "Новый дедлайн?");
      } else if (cb.data.startsWith("ttitle_")) {
        const taskId = cb.data.replace("ttitle_", "");
        await setSession(chatId, `task_title_${taskId}`);
        await sendMessage(chatId, "Введи новое название задачи:");
      } else if (cb.data.startsWith("turl_")) {
        const taskId = cb.data.replace("turl_", "");
        await setSession(chatId, `task_url_${taskId}`);
        await sendMessage(chatId, "Введи ссылку:");
      } else if (cb.data.startsWith("tcomments_")) {
        const taskId = cb.data.replace("tcomments_", "");
        await showTaskComments(chatId, taskId);
      } else if (cb.data.startsWith("tca_")) {
        const taskId = cb.data.replace("tca_", "");
        await setSession(chatId, `task_comment_${taskId}`);
        await sendMessage(chatId, "Напиши комментарий:");
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

  const allowed = await checkAllowed(userId, message.from?.username);
  if (!allowed) {
    await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
    return new Response("OK", { status: 200 });
  }

  await autoSyncProfile(userId, message.from?.first_name, message.from?.last_name, message.from?.username);

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

    const BUTTON_LABELS = new Set(["📥 Добавить", "❓ Спросить", "📋 Задачи", "ℹ️ Помощь", "👥 Пользователи", "🎙 Встречи", "🎙 Read.ai"]);
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
      const action = session?.action ?? null;

      if (action === "waiting_add") {
        await clearSession(chatId);
        const entryId = await saveEntry(text, username, "telegram");
        await sendMessage(chatId, "Запись добавлена в базу знаний.");
        await analyzeAndCreateTasks(text, chatId, entryId);
      } else if (action === "waiting_ask") {
        await clearSession(chatId);
        await handleAsk(chatId, text);
      } else if (action === "clarify_ready" && text.length < 300) {
        await clearSession(chatId);
        const originalQuestion = session?.context ?? "";
        const combined = originalQuestion ? `${originalQuestion}. Уточнение: ${text}` : text;
        await handleAsk(chatId, combined);
      } else if (action?.startsWith("meeting_rename_")) {
        await clearSession(chatId);
        const entryId = action.replace("meeting_rename_", "");
        const newTitle = text.trim();
        const { data: entry } = await supabase.from("entries").select("metadata").eq("id", entryId).maybeSingle();
        if (!entry) { await sendMessage(chatId, "Встреча не найдена."); }
        else {
          await supabase.from("entries").update({ metadata: { ...entry.metadata, title: newTitle } }).eq("id", entryId);
          await sendMessage(chatId, `✅ Встреча переименована: <b>${newTitle}</b>`);
        }
      } else if (action?.startsWith("meeting_tag_")) {
        await clearSession(chatId);
        const meetingId = action.replace("meeting_tag_", "");
        const tags = text.split(",").map((s: string) => s.trim()).filter(Boolean);
        const tagsLower = tags.map(t => t.toLowerCase());

        // Match tags against user profiles to auto-assign tasks
        const { data: profiles } = await supabase.from("user_profiles").select("telegram_id, first_name, last_name, markets, role, email");
        const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
        type ProfileRow = { telegram_id: number; first_name?: string; last_name?: string; markets?: string[]; role?: string; email?: string };
        const usernameMap: Record<number, string> = Object.fromEntries(
          ((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>)
            .filter(u => u.username).map(u => [u.telegram_id, u.username!.toLowerCase()])
        );
        const matched: string[] = [];
        for (const p of (profiles ?? []) as ProfileRow[]) {
          const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ");
          if (!fullName) continue;
          // Build all identifiers for this person
          const identifiers: string[] = [
            p.first_name?.toLowerCase(),
            p.last_name?.toLowerCase(),
            usernameMap[p.telegram_id],                        // telegram @username
            p.email?.split("@")[0]?.toLowerCase(),             // email prefix (vasiliy.garro)
            ...(p.email?.split("@")[0]?.split(/[._-]/) ?? []), // email parts (vasiliy, garro)
            ...(p.markets ?? []).map(m => m.toLowerCase()),
            p.role?.toLowerCase(),                             // role: "БД" assigns all БД people
          ].filter(Boolean) as string[];

          const hits = tagsLower.filter(tag =>
            identifiers.some(id => id.includes(tag) || tag.includes(id))
          );
          if (hits.length > 0) matched.push(fullName);
        }

        // Update tags on all meeting tasks and auto-assign matched people
        const { data: meetingTasks } = await supabase.from("tasks").select("id, tags, assignees").eq("meeting_id", meetingId);
        for (const t of (meetingTasks ?? []) as Array<{ id: string; tags: string[]; assignees: string[] }>) {
          const mergedTags = [...new Set([...(t.tags ?? []), ...tags])];
          const existingAssignees = t.assignees ?? [];
          const mergedAssignees = [...new Set([...existingAssignees, ...matched])];
          await supabase.from("tasks").update({ tags: mergedTags, assignees: mergedAssignees, status: "pending" }).eq("id", t.id);
        }

        const { data: entry } = await supabase.from("entries").select("id, metadata").filter("metadata->>meeting_id", "eq", meetingId).maybeSingle();
        if (entry) {
          await supabase.from("entries").update({ metadata: { ...entry.metadata, tags } }).eq("id", entry.id);
        }

        let reply = `✅ Теги добавлены: <b>${tags.join(", ")}</b>`;
        if (matched.length > 0) reply += `\n👤 Задачи назначены: <b>${matched.join(", ")}</b>`;
        await sendMessage(chatId, reply);
      } else if (action?.startsWith("task_date_")) {
        await clearSession(chatId);
        const taskId = action.replace("task_date_", "");
        const today = new Date().toISOString().split("T")[0];
        const parsed = await chatComplete(
          `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Верни ТОЛЬКО дату в этом формате, без пояснений. Если не можешь распознать — верни "null".`,
          text.trim()
        );
        const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
        if (!due) { await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз."); }
        else {
          await supabase.from("tasks").update({ due_date: due }).eq("id", taskId);
          const dueFmt = new Date(due + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
          await sendMessage(chatId, `📅 Дедлайн: <b>${dueFmt}</b>`);
        }
      } else if (action?.startsWith("task_title_")) {
        await clearSession(chatId);
        const taskId = action.replace("task_title_", "");
        await supabase.from("tasks").update({ title: text.trim() }).eq("id", taskId);
        await sendMessage(chatId, `✅ Название обновлено: <b>${text.trim()}</b>`);
      } else if (action?.startsWith("task_url_")) {
        await clearSession(chatId);
        const taskId = action.replace("task_url_", "");
        await supabase.from("tasks").update({ url: text.trim() }).eq("id", taskId);
        await sendMessage(chatId, `🔗 Ссылка сохранена.`);
      } else if (action?.startsWith("task_comment_")) {
        await clearSession(chatId);
        const taskId = action.replace("task_comment_", "");
        await supabase.from("task_comments").insert({ task_id: taskId, content: text.trim(), added_by: username });
        await sendMessage(chatId, `💬 Комментарий добавлен.`);
        await showTaskComments(chatId, taskId);
      } else if (action === "onboard_role") {
        await clearSession(chatId);
        await supabase.from("user_profiles").upsert({ telegram_id: userId, role: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
        await setSession(chatId, "onboard_markets");
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "✅ Роль сохранена!\n\n<b>Шаг 2/4.</b> За какие рынки/страны отвечаешь?\n\n<i>Перечисли через запятую: Словения, Болгария, Румыния</i>", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_markets" }]] } }),
        });
      } else if (action === "onboard_markets") {
        await clearSession(chatId);
        const markets = text.split(",").map(s => s.trim()).filter(Boolean);
        await supabase.from("user_profiles").upsert({ telegram_id: userId, markets, updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
        await setSession(chatId, "onboard_email");
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "✅ Рынки сохранены!\n\n<b>Шаг 3/4.</b> Рабочий email?", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_email" }]] } }),
        });
      } else if (action === "onboard_email") {
        await clearSession(chatId);
        await supabase.from("user_profiles").upsert({ telegram_id: userId, email: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
        await setSession(chatId, "onboard_phone");
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "✅ Email сохранён!\n\n<b>Шаг 4/4.</b> Номер телефона? (необязательно)", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_phone" }]] } }),
        });
      } else if (action === "onboard_phone") {
        await clearSession(chatId);
        await supabase.from("user_profiles").upsert({ telegram_id: userId, phone: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
        await sendMessage(chatId, "✅ Готово! Профиль заполнен.", buildKeyboard());
        await showProfile(chatId, userId);
      } else if (action?.startsWith("profile_")) {
        await clearSession(chatId);
        const parts = action.split("_");
        const targetId = Number(parts[1]);
        const field = parts.slice(2).join("_");
        await handleProfileEdit(chatId, targetId, field, text);
      } else {
        // Free text → always search (user uses buttons to add explicitly)
        if (text.length >= 3) {
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
      await sendInlineMessage(chatId,
        `<b>Добро пожаловать в Swarm!</b> 👋\n\nЭто командная база знаний команды.\n\nЧтобы бот правильно назначал задачи и присылал релевантный дайджест — заполни профиль.`,
        [[{ text: "👤 Заполнить профиль", callback_data: "start_onboard" }]]
      );
      await sendMessage(chatId, getHelpText(), buildKeyboard());
    } else if (command === "/help" || text === "ℹ️ Помощь") {
      await sendMessage(chatId, getHelpText(), buildKeyboard());
    } else if (command === "/add" || text === "📥 Добавить") {
      await handleAdd(chatId, username, argText);
    } else if (command === "/ask" || text === "❓ Спросить") {
      await handleAsk(chatId, argText.trim() ? argText : "");
    } else if (command === "/users" || text === "👥 Пользователи") {
      await handleUsers(chatId, userId, argText);
    } else if (command === "/tasks" || text === "📋 Задачи") {
      await handleTasks(chatId, argText);
    } else if (text === "🎙 Встречи" || text === "🎙 Read.ai" || command === "/readai") {
      const { count } = await supabase.from("entries").select("*", { count: "exact", head: true }).eq("source", "read_ai");
      await sendMessage(chatId, `<b>🎙 Встречи</b>\nСохранено: ${count ?? 0}\n<i>Встречи сохраняются автоматически после завершения.</i>`, {
        inline_keyboard: [
          [{ text: "📋 Сохранённые встречи", callback_data: "rai_saved" }],
        ],
      });
      if (text === "🎙 Read.ai") {
        await sendMessage(chatId, "Кнопка переименована в «🎙 Встречи».", buildKeyboard());
      }
    } else if (command === "/digest") {
      const sub = argText.trim().toLowerCase();
      if (sub === "on" || sub === "off") {
        const enabled = sub === "on";
        await supabase.from("user_profiles").upsert({
          telegram_id: userId,
          digest_enabled: enabled,
          updated_at: new Date().toISOString(),
        }, { onConflict: "telegram_id" });
        await sendMessage(chatId, enabled ? "✅ Еженедельный дайджест включён." : "🔕 Дайджест отключён.");
      } else {
        const days = sub ? parseInt(sub) || 7 : 7;
        await generatePersonalDigest(chatId, userId, days);
      }
    } else if (command === "/reindex") {
      {
        // Only process entries without metadata yet
        const { data: entries } = await supabase
          .from("entries").select("id, content, summary")
          .or("countries.eq.{},entry_type.eq.note,entry_type.is.null")
          .order("created_at", { ascending: false });
        const all = (entries ?? []) as Array<{ id: string; content: string; summary?: string }>;
        await sendMessage(chatId, `⏳ Обновляю метаданные: <b>${all.length}</b> записей...`);
        let updated = 0, skipped = 0;
        const BATCH = 5;
        for (let i = 0; i < all.length; i += BATCH) {
          const batch = all.slice(i, i + BATCH);
          await Promise.all(batch.map(async (entry) => {
            try {
              const textForMeta = entry.summary ?? entry.content;
              const meta = await extractEntryMeta(textForMeta);
              const updateData: Record<string, unknown> = {
                countries: meta.countries,
                entry_type: meta.entry_type,
                entry_date: meta.entry_date,
              };
              if (!entry.summary) {
                const isNonRussian = entry.content.length > 100 &&
                  (entry.content.match(/[a-zA-Z]/g) ?? []).length > entry.content.length * 0.3;
                if (isNonRussian) {
                  const keywords = await chatComplete(
                    "Извлеки ключевые слова и переведи на русский. Одна строка через запятую.",
                    entry.content.slice(0, 3000)
                  );
                  updateData.embedding = await getEmbedding(`[Ключевые слова: ${keywords}]\n\n${entry.content}`);
                }
              }
              await supabase.from("entries").update(updateData).eq("id", entry.id);
              updated++;
            } catch { skipped++; }
          }));
          if (i + BATCH < all.length) {
            await sendMessage(chatId, `⏳ Обработано ${Math.min(i + BATCH, all.length)}/${all.length}...`);
          }
        }
        await sendMessage(chatId, `✅ Готово! Обновлено: <b>${updated}</b> записей\nОшибок: <b>${skipped}</b>`);
      }
    } else if (command === "/status") {
      {
        const { data: lastMeeting } = await supabase
          .from("entries").select("metadata, created_at").eq("source", "read_ai")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const { count: totalMeetings } = await supabase
          .from("entries").select("*", { count: "exact", head: true }).eq("source", "read_ai");
        const { count: pendingTasks } = await supabase
          .from("tasks").select("*", { count: "exact", head: true }).eq("status", "pending");
        const { count: openTasks } = await supabase
          .from("tasks").select("*", { count: "exact", head: true }).eq("status", "open");

        let statusMsg = `<b>📊 Статус Swarm Brain</b>\n\n`;
        statusMsg += `🎙 Встреч в базе: <b>${totalMeetings ?? 0}</b>\n`;
        if (lastMeeting) {
          const lastDate = new Date(lastMeeting.created_at);
          const hoursAgo = Math.round((Date.now() - lastDate.getTime()) / 3_600_000);
          const title = (lastMeeting.metadata?.title as string) ?? "Без названия";
          const freshness = hoursAgo < 24 ? `${hoursAgo} ч назад ✅` : hoursAgo < 72 ? `${Math.round(hoursAgo / 24)} дн назад ⚠️` : `${Math.round(hoursAgo / 24)} дн назад ❌`;
          statusMsg += `📅 Последняя: <b>${title}</b> — ${freshness}\n`;
        } else {
          statusMsg += `📅 Последняя встреча: <b>не найдена</b> ❌\n`;
        }
        statusMsg += `\n⏳ Задач на подтверждении: <b>${pendingTasks ?? 0}</b>`;
        statusMsg += `\n✅ Активных задач: <b>${openTasks ?? 0}</b>`;
        await sendMessage(chatId, statusMsg);
      }
    } else if (command === "/connect") {
      await handleConnect(chatId);
    } else if (command === "/meetings") {
      await handleMeetings(chatId, argText ? parseInt(argText) || 24 : 24);
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
