import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { getEmbedding, chatComplete } from "./openai.ts";
import { normalizeCountries, COUNTRY_PROMPT_RULE, ENTRY_TYPE_PROMPT_RULE } from "../../_shared/countries.ts";


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
  const schema = hasSummary
    ? '{"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}'
    : '{"summary":"тезисы","countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}';
  const summaryRule = hasSummary
    ? ""
    : "summary — 3-5 тезисов маркированным списком на русском: конкретные факты, имена, цифры, решения. Без общих фраз.\n";
  const system =
    "Проанализируй текст и верни JSON (только JSON, без markdown):\n" + schema + "\n\n" +
    summaryRule +
    COUNTRY_PROMPT_RULE + "\n" +
    ENTRY_TYPE_PROMPT_RULE + "\n" +
    "entry_date — дата события из текста (не сегодняшняя), null если нет.\n" +
    "keywords — 5-8 ключевых слов и синонимов для поиска через запятую.";
  try {
    const raw = await chatComplete(system, content.slice(0, 5000), { temperature: 0, json: true });
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      summary: hasSummary ? existingSummary! : (typeof parsed.summary === "string" ? parsed.summary : null),
      countries: normalizeCountries(Array.isArray(parsed.countries) ? (parsed.countries as unknown[]).filter((c): c is string => typeof c === "string") : []),
      entry_type: parsed.entry_type === "meeting" ? "meeting" : "note", // только два типа
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
      '{"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null"}\n\n' +
      COUNTRY_PROMPT_RULE + "\n" +
      ENTRY_TYPE_PROMPT_RULE + "\n" +
      "entry_date — дата события из текста, null если нет.",
      text.slice(0, 4000),
      { temperature: 0, json: true }
    );
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      countries: normalizeCountries(Array.isArray(parsed.countries) ? parsed.countries : []),
      entry_type: parsed.entry_type === "meeting" ? "meeting" : "note", // только два типа
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch { return { countries: idx.countries, entry_type: idx.entry_type, entry_date: idx.entry_date }; }
}

