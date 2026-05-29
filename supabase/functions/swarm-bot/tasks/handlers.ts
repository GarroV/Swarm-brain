import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { chatComplete } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import { dbGetTask, dbListTasks, dbCreateTask, dbUpdateTask, dbDeleteTask, dbListAllOpen } from "./db.ts";
import { getProfilesForPrompt, buildProfileMap, buildDisplayNameMap, getAllUniqueMarkets, resolveAssignees } from "./matcher.ts";
import { sendTaskCard, sendPendingTaskCard, STATUS_LABEL, formatTaskLine } from "./formatter.ts";
import type { Task } from "./types.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const TASK_KEYWORDS = /задач|таск|task|сделать|выполнить|поручен|назначен|дедлайн|deadline|кто должен/i;

export { sendTaskCard };

// ── /tasks command ────────────────────────────────────────────────────────────

export async function handleTasks(chatId: number, userId: number, filter: string, groupId: string): Promise<void> {
  const sub = filter.trim().toLowerCase();

  if (!sub) {
    const allMine = await dbListTasks({ telegramId: userId, limit: 200, groupId });
    const pending = allMine.filter(t => t.status === "pending");
    const active = allMine.filter(t => !["pending", "done", "cancelled", "draft"].includes(t.status));

    if (!allMine.length) {
      await sendMessage(chatId, "У тебя нет активных задач. 🎉");
      return;
    }
    if (pending.length) {
      await sendMessage(chatId, `<b>⏳ На подтверждении: ${pending.length}</b>`);
      for (const t of pending) await sendPendingTaskCard(chatId, t);
    }
    if (active.length) {
      await sendMessage(chatId, `<b>📋 Мои задачи: ${active.length}</b>`);
      for (const t of active.slice(0, 15)) await sendTaskCard(chatId, t);
    }
    return;
  }

  if (sub === "все" || sub === "all") {
    const tasks = await dbListAllOpen(groupId);
    if (!tasks.length) { await sendMessage(chatId, "Открытых задач нет."); return; }

    const groups: Map<string, Task[]> = new Map();
    const noAssignee: Task[] = [];
    for (const t of tasks) {
      if (!t.assignees?.length) { noAssignee.push(t); continue; }
      const key = t.assignees[0];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    const lines: string[] = [`<b>📋 Все задачи (${tasks.length})</b>`];
    for (const [assignee, atasks] of groups) {
      lines.push(`\n<b>👤 ${assignee} (${atasks.length})</b>`);
      for (const t of atasks.slice(0, 10)) lines.push(formatTaskLine(t));
    }
    if (noAssignee.length) {
      lines.push(`\n<b>❓ Без исполнителя (${noAssignee.length})</b>`);
      for (const t of noAssignee.slice(0, 5)) lines.push(formatTaskLine(t));
    }
    await sendMessage(chatId, lines.join("\n"));
    return;
  }

  // Search by person name
  const tasks = await dbListTasks({ assignee: filter.trim(), limit: 200, groupId });
  if (!tasks.length) { await sendMessage(chatId, `Задач для <b>${filter.trim()}</b> не найдено.`); return; }
  await sendMessage(chatId, `<b>👤 ${filter.trim()}: ${tasks.length} задач</b>`);
  for (const t of tasks.slice(0, 15)) await sendTaskCard(chatId, t);
}

// ── /addtask command ──────────────────────────────────────────────────────────

export async function handleAddTask(chatId: number): Promise<void> {
  await setSession(chatId, "addtask_title");
  await sendMessage(chatId, "📌 <b>Новая задача</b>\n\nЗадача?");
}

// ── analyzeAndCreateTasks ─────────────────────────────────────────────────────

export async function analyzeAndCreateTasks(content: string, chatId: number, entryId: string): Promise<void> {
  const profiles = await getProfilesForPrompt();
  const userList = JSON.stringify(profiles.map(p => ({
    id: p.id,
    name: p.name,
    aliases: p.name_aliases,
    email: p.email,
    role: p.role,
    markets: p.markets,
  })));

  const raw = await chatComplete(
    `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
    `Члены команды (JSON): ${userList || "[]"}\n\n` +
    `Роли команды:\n` +
    `- "marketing" — задачи по маркетингу, рекламе, соцсетям\n` +
    `- "rnd" — задачи по продукту, разработке, исследованиям\n` +
    `- "bd" — всё остальное: операционка, бизнес-процессы, сопровождение\n\n` +
    `Правила назначения:\n` +
    `1. Если упоминается конкретный человек (по имени, фамилии, псевдониму, email или сокращённому имени) — запиши его id из списка в assignee_ids\n` +
    `2. Если упоминается страна/рынок — заполни country\n` +
    `3. Если понятна роль исполнителя — заполни task_role\n` +
    `4. assignee_ids может содержать несколько id если задача явно для нескольких людей\n\n` +
    `Верни ТОЛЬКО JSON без markdown:\n` +
    `{"tasks":[{"title":"Название","assignee_ids":[123456789],"task_role":"bd","country":"Словения","due_date":"2026-06-01","confidence":0.9}]}\n` +
    `assignee_ids — массив полей id из списка выше, или [] если исполнитель неизвестен.\n` +
    `task_role — одно из: "marketing", "bd", "rnd", или null если неизвестно.\n` +
    `country — название страны или null. due_date — YYYY-MM-DD или null.\n` +
    `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
    content.slice(0, 6000)
  );

  let tasks: Array<{
    title: string;
    assignee_ids: number[];
    task_role: string | null;
    country: string | null;
    due_date: string | null;
    confidence: number;
  }> = [];
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    tasks = (parsed.tasks ?? []).filter((t: { confidence: number }) => t.confidence >= 0.7);
  } catch { return; }
  if (!tasks.length) return;

  const VALID_ROLES = new Set(["marketing", "bd", "rnd"]);
  for (const task of tasks) {
    const { assignees, assignee_telegram_ids } = resolveAssignees(profiles, task);
    const task_role = VALID_ROLES.has(task.task_role ?? "") ? task.task_role : null;
    await dbCreateTask({
      title: task.title,
      assignees,
      assignee_telegram_ids,
      task_role,
      country: task.country ?? null,
      due_date: task.due_date ?? null,
      source: "transcript",
      status: "pending",
      meeting_id: entryId,
    });
  }

  const n = tasks.length;
  const word = n === 1 ? "задача" : n < 5 ? "задачи" : "задач";
  await sendMessage(chatId, `📋 Найдено <b>${n} ${word}</b> — проверь в <b>📋 Задачи → На подтверждении</b>.`);
}

