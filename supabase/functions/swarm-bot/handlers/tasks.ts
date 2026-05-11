import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { chatComplete } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage, editMessageKeyboard } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import type { Task, TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const TASK_KEYWORDS = /задач|таск|task|сделать|выполнить|поручен|назначен|дедлайн|deadline|кто должен/i;

export async function smartTaskSearch(chatId: number, question: string): Promise<boolean> {
  if (!TASK_KEYWORDS.test(question)) return false;

  // Extract person or tag from question via GPT
  const raw = await chatComplete(
    "Из вопроса извлеки фильтр для поиска задач. Верни JSON: {\"person\": \"Имя или null\", \"tag\": \"тег/страна или null\", \"period\": \"week/null\"}\nТолько JSON.",
    question
  );

  let person: string | null = null;
  let tag: string | null = null;
  let period: string | null = null;

  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim()) as { person?: string | null; tag?: string | null; period?: string | null };
    person = parsed.person && parsed.person !== "null" ? parsed.person : null;
    tag = parsed.tag && parsed.tag !== "null" ? parsed.tag : null;
    period = parsed.period && parsed.period !== "null" ? parsed.period : null;
  } catch { /* ignore */ }

  let query = supabase.from("tasks").select("*").not("status", "in", '("done","cancelled")').order("due_date");

  if (period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data: allTasks } = await query.limit(100);
  let tasks = (allTasks ?? []) as Task[];
  if (person) {
    const pl = person.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(pl)));
  }
  if (tag) {
    const tl = tag.toLowerCase();
    tasks = tasks.filter(t => t.tags?.some(tg => tg.toLowerCase().includes(tl)));
  }
  tasks = tasks.slice(0, 10);

  if (!tasks.length) return false;

  const taskLines = tasks.map((t: { title: string; assignees: string[]; due_date: string | null; tags: string[]; status: string }) => {
    const assignees = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` · до ${t.due_date}` : "";
    const tags = t.tags?.length ? ` · ${t.tags.join(", ")}` : "";
    return `• ${t.title} (${assignees}${due}${tags})`;
  }).join("\n");

  await sendMessage(chatId, `<b>Задачи по запросу:</b>\n\n${taskLines}`);
  return true;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "⏳ На подтверждении",
  open: "🔲 Открыта",
  in_progress: "🔄 В работе",
  done: "✅ Готово",
  cancelled: "❌ Отменено",
};

function buildTaskQuery(filter: string) {
  const f = filter.trim();

  if (f === "done") {
    return supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false });
  }
  if (f === "all") {
    return supabase.from("tasks").select("*").order("due_date", { ascending: true });
  }

  let q = supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled","pending")')
    .order("due_date", { ascending: true });

  if (f === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  return q;
}

function applyArrayFilter(tasks: Task[], filter: string): Task[] {
  const f = filter.trim();
  if (f.startsWith("@")) {
    const person = f.slice(1).toLowerCase();
    return tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(person)));
  }
  if (f && !["done", "all", "week"].includes(f)) {
    const tag = f.toLowerCase();
    return tasks.filter(t => t.tags?.some(tg => tg.toLowerCase().includes(tag)));
  }
  return tasks;
}

