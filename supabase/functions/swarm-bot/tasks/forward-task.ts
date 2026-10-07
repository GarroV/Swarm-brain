// Задача из пересланного сообщения — связка двух апдейтов Telegram (чистая часть —
// forward-task-core.ts).
//
// Пересылка с комментарием приходит боту ДВУМЯ сообщениями: сначала комментарий («создай
// задачу»), следом пересланное. Обрабатываются они разными вызовами функции, иногда
// параллельно, поэтому пара держится в строке `sessions` чата:
//   • комментарий ставит `fwd_task_wait` и пару секунд ждёт, не заберёт ли его пересланное;
//     не забрало — просит переслать (ожидание живёт WAIT_TTL_MS) или, если в комментарии уже
//     есть название, создаёт задачу из него, как «добавь задачу …»;
//   • пересланное забирает `fwd_task_wait` (удалением строки — забирает ровно один вызов) и
//     создаёт задачу; следующие пересланные той же пачки (`fwd_task_append`) дописываются в неё.
// Пересланное без комментария-задачи по-прежнему сохраняется записью в базу.
import { supabase } from "../lib/supabase.ts";
import { setSession } from "../lib/storage.ts";
import { sendMessage } from "../lib/telegram.ts";
import { chatComplete } from "../lib/openai.ts";
import type { TgMessage } from "../lib/types.ts";
import { dbCreateTask, dbGetTask, dbUpdateTask } from "./db.ts";
import { findUserByMention, getProfilesForPrompt } from "./matcher.ts";
import { sendTaskCard } from "./formatter.ts";
import { TASK_TZ, todayInTz } from "../../_shared/tasks/recurrence.ts";
import {
  APPEND_TTL_MS,
  buildDescription,
  DRAFT_SYSTEM_PROMPT,
  draftFromModel,
  draftUserPrompt,
  type ForwardAppend,
  forwardSenderName,
  type ForwardWait,
  isFresh,
  parseState,
  WAIT_TTL_MS,
} from "./forward-task-core.ts";

export const FWD_WAIT = "fwd_task_wait";
export const FWD_APPEND = "fwd_task_append";

/** Сколько комментарий ждёт пересланного, прежде чем ответить сам. */
const COMMENT_GRACE_MS = 2500;
/** Пересланное без ожидания в базе ждёт, не обгонило ли оно свой комментарий. */
const FORWARD_GRACE_MS = 1500;
const POLL_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAction(chatId: number): Promise<{ action: string; context?: string } | null> {
  const { data, error } = await supabase.from("sessions").select("action, context").eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`sessions read: ${error.message}`);
  return data as { action: string; context?: string } | null;
}

// Забрать ожидание атомарно: строку удаляет ровно один вызов, второй получит пусто.
async function takeSession(chatId: number, action: string): Promise<string | null> {
  const { data, error } = await supabase.from("sessions").delete().eq("chat_id", chatId).eq("action", action)
    .select("context");
  if (error) throw new Error(`sessions take: ${error.message}`);
  const row = (data ?? [])[0] as { context?: string } | undefined;
  return row ? (row.context ?? "") : null;
}

/**
 * Комментарий к пересланному. Ждёт пересланное COMMENT_GRACE_MS; true — комментарий обработан
 * (пересланное его забрало либо бот попросил переслать). false — в комментарии есть своё
 * название задачи, а пересланного нет: пусть отработает обычное «добавь задачу …».
 */
export async function handleTaskComment(
  chatId: number,
  comment: string,
  parsed: { rest: string; assigneeMention: string | null },
  hasOwnTitle: boolean,
): Promise<boolean> {
  const state: ForwardWait = { comment, rest: parsed.rest, assigneeMention: parsed.assigneeMention, at: Date.now() };
  await setSession(chatId, FWD_WAIT, JSON.stringify(state));
  for (let waited = 0; waited < COMMENT_GRACE_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    const s = await readAction(chatId);
    if (s?.action !== FWD_WAIT || parseState<ForwardWait>(s.context)?.at !== state.at) return true;
  }
  if (hasOwnTitle) {
    if (await takeSession(chatId, FWD_WAIT) === null) return true; // пересланное успело в последний миг
    return false;
  }
  await sendMessage(chatId, "Перешли сообщение — сделаю из него задачу.");
  return true;
}