// ── smartTaskSearch ───────────────────────────────────────────────────────────

export async function smartTaskSearch(chatId: number, question: string): Promise<boolean> {
  if (!TASK_KEYWORDS.test(question)) return false;

  const raw = await chatComplete(
    `Из вопроса извлеки фильтр. Верни JSON: {"person":"Имя или null","country":"Страна или null","period":"week/null"}\nТолько JSON.`,
    question
  );

  let person: string | null = null;
  let country: string | null = null;
  let period: string | null = null;
  try {
    const p = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    person = p.person && p.person !== "null" ? p.person : null;
    country = p.country && p.country !== "null" ? p.country : null;
    period = p.period && p.period !== "null" ? p.period : null;
  } catch { /* ignore */ }

  const tasks = await dbListTasks({ assignee: person ?? undefined, country: country ?? undefined, period: period ?? undefined, limit: 10 });
  if (!tasks.length) return false;

  const lines = tasks.map(t => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` · до ${t.due_date}` : "";
    const c = t.country ? ` · ${t.country}` : "";
    return `• ${t.title} (${who}${due}${c})`;
  }).join("\n");

  await sendMessage(chatId, `<b>Задачи по запросу:</b>\n\n${lines}`);
  return true;
}

// ── Callbacks ─────────────────────────────────────────────────────────────────

