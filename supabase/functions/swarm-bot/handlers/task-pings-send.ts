import { supabase } from "../lib/supabase.ts";
import { sendInlineMessage, sendMessage } from "../lib/telegram.ts";
import {
  formatPings,
  groupByRecipient,
  isPingDue,
  pingRecipients,
  type PingRow,
  settlePing,
  todayIn,
} from "./task-pings.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";

const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "";
const SELECT_PING =
  "id, title, remind_date, due_date, status, is_private, assignee_telegram_ids, created_by_telegram_id, remind_set_by, owner_id, ping_delivered_to, archived_at";
// Разумный потолок на тик: пинги ставят руками, сотнями за раз они не наступают.
const MAX_PER_TICK = 500;

// Крон → шлёт наступившие пинги. Пинг одноразовый: отправили — гасим (`reminded_at`), поэтому
// гейта рабочих часов здесь НЕТ (в отличие от напоминаний о вычитке): день выбрал человек, а
// тик крона стоит на утро — переносить его на следующий день значило бы опоздать на сутки.
export async function sendTaskPings(now: Date = new Date()): Promise<number> {
  const today = todayIn(now);
  // Архивная задача пинг не шлёт (#575): человек её убрал, и напоминание о ней — призрак.
  const { data, error } = await onlyLive(supabase.from("tasks").select(SELECT_PING))
    .not("remind_date", "is", null)
    .is("reminded_at", null)
    .lte("remind_date", today)
    .limit(MAX_PER_TICK);
  if (error) {
    console.error("[task-pings] query:", error.message);
    return 0;
  }

  // Статус фильтруем в коде: `isPingDue` — единственное место, где живёт правило «закрытую
  // задачу не пингуем» (оно же покрыто тестами), дублировать его в запросе нельзя — разойдётся.
  const due = ((data ?? []) as PingRow[]).filter((r) => isPingDue(r, today));
  if (!due.length) return 0;

  const nowISO = now.toISOString();
  // Кому пинг дошёл на ЭТОМ тике — по задаче. Гасит задачу не «дошло хоть кому-то», а
  // settlePing: дошло всем (с учётом прошлых тиков) или вышло окно повторов (#575).
  const deliveredNow = new Map<string, number[]>();

  const byRecipient = groupByRecipient(due);
  for (const [recipientId, rows] of byRecipient) {
    const { text, keyboard } = formatPings(rows, WEB_BASE_URL);
    try {
      if (keyboard.length) await sendInlineMessage(recipientId, text, keyboard);
      else await sendMessage(recipientId, text);
    } catch (e) {
      // Не смогли написать (не запускал бота / заблокировал) — пинг НЕ гасим: попробуем на
      // следующем тике. Иначе напоминание сгорело бы, ни разу никого не достигнув.
      console.error(`[task-pings] send to ${recipientId}:`, (e as Error).message);
      continue;
    }
    for (const r of rows) deliveredNow.set(r.id, [...(deliveredNow.get(r.id) ?? []), recipientId]);

    // Лента-колокольчик в вебе: пинг виден и там, а не только в Telegram.
    // actor_telegram_id = null — событие системное, у него нет автора.
    const { error: notifErr } = await supabase.from("notifications").insert(
      rows.map((r) => ({
        recipient_telegram_id: recipientId,
        type: "task_reminder",
        task_id: r.id,
        actor_telegram_id: null,
      })),
    );
    if (notifErr) console.error(`[task-pings] notifications insert ${recipientId}:`, notifErr.message);
  }

  return await settleTick(due, deliveredNow, today, nowISO);
}

// Записать итог тика: погашенные — одним запросом, недоставленные — по строке, запоминая,
// кому уже дошло (иначе следующий тик прислал бы им дубль).
async function settleTick(
  due: PingRow[],
  deliveredNow: Map<string, number[]>,
  today: string,
  nowISO: string,
): Promise<number> {
  const settled: string[] = [];
  for (const r of due) {
    const s = settlePing(r, deliveredNow.get(r.id) ?? [], today);
    if (s.done) {
      if (!pingRecipients(r).length) console.warn(`[task-pings] некому отправить пинг задачи ${r.id} — гасим`);
      if (s.gaveUp) console.warn(`[task-pings] пинг задачи ${r.id} дошёл не всем за окно повторов — гасим`);
      settled.push(r.id);
      continue;
    }
    if (s.delivered.length === (r.ping_delivered_to ?? []).length) continue;
    const { error } = await supabase.from("tasks").update({ ping_delivered_to: s.delivered }).eq("id", r.id);
    if (error) console.error(`[task-pings] remember delivered ${r.id}:`, error.message);
  }
  if (!settled.length) return 0;
  const { error: updErr } = await supabase
    .from("tasks")
    .update({ reminded_at: nowISO })
    .in("id", settled);
  if (updErr) console.error("[task-pings] mark reminded:", updErr.message);
  return settled.length;
}
