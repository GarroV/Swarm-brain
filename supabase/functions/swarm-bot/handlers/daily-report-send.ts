import { aggregateActivity, formatReport, type EntryRow, yesterdayWindow } from "./daily-report.ts";
import { ADMIN_USER_ID, supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";

export async function sendDailyReport(): Promise<void> {
  const { sinceISO, untilISO, dateLabel } = yesterdayWindow();
  const { data, error } = await supabase
    .from("entries")
    .select("entry_type, source, group_id")
    .gte("created_at", sinceISO)
    .lt("created_at", untilISO)
    .neq("source", "digest")
    .in("entry_type", ["meeting", "note"])
    .limit(5000);
  if (error) {
    await sendMessage(ADMIN_USER_ID, `⚠️ Свод за ${dateLabel}: ошибка запроса — ${error.message}`);
    return;
  }
  const report = formatReport(aggregateActivity((data ?? []) as EntryRow[]), dateLabel);
  await sendMessage(ADMIN_USER_ID, report);
}