export async function handleTaskCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
  groupId: string,
): Promise<boolean> {
  const data = cb.data;

  // /addtask: assignee selection → tat_{taskId}_{telegramId}
  if (data.startsWith("tat_")) {
    const rest = data.replace("tat_", "");
    const sep = rest.lastIndexOf("_");
    const taskId = rest.slice(0, sep);
    const telegramId = Number(rest.slice(sep + 1));
    const nameMap = await buildDisplayNameMap([telegramId]);
    const assigneeName = nameMap[telegramId] ?? String(telegramId);
    await dbUpdateTask(taskId, { assignee_telegram_ids: [telegramId], assignees: [assigneeName] });
    const markets = await getAllUniqueMarkets();
    const countryButtons = markets.map((m, i) => [{ text: `🌍 ${m}`, callback_data: `tac_${taskId}:${i}` }]);
    countryButtons.push([{ text: "❌ Без рынка", callback_data: `tac_${taskId}:none` }]);
    countryButtons.push([{ text: "🚫 Отмена", callback_data: `tacx_${taskId}` }]);
    await sendInlineMessage(chatId, "Рынок?", countryButtons);
    return true;
  }

  // /addtask: cancel → tacx_{taskId}
  if (data.startsWith("tacx_")) {
    const taskId = data.replace("tacx_", "");
    await dbDeleteTask(taskId);
    await clearSession(chatId);
    await sendMessage(chatId, "❌ Создание задачи отменено.");
    return true;
  }

  // /addtask: country selection → tac_{taskId}:{index|none}
  if (data.startsWith("tac_")) {
    const rest = data.replace("tac_", "");
    const sep = rest.indexOf(":");
    if (sep === -1) return false;
    const taskId = rest.slice(0, sep);
    const raw = rest.slice(sep + 1);
    let country: string | null = null;
    if (raw !== "none") {
      const idx = Number(raw);
      if (!isNaN(idx)) {
        const markets = await getAllUniqueMarkets();
        country = markets[idx] ?? null;
      } else {
        country = raw; // backwards compat with old buttons that stored name
      }
    }
    await dbUpdateTask(taskId, { country });
    await setSession(chatId, "addtask_due", taskId);
    await sendMessage(chatId, `Дедлайн? (ДД.ММ.ГГГГ или «пропустить»)`);
    return true;
  }

  // Task confirm pending → open: tc_{taskId}
  if (data.startsWith("tc_")) {
    const taskId = data.replace("tc_", "");
    const task = await dbGetTask(taskId);
    await dbUpdateTask(taskId, { status: "open" });
    await sendMessage(chatId, `✅ Подтверждено: <b>${task?.title ?? ""}</b>`);
    return true;
  }

  // Delete with confirmation: tdc_{taskId}
  if (data.startsWith("tdc_")) {
    const taskId = data.replace("tdc_", "");
    const task = await dbGetTask(taskId);
    await sendInlineMessage(chatId, `Удалить <b>${task?.title ?? taskId}</b>?`, [[
      { text: "✅ Да", callback_data: `tdconf_${taskId}` },
      { text: "Отмена", callback_data: `tdcanc_${taskId}` },
    ]]);
    return true;
  }
  if (data.startsWith("tdconf_")) {
    const taskId = data.replace("tdconf_", "");
    const task = await dbGetTask(taskId);
    await dbDeleteTask(taskId);
    await sendMessage(chatId, `🗑 Удалено: <b>${task?.title ?? taskId}</b>`);
    return true;
  }
  if (data.startsWith("tdcanc_")) {
    await sendMessage(chatId, "Удаление отменено.");
    return true;
  }

  // Set due date prompt: tdate_{taskId}
  if (data.startsWith("tdate_")) {
    const taskId = data.replace("tdate_", "");
    await setSession(chatId, "task_date", taskId);
    await sendMessage(chatId, "Новый дедлайн? (ДД.ММ.ГГГГ или «убрать»)");
    return true;
  }

  // Assign user — show buttons: ta_{taskId}
  // Earlier returns for tat_, tac_, tacx_ guarantee this only matches plain ta_
  if (data.startsWith("ta_")) {
    const taskId = data.replace("ta_", "");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null as string | null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number | null; username: string | null }>),
    ].filter((u): u is { telegram_id: number; username: string | null } => {
      if (u.telegram_id == null) return false;
      if (seen.has(u.telegram_id)) return false;
      seen.add(u.telegram_id);
      return true;
    });
    const nameMap = await buildDisplayNameMap(allUsers.map(u => u.telegram_id));
    const buttons = allUsers.map(u => [{
      text: nameMap[u.telegram_id] || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
      callback_data: `tas_${taskId}_${u.telegram_id}`,
    }]);
    await sendInlineMessage(chatId, "Кому назначить?", buttons);
    return true;
  }

  // Assign confirm: tas_{taskId}_{telegramId}
  if (data.startsWith("tas_")) {
    const rest = data.replace("tas_", "");
    const sep = rest.lastIndexOf("_");
    const taskId = rest.slice(0, sep);
    const targetTgId = Number(rest.slice(sep + 1));
    const profiles = await getProfilesForPrompt();
    const profileMap = buildProfileMap(profiles);
    const name = profileMap[targetTgId] ?? `ID ${targetTgId}`;
    await dbUpdateTask(taskId, { assignees: [name], assignee_telegram_ids: [targetTgId], status: "open" });
    await sendMessage(chatId, `✅ Назначено: <b>${name}</b>`);
    return true;
  }

  // Status change: ts_{taskId}_{status}
  if (data.startsWith("ts_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const newStatus = parts.slice(2).join("_");
    const task = await dbGetTask(taskId);
    if (!task) { await sendMessage(chatId, "Задача не найдена."); return true; }
    await dbUpdateTask(taskId, { status: newStatus });
    await supabase.from("task_history").insert({
      task_id: taskId,
      changed_by: username,
      old_status: task.status,
      new_status: newStatus,
    });
    await sendMessage(chatId, `${STATUS_LABEL[newStatus] ?? newStatus} <b>${task.title}</b>`);
    return true;
  }

  // Task list menu: tl_{type}
  if (data.startsWith("tl_")) {
    await handleTaskListCallback(chatId, userId, username, data.replace("tl_", ""));
    return true;
  }

  return false;
}

// ── Task list menu callbacks ──────────────────────────────────────────────────

