import { supabase } from "../lib/supabase.ts";
import { sendInlineMessage, sendMessage } from "../lib/telegram.ts";
import { ENTRY_MEETING_SOURCES } from "../../_shared/sources.ts";
import {
  formatReminder,
  groupByOwner,
  isWorkingHours,
  type ReminderRow,
  selectDueReminders,
  STALE_HOURS,
} from "./review-reminders.ts";

const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";

interface EntryRow {
  id: string;
  owner_id: number | null;
  metadata: Record<string, unknown> | null;
  entry_date: string | null;
  created_at: string;
  last_review_reminded_at: string | null;
}

// Крон (почасовой) → шлёт владельцам напоминания про их невычитанные встречи.
// Гейт рабочих часов Белграда — здесь; вне их тик молча пропускается.
export async function sendReviewReminders(now: Date = new Date()): Promise<void> {
  if (!isWorkingHours(now)) return;

  // Невычитанные встречи-записи (metadata.confirmed != true), достаточно старые (> 48ч по created_at).
  const staleISO = new Date(now.getTime() - STALE_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("entries")
    .select("id, owner_id, metadata, entry_date, created_at, last_review_reminded_at")
    .eq("entry_type", "meeting")
    .in("source", ENTRY_MEETING_SOURCES)
    .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false")
    .lt("created_at", staleISO)
    .limit(2000);
  if (error) {
    console.error("[review-reminders] query:", error.message);
    return;
  }

  const rows: ReminderRow[] = ((data ?? []) as EntryRow[]).map((e) => ({
    id: e.id,
    owner_id: e.owner_id,
    title: (e.metadata?.title as string) ?? "Без названия",
    meetingDate: (e.metadata?.entry_date as string) ?? e.entry_date ?? e.created_at.split("T")[0],
    created_at: e.created_at,
    last_review_reminded_at: e.last_review_reminded_at,
  }));

  const due = selectDueReminders(rows, now);
  if (!due.length) return;

  const nowISO = now.toISOString();
  for (const [ownerId, ownerRows] of groupByOwner(due)) {
    const { text, keyboard } = formatReminder(ownerRows, WEB_BASE_URL);
    try {
      if (keyboard.length) await sendInlineMessage(ownerId, text, keyboard);
      else await sendMessage(ownerId, text);
    } catch (e) {
      // Не смогли написать (владелец не запускал бота / заблокировал) — НЕ помечаем как
      // напомненные, чтобы попробовать снова на следующем тике.
      console.error(`[review-reminders] send to ${ownerId}:`, (e as Error).message);
      continue;
    }
    const ids = ownerRows.map((r) => r.id);
    const { error: updErr } = await supabase
      .from("entries")
      .update({ last_review_reminded_at: nowISO })
      .in("id", ids);
    if (updErr) console.error(`[review-reminders] mark reminded ${ownerId}:`, updErr.message);
  }
}
