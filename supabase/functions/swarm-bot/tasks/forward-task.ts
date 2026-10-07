// Задача из пересланного сообщения — связка двух апдейтов Telegram (чистая часть —
// forward-task-core.ts).
//
// Пересылка с комментарием приходит боту ДВУМЯ сообщениями: сначала комментарий («добавь
// задачу»), следом пересланное. Обрабатываются они разными вызовами функции, иногда
// параллельно, поэтому пара держится в строке `sessions` чата:
//   • комментарий ставит `fwd_task_wait` и пару секунд ждёт, не заберёт ли его пересланное;
//     не забрало — просит переслать (ожидание живёт WAIT_TTL_MS);
//   • пересланное забирает `fwd_task_wait` удалением строки (забирает ровно один вызов) и
//     становится задачей: на отправителя, срок по умолчанию — завтра.
// Пересланное без такого комментария по-прежнему сохраняется записью в базу.
import { supabase } from "../lib/supabase.ts";
import { setSession } from "../lib/storage.ts";
import { sendMessage } from "../lib/telegram.ts";
import type { TgMessage } from "../lib/types.ts";
import { dbCreateTask } from "./db.ts";
import { sendTaskCard } from "./formatter.ts";
import { buildDescription, forwardSenderName, isFresh, taskTitle, WAIT_TTL_MS, waitStartedAt } from "./forward-task-core.ts";

export const FWD_WAIT = "fwd_task_wait";

/** Сколько комментарий ждёт пересланного, прежде чем ответить сам. */
const COMMENT_GRACE_MS = 2500;
/** Пересланное без ожидания в базе ждёт, не обогнало ли оно свой комментарий. */
const FORWARD_GRACE_MS = 1500;
const POLL_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readSession(chatId: number): Promise<{ action: string; context?: string } | null> {
  const { data, error } = await supabase.from("sessions").select("action, context").eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`sessions read: ${error.message}`);
  return data as { action: string; context?: string } | null;
}

// Забрать ожидание атомарно: строку удаляет ровно один вызов, второй получит null.
async function takeWait(chatId: number): Promise<string | null> {
  const { data, error } = await supabase.from("sessions").delete().eq("chat_id", chatId).eq("action", FWD_WAIT)
    .select("context");
  if (error) throw new Error(`sessions take: ${error.message}`);
  const row = (data ?? [])[0] as { context?: string } | undefined;
  return row ? (row.context ?? "") : null;
}

/** Комментарий «добавь задачу» без текста: ждём пересланное, не пришло — просим переслать. */
export async function handleTaskComment(chatId: number): Promise<void> {
  const at = String(Date.now());
  await setSession(chatId, FWD_WAIT, at);
  for (let waited = 0; waited < COMMENT_GRACE_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    const s = await readSession(chatId);
    if (s?.action !== FWD_WAIT || s.context !== at) return; // пересланное забрало ожидание
  }
  await sendMessage(chatId, "Перешли сообщение — сделаю из него задачу.");
}

/**
 * Пересланное сообщение. true — стало задачей; false — ожидания нет, сохраняем записью как
 * раньше. `action` — сессия чата на момент прихода апдейта.
 */
export async function handleForwardForTask(
  chatId: number,
  userId: number,
  groupId: string | undefined,
  message: TgMessage,
  text: string,
  action: string | null,
): Promise<boolean> {
  if (action && action !== FWD_WAIT) return false;
  if (!action) {
    // Пересланное могло обогнать свой комментарий (апдейты идут параллельно).
    await sleep(FORWARD_GRACE_MS);
    if ((await readSession(chatId))?.action !== FWD_WAIT) return false;
  }
  const context = await takeWait(chatId);
  if (context === null || !isFresh(waitStartedAt(context), WAIT_TTL_MS)) return false;

  const task = await dbCreateTask({
    title: taskTitle(text),
    description: buildDescription(text, forwardSenderName(message)),
    assignee_telegram_ids: [userId],
    source: "telegram",
    status: "open",
    confirmed: true, // срок не задаём: _shared/tasks/db.ts ставит завтра (defaultDueDate)
    created_by_telegram_id: userId,
    group_id: groupId ?? null,
  });
  await sendMessage(chatId, "✅ Задача из пересланного — поправить можно в вебе:");
  await sendTaskCard(chatId, task);
  return true;
}