/**
 * Пересланное сообщение. true — стало задачей (или дописано в задачу пачки); false — ожидания
 * нет, сохраняем записью как раньше. `action` — сессия чата на момент прихода апдейта.
 */
export async function handleForwardForTask(
  chatId: number,
  userId: number,
  groupId: string | undefined,
  message: TgMessage,
  text: string,
  action: string | null,
): Promise<boolean> {
  if (action && action !== FWD_WAIT && action !== FWD_APPEND) return false;
  if (!action) {
    // Пересланное могло обогнать свой комментарий (апдейты идут параллельно).
    await sleep(FORWARD_GRACE_MS);
    const s = await readAction(chatId);
    if (s?.action !== FWD_WAIT && s?.action !== FWD_APPEND) return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const append = parseState<ForwardAppend>(await takeSession(chatId, FWD_APPEND) ?? undefined);
    if (append && isFresh(append.at, APPEND_TTL_MS)) {
      await appendToTask(chatId, userId, append, message, text);
      return true;
    }
    const wait = parseState<ForwardWait>(await takeSession(chatId, FWD_WAIT) ?? undefined);
    if (wait && isFresh(wait.at, WAIT_TTL_MS)) {
      await createFromForward(chatId, userId, groupId, wait, message, text);
      return true;
    }
    // Соседнее пересланное из той же пачки как раз создаёт задачу — подождём его отметки.
    await sleep(FORWARD_GRACE_MS);
  }
  return false;
}

async function createFromForward(
  chatId: number,
  userId: number,
  groupId: string | undefined,
  wait: ForwardWait,
  message: TgMessage,
  text: string,
): Promise<void> {
  const today = todayInTz(new Date(), TASK_TZ);
  let raw: string | null = null;
  try {
    raw = await chatComplete(DRAFT_SYSTEM_PROMPT, draftUserPrompt(text, wait.comment, today), {
      temperature: 0,
      json: true,
    });
  } catch (e) {
    console.error(`[forward-task] модель не ответила, название из текста: ${e instanceof Error ? e.message : e}`);
  }
  const draft = draftFromModel(raw, text, today);

  // Исполнитель: названный в комментарии («поставь Ксении задачу») надёжнее догадки модели.
  const mention = wait.assigneeMention ?? draft.assignee;
  const matched = mention ? findUserByMention(mention, await getProfilesForPrompt()) : null;
  const note = mention && !matched ? ` (исполнитель «${mention}» не найден — назначил на тебя)` : "";

  const task = await dbCreateTask({
    title: draft.title,
    description: buildDescription(text, forwardSenderName(message), wait.comment),
    assignees: matched ? [matched.name] : [],
    assignee_telegram_ids: [matched ? matched.id : userId],
    due_date: draft.dueDate, // null → завтра (_shared/tasks/db.ts, defaultDueDate)
    source: "telegram",
    status: "open",
    confirmed: true,
    created_by_telegram_id: userId,
    group_id: groupId ?? null,
  });
  const next: ForwardAppend = { taskId: task.id, title: task.title, at: Date.now() };
  await setSession(chatId, FWD_APPEND, JSON.stringify(next));

  // Исполнителю бот сам НЕ пишет: новое условие отправки людям — только по «да» владельца
  // (CLAUDE.md §7). Задача видна ему в вебе и в «Мои задачи».
  await sendMessage(chatId, `✅ Задача из пересланного${matched ? ` · ${matched.name}` : ""}${note}:`);
  await sendTaskCard(chatId, task);
}

async function appendToTask(
  chatId: number,
  userId: number,
  append: ForwardAppend,
  message: TgMessage,
  text: string,
): Promise<void> {
  const task = await dbGetTask(append.taskId);
  const sender = forwardSenderName(message);
  const addition = sender ? `${text.trim()}\n(${sender})` : text.trim();
  const description = task?.description ? `${task.description}\n\n${addition}` : addition;
  await dbUpdateTask(append.taskId, { description }, { actorTelegramId: userId });
  await setSession(chatId, FWD_APPEND, JSON.stringify({ ...append, at: Date.now() }));
  await sendMessage(chatId, `➕ Дописал в задачу «${append.title}»`);
}
