import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { getEmbedding, chatComplete } from "./openai.ts";
import { normalizeCountries } from "../../_shared/countries.ts";


export function visibilityFilter(userId: number): string {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}

// ── Entry index ───────────────────────────────────────────────────────────────

type EntryIndex = {
  summary: string | null;
  countries: string[];
  entry_type: string;
  entry_date: string | null;
  keywords: string;
};

// Single GPT call that generates summary (if not provided) + countries + type + date + keywords.
// existingSummary: pass when the caller already has a summary (e.g. Granola tezisy, voice transcript).
async function buildEntryIndex(content: string, existingSummary?: string): Promise<EntryIndex> {
  const hasSummary = Boolean(existingSummary?.trim());
  const system = hasSummary
    ? "Проанализируй текст и верни JSON (только JSON, без markdown):\n" +
      '{"countries":["Serbia","Moldova"],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}\n\n' +
      "countries — конкретные страны/рынки из текста. Короткое английское название: Serbia, Montenegro, Moldova, Croatia, Lithuania. " +
      "Если текст общекомандный без привязки к стране — пустой массив [].\n" +
      "entry_type — тип записи.\n" +
      "entry_date — дата события из текста (не сегодняшняя), null если нет.\n" +
      "keywords — 5-8 ключевых слов и синонимов для поиска через запятую."
    : "Проанализируй текст и верни JSON (только JSON, без markdown):\n" +
      '{"summary":"тезисы","countries":["Serbia"],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}\n\n' +
      "summary — 3-5 тезисов маркированным списком на русском: конкретные факты, имена, цифры, решения. Без общих фраз.\n" +
      "countries — конкретные страны/рынки из текста. Короткое английское название: Serbia, Montenegro, Moldova, Croatia, Lithuania. " +
      "Если текст общекомандный без привязки к стране — пустой массив [].\n" +
      "entry_type — тип записи.\n" +
      "entry_date — дата события из текста (не сегодняшняя), null если нет.\n" +
      "keywords — 5-8 ключевых слов и синонимов для поиска через запятую.";
  try {
    const raw = await chatComplete(system, content.slice(0, 5000));
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      summary: hasSummary ? existingSummary! : (typeof parsed.summary === "string" ? parsed.summary : null),
      countries: normalizeCountries(Array.isArray(parsed.countries) ? (parsed.countries as unknown[]).filter((c): c is string => typeof c === "string") : []),
      entry_type: typeof parsed.entry_type === "string" ? parsed.entry_type : "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
      keywords: typeof parsed.keywords === "string" ? parsed.keywords : "",
    };
  } catch {
    return { summary: existingSummary ?? null, countries: [], entry_type: "note", entry_date: null, keywords: "" };
  }
}

// extractEntryMeta kept for backward-compat (granola.ts still imports it).
export async function extractEntryMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
  const idx = await buildEntryIndex(text, "placeholder"); // hasSummary=true → skip summary gen
  // buildEntryIndex with placeholder still extracts countries/type/date
  // Re-run without placeholder to get real meta-only result
  try {
    const raw = await chatComplete(
      "Проанализируй текст и верни JSON (только JSON, без markdown):\n" +
      '{"countries":["Serbia","Bulgaria"...],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null"}\n\n' +
      "countries — страны/рынки. Короткое английское название: Serbia, Montenegro, Moldova. Если общекомандный текст — [].\n" +
      "entry_type — тип записи.\nentry_date — дата события из текста, null если нет.",
      text.slice(0, 4000)
    );
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      countries: normalizeCountries(Array.isArray(parsed.countries) ? parsed.countries : []),
      entry_type: parsed.entry_type ?? "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch { return { countries: idx.countries, entry_type: idx.entry_type, entry_date: idx.entry_date }; }
}

