import { supabase } from "../lib/supabase.ts";
import { notifyMessage } from "../lib/notify.ts";
import { groupByRecipient, pingRecipients, pingSendingOpen, scopePingRow, todayIn } from "./task-pings.ts";
import {
  asPingRow,
  dueReminderWindowOpen,
  type DueRow,
  formatDueReminders,
  isDueReminderDue,
  settleDueReminder,
} from "./task-due-reminders.ts";
import { addDays } from "../../_shared/tasks/due.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";
import { loadMembershipIndex } from "../../_shared/tasks/recipients-scope.ts";

const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";
const SELECT_DUE =
  "id, title, group_id, remind_date, reminded_at, due_date, status, assignee_telegram_ids, created_by_telegram_id, remind_set_by, archived_at, created_at, due_reminded_for, due_reminder_delivered_to";
// Со сроком на завтра бывает много задач (срок по умолчанию — завтра, и закрытые среди них тоже).
const MAX_PER_TICK = 1000;

// Крон (раз в час, после ручных пингов) → напоминает о сроке за день, только утром: с 9:00 до 13:00
// по Москве (`dueReminderWindowOpen`). Закрытых отсекает `isDueReminderDue` — единственное место правила.
// Возвращает число задач, по которым напоминание отработано (дошло всем).
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  if (!pingSendingOpen(now) || !dueReminderWindowOpen(now)) return 0;
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

  const dueAll = ((data ?? []) as DueRow[]).filter((r) => isDueReminderDue(r, today));
  if (!dueAll.length) return 0;

  // Получатели — только те, кто сейчас в воркспейсе задачи. Без ответа о членстве не шлём никому:
  // срок не гасится, и следующий тик того же окна попробует снова.
  let due: DueRow[];
  try {
    const isMember = await loadMembershipIndex(
      supabase,
      dueAll.map((r) => ({
        groupId: r.group_id,
        ids: [...(r.assignee_telegram_ids ?? []), r.created_by_telegram_id, r.remind_set_by],
      })),
    );
    due = dueAll.map((r) => scopePingRow(r, (id) => isMember(r.group_id, id)));
  } catch (e) {
    console.error("[due-reminders] membership:", (e as Error).message);
    return 0;
  }

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
        group_id: r.group_id ?? null,
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
