import { supabase } from "../lib/supabase.ts";
import { notifyMessage } from "../lib/notify.ts";
import { groupByRecipient, pingRecipients, pingSendingOpen, todayIn } from "./task-pings.ts";
import {
  asPingRow,
  type DueRow,
  formatDueReminders,
  isDueReminderDue,
  settleDueReminder,
} from "./task-due-reminders.ts";
import { addDays } from "../../_shared/tasks/due.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";

const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";
const SELECT_DUE =
  "id, title, remind_date, reminded_at, due_date, status, assignee_telegram_ids, created_by_telegram_id, remind_set_by, archived_at, created_at, due_reminded_for, due_reminder_delivered_to";
// Со сроком на завтра бывает много задач (срок по умолчанию — завтра, и закрытые среди них тоже).
const MAX_PER_TICK = 1000;

// Крон (раз в час, после ручных пингов) → напоминает о сроке за день. До 9:00 по Москве молчит,
// как и пинги. Закрытых отсекает `isDueReminderDue` — единственное место правила.
// Возвращает число задач, по которым напоминание отработано (дошло всем).
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  if (!pingSendingOpen(now)) return 0;
  const today = todayIn(now);
  const tomorrow = addDays(today, 1);
  const { data, error } = await onlyLive(supabase.from("tasks").select(SELECT_DUE))
    .eq("due_date", tomorrow)
    .or(`due_reminded_for.is.null,due_reminded_for.neq.${tomorrow}`)
    .limit(MAX_PER_TICK);
  if (error) {
    console.error("[due-reminders] query:", error.message);
    return 0;
  }

  const due = ((data ?? []) as DueRow[]).filter((r) => isDueReminderDue(r, today));
  if (!due.length) return 0;

  const deliveredNow = new Map<string, number[]>();
  for (const [recipientId, rows] of groupByRecipient(due.map(asPingRow))) {
    const { text, keyboard } = formatDueReminders(rows, WEB_BASE_URL);
    try {
      await notifyMessage(recipientId, text, "task_due_reminder", keyboard.length ? keyboard : undefined);
    } catch (e) {
      // Не дошло (не запускал бота / заблокировал) — попробуем на следующем тике того же дня.
      console.error(`[due-reminders] send to ${recipientId}:`, (e as Error).message);
      continue;
    }
    for (const r of rows) deliveredNow.set(r.id, [...(deliveredNow.get(r.id) ?? []), recipientId]);

    const { error: notifErr } = await supabase.from("notifications").insert(
      rows.map((r) => ({
        recipient_telegram_id: recipientId,
        type: "task_due_soon",
        task_id: r.id,
        actor_telegram_id: null,
      })),
    );
    if (notifErr) console.error(`[due-reminders] notifications insert ${recipientId}:`, notifErr.message);
  }

  const settled: DueRow[] = [];
  for (const r of due) {
    const s = settleDueReminder(r, deliveredNow.get(r.id) ?? []);
    if (s.done) {
      if (!pingRecipients(r).length) console.warn(`[due-reminders] некому напомнить о сроке задачи ${r.id} — гасим`);
      settled.push(r);
      continue;
    }
    if (s.delivered.length === (r.due_reminder_delivered_to ?? []).length) continue;
    const { error: updErr } = await supabase.from("tasks").update({ due_reminder_delivered_to: s.delivered }).eq(
      "id",
      r.id,
    );
    if (updErr) console.error(`[due-reminders] remember delivered ${r.id}:`, updErr.message);
  }
  if (!settled.length) return 0;
  // Срок у всех отобранных один — завтрашний, поэтому одним запросом.
  const { error: markErr } = await supabase
    .from("tasks")
    .update({ due_reminded_for: tomorrow })
    .in("id", settled.map((r) => r.id));
  if (markErr) console.error("[due-reminders] mark reminded:", markErr.message);
  return settled.length;
}