export async function saveEntry(
  content: string,
  addedBy: string,
  source: string,
  metadata: Record<string, unknown> = {},
  summary?: string,
  groupId?: string,
  isPrivate = false,
  ownerId?: number,
  // Поисковый индекс (синонимы/ключевые слова) — эмбеддится для recall, но НЕ кладётся в
  // видимый summary. Для коротких заметок, где summary иначе оставался бы синоним-мусором.
  searchText?: string,
): Promise<{ id: string; summary: string | null }> {
  if (isPrivate && !ownerId) throw new Error("saveEntry: ownerId required when isPrivate=true");

  // Short notes (source='note') need no country extraction — always General.
  let index: EntryIndex;
  if (source === "note") {
    index = { summary: summary ?? null, countries: [], entry_type: "note", entry_date: null, keywords: "" };
  } else {
    index = await buildEntryIndex(content, summary);
  }

  // General tag: entries with no specific country or broad coverage (3+ countries).
  const countries = [...index.countries];
  const specific = countries.filter(c => c !== "General");
  if (specific.length === 0 || specific.length >= 3) {
    if (!countries.includes("General")) countries.push("General");
  }

  // Enriched embedding: (searchText | summary | content) + countries + keywords.
  // searchText эмбеддится тем же текстом, что раньше лежал в summary → recall не меняется,
  // но summary остаётся чистым для отображения.
  const embeddingParts = [
    searchText ?? index.summary ?? content,
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
    index.keywords ? `Ключевые слова: ${index.keywords}` : "",
  ].filter(Boolean);
  const embedding = await getEmbedding(embeddingParts.join("\n").slice(0, 8000));

  const { data, error } = await supabase.from("entries").insert({
    content,
    summary: index.summary,
    embedding,
    added_by: addedBy,
    source,
    metadata,
    countries,
    entry_type: index.entry_type,
    entry_date: index.entry_date,
    group_id: groupId ?? null,
    is_private: isPrivate,
    owner_id: ownerId ?? null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, summary: index.summary };
}

// ── Session ───────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function getSession(chatId: number): Promise<{ action: string; context?: string } | null> {
  const { data, error } = await supabase.from("sessions")
    .select("action, context, updated_at")
    .eq("chat_id", chatId).maybeSingle();
  if (error) console.error("[getSession] error:", JSON.stringify(error));
  if (!data) return null;
  const row = data as { action: string; context?: string; updated_at?: string };
  if (row.updated_at && Date.now() - new Date(row.updated_at).getTime() > SESSION_TTL_MS) {
    await supabase.from("sessions").delete().eq("chat_id", chatId);
    return null;
  }
  return { action: row.action, context: row.context };
}

export async function setSession(chatId: number, action: string, context?: string): Promise<void> {
  const { error } = await supabase.from("sessions").upsert(
    { chat_id: chatId, action, context: context ?? null, updated_at: new Date().toISOString() },
    { onConflict: "chat_id" }
  );
  if (error) console.error("[setSession] error:", JSON.stringify(error));
}

export async function clearSession(chatId: number): Promise<void> {
  await supabase.from("sessions").delete().eq("chat_id", chatId);
}

// ── Access control ────────────────────────────────────────────────────────────

export async function checkAllowed(userId: number, username?: string): Promise<boolean> {
  if (userId === ADMIN_USER_ID) return true;
  const { data } = await supabase.from("allowed_users").select("telegram_id").eq("telegram_id", userId).maybeSingle();
  if (data) return true;
  if (username) {
    const { data: pendingRows } = await supabase.from("allowed_users")
      .select("id").eq("username", username).is("telegram_id", null).limit(1);
    const pending = pendingRows?.[0];
    if (pending) {
      await supabase.from("allowed_users").update({ telegram_id: userId }).eq("id", pending.id);
      return true;
    }
  }
  return false;
}

export async function generateSummary(text: string): Promise<string | null> {
  if (text.length < 80) return null;
  try {
    return await chatComplete(
      "Сделай краткие тезисы из текста. Только конкретные факты: имена, цифры, решения, даты. Без общих фраз. 3–7 пунктов. Маркированный список на русском.",
      text.slice(0, 6000)
    );
  } catch { return null; }
}

const RU_TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Build an ASCII-safe Supabase Storage object key. Storage keys reject
 * non-ASCII (Cyrillic etc.) — transliterate, strip the rest, keep it readable.
 */
function safeStorageName(fileName: string): string {
  const translit = [...fileName].map((ch) => {
    const lower = ch.toLowerCase();
    const mapped = RU_TRANSLIT[lower];
    if (mapped === undefined) return ch;
    return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join("");
  const ascii = translit.replace(/[^a-zA-Z0-9.\-_]/g, "_").replace(/_+/g, "_");
  return ascii.replace(/^_+|_+$/g, "") || "file";
}

export async function uploadToStorage(
  fileName: string,
  buffer: ArrayBuffer,
  mimeType: string,
  folder: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const safeName = safeStorageName(fileName);
    const path = `${folder}/${date}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;

    const { error } = await supabase.storage
      .from("swarm_drive")
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (error) return { url: null, error: error.message };

    const { data: { publicUrl } } = supabase.storage.from("swarm_drive").getPublicUrl(path);
    return { url: publicUrl, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function autoSyncProfile(userId: number, firstName?: string, lastName?: string, username?: string): Promise<void> {
  const update: Record<string, unknown> = { telegram_id: userId, updated_at: new Date().toISOString() };
  if (firstName) update.first_name = firstName;
  if (lastName !== undefined) update.last_name = lastName;
  if (username) update.username = username;
  await supabase.from("user_profiles").upsert(update, { onConflict: "telegram_id", ignoreDuplicates: false });
  if (username) {
    await supabase.from("allowed_users").update({ username }).eq("telegram_id", userId);
  }
}