async function handleTaskListCallback(chatId: number, userId: number, _username: string, type: string): Promise<void> {
  if (type === "pending") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Задач на подтверждении нет. ✅"); return; }
    await sendMessage(chatId, `<b>⏳ На подтверждении: ${tasks.length}</b>`);
    for (const t of tasks) await sendPendingTaskCard(chatId, t);
  } else if (type === "done") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Выполненных задач нет."); return; }
    await sendMessage(chatId, `<b>✅ Выполненные: ${tasks.length}</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "export") {
    await handleTasksExport(chatId);
  }
}

async function handleTasksExport(chatId: number): Promise<void> {
  const { data } = await supabase.from("tasks").select("*")
    .not("status", "in", '("draft")')
    .order("due_date", { ascending: true })
    .limit(500);
  const tasks = (data ?? []) as Task[];
  if (!tasks.length) { await sendMessage(chatId, "Задач для экспорта нет."); return; }

  const lines = ["Задача\tИсполнители\tРынок\tДедлайн\tСтатус\tИсточник\tСоздана"];
  for (const t of tasks) {
    lines.push([
      t.title,
      (t.assignees ?? []).join("; "),
      t.country ?? "",
      t.due_date ?? "",
      t.status,
      t.source ?? "",
      t.created_at.slice(0, 10),
    ].join("\t"));
  }

  const csv = lines.join("\n");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/plain" }), `tasks_${new Date().toISOString().slice(0, 10)}.tsv`);
  form.append("caption", `Экспорт задач · ${tasks.length} шт.`);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
}

// ── Session text input handlers ───────────────────────────────────────────────

export async function handleTaskSessionInput(
  chatId: number,
  _userId: number,
  action: string,
  text: string,
  context?: string,
  groupId?: string,
): Promise<boolean> {
  // /addtask step 1: title received
  if (action === "addtask_title") {
    await clearSession(chatId);
    const title = text.trim();
    if (!title) {
      await sendMessage(chatId, "Название не может быть пустым. Попробуй ещё раз.");
      await setSession(chatId, "addtask_title");
      return true;
    }
    const task = await dbCreateTask({ title, source: "manual", status: "draft", group_id: groupId ?? null });
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null as string | null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number | null; username: string | null }>),
    ].filter((u): u is { telegram_id: number; username: string | null } => {
      if (u.telegram_id == null) return false;
      if (seen.has(u.telegram_id)) return false;
      seen.add(u.telegram_id);
      return true;
    });
    const nameMap = await buildDisplayNameMap(allUsers.map(u => u.telegram_id));
    const buttons = allUsers.map(u => [{
      text: nameMap[u.telegram_id] || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
      callback_data: `tat_${task.id}_${u.telegram_id}`,
    }]);
    buttons.push([{ text: "❌ Без исполнителя", callback_data: `tac_${task.id}:none` }]);
    buttons.push([{ text: "🚫 Отмена", callback_data: `tacx_${task.id}` }]);
    await sendInlineMessage(chatId, `📌 <b>${title}</b>\n\nКому назначить?`, buttons);
    return true;
  }

  // /addtask step 2: due date received
  if (action === "addtask_due" && context) {
    await clearSession(chatId);
    const taskId = context;
    if (["пропустить", "skip", "пропуск"].includes(text.trim().toLowerCase())) {
      await dbUpdateTask(taskId, { status: "open" });
      const task = await dbGetTask(taskId);
      if (task) {
        await sendMessage(chatId, "✅ Задача создана!");
        await sendTaskCard(chatId, task);
      }
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Только дату, без пояснений. Если не распознал — верни "null".`,
      text.trim()
    );
    const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!due) {
      await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз или напиши «пропустить».");
      await setSession(chatId, "addtask_due", taskId);
      return true;
    }
    await dbUpdateTask(taskId, { due_date: due, status: "open" });
    const task = await dbGetTask(taskId);
    if (task) {
      await sendMessage(chatId, "✅ Задача создана!");
      await sendTaskCard(chatId, task);
    }
    return true;
  }

  // Edit due date for existing task
  if (action === "task_date" && context) {
    await clearSession(chatId);
    const taskId = context;
    if (text.trim().toLowerCase() === "убрать") {
      await dbUpdateTask(taskId, { due_date: null });
      await sendMessage(chatId, "📅 Дедлайн убран.");
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату в формат ГГГГ-ММ-ДД. Только дату. Если не распознал — "null".`,
      text.trim()
    );
    const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!due) {
      await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз.");
      await setSession(chatId, "task_date", taskId);
      return true;
    }
    await dbUpdateTask(taskId, { due_date: due });
    const dueFmt = new Date(due + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    await sendMessage(chatId, `📅 Дедлайн: <b>${dueFmt}</b>`);
    return true;
  }

  return false;
}
