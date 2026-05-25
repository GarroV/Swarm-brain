import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRANOLA_API = "https://public-api.granola.ai/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Integration = {
  id: string;
  telegram_id: number;
  api_key: string;
  last_polled_at: string | null;
  skipped_note_ids: string[];
};

type GranolaNote = {
  id: string;
  title: string;
  created_at: string;
  calendar_event?: { scheduled_start_time?: string };
  attendees?: Array<{ name?: string; email?: string }>;
};

async function sendTelegram(chatId: number, text: string, keyboard: Array<Array<{ text: string; callback_data: string }>>): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function fetchNotesSince(apiKey: string, createdAfter: string): Promise<GranolaNote[]> {
  const res = await fetch(
    `${GRANOLA_API}/notes?created_after=${encodeURIComponent(createdAfter)}&limit=20`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) return [];
  const data = await res.json() as { notes: GranolaNote[] };
  return data.notes ?? [];
}

async function getSavedNoteIds(telegramId: number): Promise<Set<string>> {
  const { data } = await supabase
    .from("entries")
    .select("metadata")
    .eq("source", "granola")
    .eq("metadata->>added_by_telegram_id", String(telegramId));
  return new Set(
    (data ?? [])
      .map((e: { metadata: Record<string, unknown> }) => e.metadata?.granola_note_id as string)
      .filter(Boolean)
  );
}

async function pollUser(integration: Integration): Promise<number> {
  const since = integration.last_polled_at
    ?? new Date(Date.now() - 2 * 3_600_000).toISOString();

  const allNotes = await fetchNotesSince(integration.api_key, since);
  if (!allNotes.length) return 0;

  const savedIds = await getSavedNoteIds(integration.telegram_id);
  const skippedIds = new Set(integration.skipped_note_ids ?? []);
  const newNotes = allNotes.filter((n) => !savedIds.has(n.id) && !skippedIds.has(n.id));

  for (const note of newNotes) {
    const title = note.title || "Встреча";
    const ts = note.calendar_event?.scheduled_start_time ?? note.created_at;
    const date = new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    const attendeeNames = (note.attendees ?? [])
      .map((a) => a.name || a.email || "").filter(Boolean).slice(0, 4).join(", ");

    let text = `📓 <b>Новая встреча Granola</b>\n<b>${title}</b>\n📅 ${date}`;
    if (attendeeNames) text += `\n👥 ${attendeeNames}`;
    text += `\n\nДобавить в базу знаний?`;

    await sendTelegram(integration.telegram_id, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
  }

  return newNotes.length;
}

Deno.serve(async () => {
  const now = new Date().toISOString();

  const { data: integrations, error } = await supabase
    .from("user_integrations")
    .select("id, telegram_id, api_key, last_polled_at, skipped_note_ids")
    .eq("service", "granola");

  if (error) return new Response("DB error", { status: 500 });
  if (!integrations?.length) return new Response("No integrations", { status: 200 });

  let total = 0;
  for (const integration of integrations as Integration[]) {
    try {
      const count = await pollUser(integration);
      total += count;
    } catch (err) {
      console.error(`Error polling user ${integration.telegram_id}:`, err);
    }
    // Update cursor regardless of errors
    await supabase
      .from("user_integrations")
      .update({ last_polled_at: now })
      .eq("id", integration.id);
  }

  return new Response(`Processed ${total} new notes for ${integrations.length} users`, { status: 200 });
});
