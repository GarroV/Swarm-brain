import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { getEmbedding, chatComplete } from "./openai.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

export function visibilityFilter(userId: number): string {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}

export async function extractEntryMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
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

export async function saveEntry(content: string, addedBy: string, source: string, metadata: Record<string, unknown> = {}, summary?: string, groupId?: string, isPrivate = false, ownerId?: number): Promise<string> {
  if (isPrivate && !ownerId) throw new Error("saveEntry: ownerId required when isPrivate=true");
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

  // === Stripped down: only embedding, no auto-tagging ===
  const embedding = await getEmbedding(indexContent.slice(0, 8000));

  const { data, error } = await supabase.from("entries").insert({
    content,
    summary: summary ?? null,
    embedding,
    added_by: addedBy,
    source,
    metadata,
    /* === DISABLED: countries/entry_type/entry_date auto-detection — kept for future re-enable === */
    // countries: entryMeta.countries,
    // entry_type: entryMeta.entry_type,
    // entry_date: entryMeta.entry_date,
    group_id: groupId ?? null,
    is_private: isPrivate,
    owner_id: ownerId ?? null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// ── Session ───────────────────────────────────────────────────────────────────

export async function getSession(chatId: number): Promise<{ action: string; context?: string } | null> {
  const { data, error } = await supabase.from("sessions")
    .select("action, context")
    .eq("chat_id", chatId).maybeSingle();
  if (error) console.error("[getSession] error:", JSON.stringify(error));
  if (!data) return null;
  return data;
}

export async function setSession(chatId: number, action: string, context?: string): Promise<void> {
  const { error } = await supabase.from("sessions").upsert(
    { chat_id: chatId, action, context: context ?? null },
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

export async function uploadToStorage(
  fileName: string,
  buffer: ArrayBuffer,
  mimeType: string,
  folder: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const safeName = fileName.replace(/[^a-zA-Zа-яёА-ЯЁ0-9.\-_]/g, "_");
    const path = `${folder}/${date}_${safeName}`;

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