export async function analyzeAndCreateTasks(content: string, chatId: number, entryId: string): Promise<void> {
  const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, markets");

  type Profile = { first_name?: string; last_name?: string; markets?: string[] };

  const userList = (profiles ?? []).map((p: Profile) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const markets = p.markets?.length ? ` (рынки: ${p.markets.join(", ")})` : "";
    return name ? `${name}${markets}` : null;
  }).filter(Boolean).join("; ");

  const raw = await chatComplete(
    `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
    `Члены команды и их рынки: ${userList || "неизвестны"}\n` +
    `Если в тексте упоминается страна/рынок — назначь задачу ответственному за этот рынок.\n` +
    `Верни ТОЛЬКО JSON без markdown:\n` +
    `{"tasks":[{"title":"Название задачи","assignee":"Полное имя из списка или null","due_date":"YYYY-MM-DD или null","confidence":0.9}]}\n` +
    `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
    content.slice(0, 6000)
  );

  let tasks: Array<{ title: string; assignee: string | null; due_date: string | null; confidence: number }> = [];
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    tasks = (parsed.tasks ?? []).filter((t: { confidence: number }) => t.confidence >= 0.7);
  } catch { return; }

  if (!tasks.length) return;

  const profileNames = (profiles ?? []).map((p: Profile) =>
    [p.first_name, p.last_name].filter(Boolean).join(" ")
  );

  for (const task of tasks) {
    const assignees: string[] = [];
    if (task.assignee) {
      const lower = task.assignee.toLowerCase();
      const match = profileNames.find((n: string) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()));
      if (match) assignees.push(match);
    }
    await supabase.from("tasks").insert({
      title: task.title,
      assignees,
      due_date: task.due_date ?? null,
      tags: [],
      status: "pending",
      meeting_id: entryId,
    });
  }

  const n = tasks.length;
  const word = n === 1 ? "задача" : n < 5 ? "задачи" : "задач";
  await sendMessage(chatId, `📋 Найдено <b>${n} ${word}</b> — проверь в разделе <b>📋 Задачи → ⏳ На подтверждении</b>.`);
}

