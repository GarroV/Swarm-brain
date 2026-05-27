import { supabase } from "../lib/supabase.ts";
import { chatComplete } from "../lib/openai.ts";
import { sendMessage } from "../lib/telegram.ts";
import { saveEntry } from "../lib/storage.ts";

export async function generatePersonalDigest(
  chatId: number,
  userId: number,
  daysBack: number = 7,
): Promise<void> {
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
    .select("summary, content, source, created_at")
    .gte("created_at", since)
    .not("source", "eq", "digest")
    .order("created_at", { ascending: false })
    .limit(50);

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

  type EntryRow = { summary: string | null; content: string; source: string; created_at: string };
  const relevant = (entries as EntryRow[]).filter(e => {
    const lower = (e.summary ?? e.content).toLowerCase();
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
    const text = (e.summary ?? e.content).slice(0, 300);
    return `[${e.source} · ${date}] ${text}`;
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
    entriesText.slice(0, 8000),
  );

  const digestContent = `Дайджест за ${periodLabel} · ${userName || `ID ${userId}`}\n\n${digest}`;
  await saveEntry(digestContent, "system", "digest", { period: periodLabel, days_back: daysBack, user_id: userId });

  let remaining = `<b>📊 Твой дайджест ${periodLabel}</b>\n\n${digest}`;
  while (remaining.length > 0) {
    await sendMessage(chatId, remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }
}

export async function sendAllDigests(daysBack: number = 7): Promise<void> {
  const { data: users } = await supabase.from("user_profiles")
    .select("telegram_id, digest_enabled")
    .eq("digest_enabled", true);

  for (const u of (users ?? []) as Array<{ telegram_id: number }>) {
    try {
      await generatePersonalDigest(u.telegram_id, u.telegram_id, daysBack);
    } catch { /* skip failed user */ }
  }
}