// Char-trigram Jaccard similarity — детект near-identical контента (повторная отправка
// с мелкой правкой). 1.0 = идентично; для разного текста быстро падает.
function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.replace(/\s+/g, " ").trim().toLowerCase();
    const g = new Set<string>();
    for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
    return g;
  };
  const A = grams(a), B = grams(b);
  if (A.size === 0 || B.size === 0) return A.size === B.size ? 1 : 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
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
): Promise<{ id: string; summary: string | null; duplicate?: boolean; merged?: boolean }> {
  if (isPrivate && !ownerId) throw new Error("saveEntry: ownerId required when isPrivate=true");

  // ── Дедуп + группировка фрагментов ──────────────────────────────────────────────
  // Только для ручных текстовых сохранений (add_knowledge: telegram/note). Source
  // document/pdf/voice/read_ai/digest НЕ дедупим: документы сохраняются чанками в
  // цикле — похожий чанк нельзя молча выкинуть (потеря части документа), а транскрипты
  // и дайджесты дедуп не требуют. Кандидаты — недавние записи той же видимости в воркспейсе.
  if (groupId && content.trim() && (source === "telegram" || source === "note")) {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const target = norm(content);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let cq = supabase.from("entries")
      .select("id, content, summary, added_by, source, created_at")
      .eq("group_id", groupId)
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false })
      .limit(40);
    cq = isPrivate ? cq.eq("is_private", true).eq("owner_id", ownerId!) : cq.eq("is_private", false);
    const { data: recent } = await cq;
    const cands = (recent ?? []) as Array<{ id: string; content: string; summary: string | null; added_by: string; source: string; created_at: string }>;

    // 1) NEAR-IDENTICAL дедуп: точный (по нормализации) ИЛИ ≥95% похожий (триграмы, только
    //    для существенного текста >100 симв) за неделю → не плодим дубль. Повторная
    //    отправка/вставка и отложенный дубль коллеги ловятся; реальная правка (<95%) сохраняется.
    for (const c of cands) {
      const cc = c.content ?? "";
      if (norm(cc) === target || (target.length > 100 && trigramSimilarity(content, cc) >= 0.95)) {
        return { id: c.id, summary: c.summary ?? null, duplicate: true };
      }
    }

    // 2) ГРУППИРОВКА ФРАГМЕНТОВ: тот же автор прислал ещё текст в окне ~60с (source=telegram —
    //    ручная отправка/вставка/форвард кусками) → дописываем к той записи и переиндексируем
    //    (summary/embedding/страны по объединённому тексту). Не near-dup (см. п.1 выше).
    if (source === "telegram") {
      const minuteAgo = Date.now() - 60_000;
      const frag = cands.find((c) => c.source === "telegram" && c.added_by === addedBy && Date.parse(c.created_at) >= minuteAgo);
      if (frag) {
        const merged = `${frag.content}\n\n${content}`;
        const midx = await buildEntryIndex(merged);
        const mc = [...midx.countries];
        const msp = mc.filter((x) => x !== "General");
        if (msp.length === 0 || msp.length >= 3) { if (!mc.includes("General")) mc.push("General"); }
        const memb = await getEmbedding([midx.summary ?? merged, msp.length ? `Страны: ${msp.join(", ")}` : "", midx.keywords ? `Ключевые слова: ${midx.keywords}` : ""].filter(Boolean).join("\n").slice(0, 8000));
        await supabase.from("entries").update({
          content: merged, summary: midx.summary, embedding: memb,
          // source=telegram → всегда note (см. ниже): текст в бота не идёт в ревью встреч.
          countries: mc, entry_type: "note", entry_date: midx.entry_date,
        }).eq("id", frag.id);
        return { id: frag.id, summary: midx.summary, merged: true };
      }
    }
  }

  // Short notes (source='note') need no country extraction — always General.
  let index: EntryIndex;
  if (source === "note") {
    index = { summary: summary ?? null, countries: [], entry_type: "note", entry_date: null, keywords: "" };
  } else {
    index = await buildEntryIndex(content, summary);
  }

  // Текст, присланный в бота (набранный/пересланный, source=telegram), — ВСЕГДА обычная запись,
  // а не «встреча»: ревью встреч предназначено только для авто-транскриптов (Granola/рекордер/
  // Read.ai). Иначе заметка вида «прошла встреча…» ошибочно попадала в очередь согласования встреч.
  if (source === "telegram" && index.entry_type === "meeting") {
    index = { ...index, entry_type: "note" };
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

// ── Управление записями (правка/удаление из чата) ──────────────────────────────

export class EntryAccessError extends Error {
  constructor(public kind: "not_found" | "forbidden") {
    super(kind);
  }
}

export type ManageableEntry = {
  id: string;
  group_id: string | null;
  is_private: boolean;
  owner_id: number | null;
  content: string;
  summary: string | null;
  source: string | null;
  entry_type: string | null;
  entry_date: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Загружает запись для правки/удаления с проверкой доступа:
 * воркспейс-изоляция (group_id) + приватность (общие — любой в воркспейсе,
 * приватные — только владелец). Бросает EntryAccessError.
 */
export async function getManageableEntry(id: string, userId: number, groupId: string): Promise<ManageableEntry> {
  const { data } = await supabase.from("entries")
    .select("id, group_id, is_private, owner_id, content, summary, source, entry_type, entry_date, metadata, created_at")
    .eq("id", id).maybeSingle();
  if (!data) throw new EntryAccessError("not_found");
  const e = data as ManageableEntry;
  if (e.group_id !== groupId) throw new EntryAccessError("forbidden");
  if (e.is_private && e.owner_id !== userId) throw new EntryAccessError("forbidden");
  return e;
}

/**
 * Полная замена контента записи: пересчитывает summary/countries/type/embedding
 * (как saveEntry). metadataPatch (если передан) — это ПОЛНЫЙ новый metadata-объект
 * (вызывающий мержит сам). Всегда фильтрует по group_id — никогда без WHERE.
 */
export async function updateEntryContent(
  id: string,
  groupId: string,
  newContent: string,
  metadataPatch?: Record<string, unknown>,
): Promise<void> {
  const index = await buildEntryIndex(newContent);
  const countries = [...index.countries];
  const specific = countries.filter((c) => c !== "General");
  if (specific.length === 0 || specific.length >= 3) {
    if (!countries.includes("General")) countries.push("General");
  }
  const embeddingParts = [
    index.summary ?? newContent,
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
    index.keywords ? `Ключевые слова: ${index.keywords}` : "",
  ].filter(Boolean);
  const embedding = await getEmbedding(embeddingParts.join("\n").slice(0, 8000));

  const updates: Record<string, unknown> = {
    content: newContent,
    summary: index.summary,
    embedding,
    countries,
    entry_type: index.entry_type,
    entry_date: index.entry_date,
    updated_at: new Date().toISOString(),
  };
  if (metadataPatch) updates.metadata = metadataPatch;

  const { error } = await supabase.from("entries").update(updates)
    .eq("id", id).eq("group_id", groupId);
  if (error) throw new Error(error.message);
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
  // username — НЕ колонка user_profiles (она в allowed_users). Раньше его клали в этот upsert
  // → весь upsert падал, и для юзеров с @username имя (first/last) не синкалось вовсе.
  await supabase.from("user_profiles").upsert(update, { onConflict: "telegram_id", ignoreDuplicates: false });
  if (username) {
    await supabase.from("allowed_users").update({ username }).eq("telegram_id", userId);
  }
}