async function sendPendingTaskCard(chatId: number, task: Task): Promise<void> {
  const assignees = task.assignees?.length ? task.assignees.join(", ") : "все";
  const due = task.due_date ? `\n📅 ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const text = `⏳ <b>${task.title}</b>\n👤 ${assignees}${due}`;

  await sendInlineMessage(chatId, text, [
    [
      { text: "✅ Подтвердить", callback_data: `tc_${task.id}` },
      { text: "👤 Назначить", callback_data: `ta_${task.id}` },
      { text: "🗑 Удалить", callback_data: `td_${task.id}` },
    ],
  ]);
}

export async function handleTaskListCallback(chatId: number, userId: number, username: string, type: string): Promise<void> {
  if (type === "pending") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Задач на подтверждении нет. ✅"); return; }
    await sendMessage(chatId, `<b>⏳ На подтверждении: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendPendingTaskCard(chatId, t);
  } else if (type === "mine") {
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", userId).maybeSingle();
    const fullName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : "";
    const searchName = fullName || username;

    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled")')
      .order("due_date", { ascending: true }).limit(200);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const allMine = ((data ?? []) as Task[]).filter(t => t.assignees?.some(a => a.toLowerCase().includes(searchName.toLowerCase())));
    const pending = allMine.filter(t => t.status === "pending");
    const active = allMine.filter(t => t.status !== "pending").slice(0, 15);
    if (!allMine.length) { await sendMessage(chatId, "У тебя нет активных задач."); return; }
    if (pending.length > 0) await sendMessage(chatId, `<b>⏳ На подтверждении: ${pending.length} шт.</b>\nПодтверди задачи в разделе "На подтверждении".`);
    if (active.length > 0) {
      await sendMessage(chatId, `<b>👤 Мои задачи: ${active.length} шт.</b>`);
      for (const t of active) await sendTaskCard(chatId, t);
    } else if (pending.length > 0) {
      await sendMessage(chatId, "Подтверждённых задач пока нет — сначала прими задачи из раздела «На подтверждении».");
    }
  } else if (type === "open") {
    const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    type Profile = { telegram_id: number; first_name?: string; last_name?: string };
    const profileMap: Record<number, Profile> = Object.fromEntries(
      (profiles ?? []).map((p: Profile) => [p.telegram_id, p])
    );
    const seen = new Set<number>();
    const personButtons = ((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>)
      .filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; })
      .map((u) => {
        const p = profileMap[u.telegram_id];
        const label = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
        return [{ text: `👤 ${label}`, callback_data: `tl_openby_${u.telegram_id}` }];
      });
    await sendInlineMessage(chatId, "<b>📋 Все открытые — фильтр:</b>", [
      [{ text: "📋 Все", callback_data: "tl_open_all" }],
      ...personButtons,
    ]);
  } else if (type === "open_all") {
    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled","pending")')
      .order("due_date", { ascending: true }).limit(15);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Открытых задач нет."); return; }
    await sendMessage(chatId, `<b>📋 Все открытые: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type.startsWith("openby_")) {
    const targetTgId = Number(type.replace("openby_", ""));
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
    const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
    const searchName = prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : (au?.username ?? String(targetTgId));
    const { data, error } = await supabase.from("tasks").select("*")
      .not("status", "in", '("done","cancelled","pending")')
      .order("due_date", { ascending: true }).limit(200);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = ((data ?? []) as Task[]).filter(t => t.assignees?.some(a => a.toLowerCase().includes(searchName.toLowerCase()))).slice(0, 15);
    if (!tasks.length) { await sendMessage(chatId, `У ${searchName} нет активных задач.`); return; }
    await sendMessage(chatId, `<b>👤 ${searchName}: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "done") {
    const { data, error } = await supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false }).limit(15);
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Выполненных задач нет."); return; }
    await sendMessage(chatId, `<b>✅ Выполненные: ${tasks.length} шт.</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "export") {
    await handleTasksExport(chatId, "");
  }
}

export async function handleTasks(chatId: number, filter: string): Promise<void> {
  const sub = filter.trim().toLowerCase();

  if (!sub) {
    const { count } = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "pending");
    const pendingCount = count ?? 0;
    await sendInlineMessage(chatId, "<b>📋 Задачи</b>", [
      [{ text: `⏳ На подтверждении${pendingCount > 0 ? ` (${pendingCount})` : ""}`, callback_data: "tl_pending" }],
      [{ text: "👤 Мои задачи", callback_data: "tl_mine" }, { text: "📋 Все открытые", callback_data: "tl_open" }],
      [{ text: "✅ Выполненные", callback_data: "tl_done" }, { text: "📤 Экспорт", callback_data: "tl_export" }],
    ]);
    return;
  }

  if (sub === "export" || sub.startsWith("export ")) {
    await handleTasksExport(chatId, sub.replace("export", "").trim());
    return;
  }

  const needsJsFilter = filter.trim().startsWith("@") || (filter.trim() && !["done", "all", "week"].includes(filter.trim()));
  const { data, error } = await buildTaskQuery(filter).limit(needsJsFilter ? 200 : 15);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

  const tasks = applyArrayFilter((data ?? []) as Task[], filter).slice(0, 15);
  if (!tasks.length) { await sendMessage(chatId, "Задач не найдено."); return; }

  const label = filter.trim() ? ` · ${filter.trim()}` : "";
  await sendMessage(chatId, `<b>Задачи${label}:</b> ${tasks.length} шт.`);

  for (const task of tasks) {
    await sendTaskCard(chatId, task);
  }
}

export async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const assignees = task.assignees?.length ? task.assignees.join(", ") : "—";
  const due = task.due_date ? `📅 ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const tags = task.tags?.length ? `🏷 ${task.tags.join(", ")}` : "";
  const status = STATUS_LABEL[task.status] ?? task.status;

  const text = [
    `${status} <b>${task.title}</b>`,
    `👤 ${assignees}`,
    [due, tags].filter(Boolean).join("  "),
    task.url ? `🔗 <a href="${task.url}">${task.url}</a>` : "",
  ].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [
    [{ text: "⚙️ Действия →", callback_data: `topen_${task.id}` }],
  ]);
}

async function showTaskComments(chatId: number, taskId: string): Promise<void> {
  const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
  const { data: comments } = await supabase.from("task_comments")
    .select("content, added_by, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  const title = task?.title ?? "Задача";
  const lines = (comments ?? []).map((c: { content: string; added_by: string; created_at: string }) => {
    const date = new Date(c.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<b>${c.added_by}</b> · ${date}\n${c.content}`;
  });

  const text = lines.length
    ? `💬 <b>Комментарии · ${title}</b>\n\n${lines.join("\n\n")}`
    : `💬 <b>Комментарии · ${title}</b>\n\nПока нет комментариев.`;

  await sendInlineMessage(chatId, text, [
    [{ text: "➕ Добавить комментарий", callback_data: `tca_${taskId}` }],
  ]);
}

export async function handleTasksExport(chatId: number, filter: string): Promise<void> {
  const { data, error } = await buildTaskQuery(filter || "").limit(500);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
  const tasks = applyArrayFilter((data ?? []) as Task[], filter || "");
  if (!tasks.length) { await sendMessage(chatId, "Задач для экспорта не найдено."); return; }

  const lines = ["Задача\tИсполнители\tДедлайн\tТеги\tСтатус\tСоздана"];
  for (const t of tasks as Task[]) {
    lines.push([
      t.title,
      (t.assignees ?? []).join("; "),
      t.due_date ?? "",
      (t.tags ?? []).join("; "),
      t.status,
      t.created_at.slice(0, 10),
    ].join("\t"));
  }

  const csv = lines.join("\n");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/plain" }), `tasks_${new Date().toISOString().slice(0, 10)}.tsv`);
  form.append("caption", `Экспорт задач · ${tasks.length} шт.`);

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
}

export async function handleTaskStatusChange(
  chatId: number,
  username: string,
  taskId: string,
  newStatus: string
): Promise<void> {
  const { data: task } = await supabase.from("tasks").select("title, status").eq("id", taskId).maybeSingle();
  if (!task) { await sendMessage(chatId, "Задача не найдена."); return; }

  await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", taskId);
  await supabase.from("task_history").insert({
    task_id: taskId,
    changed_by: username,
    old_status: task.status,
    new_status: newStatus,
  });

  await sendMessage(chatId, `${STATUS_LABEL[newStatus]} <b>${task.title}</b>`);
}

export async function handleTaskCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string
): Promise<boolean> {
  const data = cb.data;

  if (data.startsWith("tl_")) {
    await handleTaskListCallback(chatId, userId, username, data.replace("tl_", ""));
    return true;
  }
  if (data.startsWith("tc_")) {
    const taskId = data.replace("tc_", "");
    const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
    await supabase.from("tasks").update({ status: "open" }).eq("id", taskId);
    await sendMessage(chatId, `✅ Задача подтверждена: <b>${task?.title ?? ""}</b>`);
    return true;
  }
  if (data.startsWith("tas_")) {
    const rest = data.replace("tas_", "");
    const sep = rest.lastIndexOf("_");
    const taskId = rest.slice(0, sep);
    const targetTgId = Number(rest.slice(sep + 1));
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
    const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
    const assigneeName = prof
      ? [prof.first_name, prof.last_name].filter(Boolean).join(" ")
      : (au?.username ? `@${au.username}` : `ID ${targetTgId}`);
    await supabase.from("tasks").update({ assignees: [assigneeName], status: "open" }).eq("id", taskId);
    await sendMessage(chatId, `✅ Назначено: <b>${assigneeName}</b>`);
    return true;
  }
  if (data.startsWith("ta_")) {
    const taskId = data.replace("ta_", "");
    const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const profileMap: Record<number, { first_name?: string; last_name?: string }> =
      Object.fromEntries((profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]));
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null as string | null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>),
    ].filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });
    const buttons = allUsers.map((u) => {
      const p = profileMap[u.telegram_id];
      const label = (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "") || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
      return [{ text: label, callback_data: `tas_${taskId}_${u.telegram_id}` }];
    });
    await sendInlineMessage(chatId, "Кому назначить задачу?", buttons);
    return true;
  }
  if (data.startsWith("ts_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const newStatus = parts.slice(2).join("_");
    await handleTaskStatusChange(chatId, username, taskId, newStatus);
    return true;
  }
  if (data.startsWith("topen_")) {
    const taskId = data.replace("topen_", "");
    const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).maybeSingle();
    if (!task) { await sendMessage(chatId, "Задача не найдена."); return true; }
    const isActive = task.status !== "done" && task.status !== "cancelled";
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    if (isActive) {
      keyboard.push([
        { text: "🔄 В работе", callback_data: `ts_${task.id}_in_progress` },
        { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
        { text: "⏸ Отмена", callback_data: `ts_${task.id}_cancelled` },
      ]);
      keyboard.push([
        { text: "📅 Дедлайн", callback_data: `tdate_${task.id}` },
        { text: "✏️ Название", callback_data: `ttitle_${task.id}` },
        { text: "🔗 Ссылка", callback_data: `turl_${task.id}` },
      ]);
      keyboard.push([
        { text: "👤 Назначить", callback_data: `ta_${task.id}` },
        { text: "💬 Комментарии", callback_data: `tcomments_${task.id}` },
      ]);
    }
    keyboard.push([{ text: "🗑 Удалить", callback_data: `td_${task.id}` }]);
    await editMessageKeyboard(chatId, cb.message.message_id, keyboard);
    return true;
  }
  if (data.startsWith("tdate_")) {
    const taskId = data.replace("tdate_", "");
    await setSession(chatId, `task_date_${taskId}`);
    await sendMessage(chatId, "Новый дедлайн?");
    return true;
  }
  if (data.startsWith("ttitle_")) {
    const taskId = data.replace("ttitle_", "");
    await setSession(chatId, `task_title_${taskId}`);
    await sendMessage(chatId, "Введи новое название задачи:");
    return true;
  }
  if (data.startsWith("turl_")) {
    const taskId = data.replace("turl_", "");
    await setSession(chatId, `task_url_${taskId}`);
    await sendMessage(chatId, "Введи ссылку:");
    return true;
  }
  if (data.startsWith("tcomments_")) {
    const taskId = data.replace("tcomments_", "");
    await showTaskComments(chatId, taskId);
    return true;
  }
  if (data.startsWith("tca_")) {
    const taskId = data.replace("tca_", "");
    await setSession(chatId, `task_comment_${taskId}`);
    await sendMessage(chatId, "Напиши комментарий:");
    return true;
  }
  if (data.startsWith("td_")) {
    const taskId = data.replace("td_", "");
    const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
    await supabase.from("task_history").delete().eq("task_id", taskId);
    await supabase.from("tasks").delete().eq("id", taskId);
    await sendMessage(chatId, `🗑 Удалено: <b>${task?.title ?? taskId}</b>`);
    return true;
  }
  return false;
}

/* === DISABLED: task session text input handlers — re-enable by calling from index.ts session router === */
export async function handleTaskSessionInput(
  chatId: number,
  action: string,
  text: string,
): Promise<boolean> {
  if (action.startsWith("task_date_")) {
    await clearSession(chatId);
    const taskId = action.replace("task_date_", "");
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Верни ТОЛЬКО дату в этом формате, без пояснений. Если не можешь распознать — верни "null".`,
      text.trim()
    );
    const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!due) { await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз."); }
    else {
      await supabase.from("tasks").update({ due_date: due }).eq("id", taskId);
      const dueFmt = new Date(due + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      await sendMessage(chatId, `📅 Дедлайн: <b>${dueFmt}</b>`);
    }
    return true;
  }
  if (action.startsWith("task_title_")) {
    await clearSession(chatId);
    const taskId = action.replace("task_title_", "");
    await supabase.from("tasks").update({ title: text.trim() }).eq("id", taskId);
    await sendMessage(chatId, `✅ Название обновлено: <b>${text.trim()}</b>`);
    return true;
  }
  if (action.startsWith("task_url_")) {
    await clearSession(chatId);
    const taskId = action.replace("task_url_", "");
    await supabase.from("tasks").update({ url: text.trim() }).eq("id", taskId);
    await sendMessage(chatId, `🔗 Ссылка сохранена.`);
    return true;
  }
  if (action.startsWith("task_comment_")) {
    await clearSession(chatId);
    const taskId = action.replace("task_comment_", "");
    await supabase.from("task_comments").insert({ task_id: taskId, content: text.trim(), added_by: "user" });
    await sendMessage(chatId, `💬 Комментарий добавлен.`);
    await showTaskComments(chatId, taskId);
    return true;
  }
  return false;
}
