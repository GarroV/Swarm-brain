import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTask, getTask, listTasks, updateTask, deleteTask } from "../../_shared/tasks/db.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

async function notifyCreator(telegramId: number, taskTitle: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  const text = `📋 Новая задача на проверке: <b>${taskTitle}</b>\n\nОткрой /tasks → ⏳ На проверке чтобы подтвердить.`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text, parse_mode: "HTML" }),
  });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Workspace + assignee resolution (MCP layer, not in shared engine) ─────────

async function resolveGroupId(telegramId: number): Promise<string | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as { group_id: string | null } | null)?.group_id ?? null;
}

// Имена личных смарт-меток → id меток владельца. createMissing=true — недостающие авто-создаются.
async function resolveLabelIds(ownerId: number, names: string[], createMissing: boolean): Promise<string[]> {
  const { data: existing } = await supabase
    .from("task_labels").select("id,name").eq("owner_id", ownerId);
  const byName = new Map<string, string>();
  for (const r of (existing ?? []) as Array<{ id: string; name: string }>) byName.set(r.name.toLowerCase(), r.id);
  const groupId = await resolveGroupId(ownerId);
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = byName.get(name.toLowerCase());
    if (hit) { ids.push(hit); continue; }
    if (!createMissing) continue;
    const { data } = await supabase
      .from("task_labels").insert({ owner_id: ownerId, group_id: groupId, name, icon: "tag" })
      .select("id").single();
    if (data) { const id = (data as { id: string }).id; byName.set(name.toLowerCase(), id); ids.push(id); }
  }
  return ids;
}

export async function toolListTaskLabels(args: { requesting_user_id: number }): Promise<string> {
  const { data } = await supabase
    .from("task_labels").select("id,name").eq("owner_id", args.requesting_user_id).order("sort_order");
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  if (!rows.length) return "У тебя пока нет меток.";
  return rows.map((r) => `• ${r.name} (id: ${r.id})`).join("\n");
}

async function matchAssignee(name: string): Promise<{ telegram_id: number; display_name: string } | null> {
  // username — в allowed_users (НЕ в user_profiles). Раньше селект username из user_profiles
  // падал → data=null → matchAssignee всегда возвращал null (резолв исполнителя в MCP не работал).
  const [{ data: profs }, { data: aus }] = await Promise.all([
    supabase.from("user_profiles").select("telegram_id, first_name, last_name, email, name_aliases"),
    supabase.from("allowed_users").select("telegram_id, username"),
  ]);
  if (!profs?.length) return null;
  const uname = new Map<number, string>();
  ((aus ?? []) as Array<{ telegram_id: number; username?: string | null }>).forEach((u) => {
    if (u.username) uname.set(u.telegram_id, u.username);
  });
  const data = (profs as Array<{ telegram_id: number; first_name?: string; last_name?: string; email?: string; name_aliases?: string[] }>)
    .map((p) => ({ ...p, username: uname.get(p.telegram_id) }));
  const lower = name.toLowerCase();
  const match = (data as Array<{
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    email?: string;
    name_aliases?: string[];
  }>).find(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
    const uname = (p.username ?? "").toLowerCase();
    const email = (p.email ?? "").toLowerCase();
    const aliases = (p.name_aliases ?? []).map((a: string) => a.toLowerCase());
    return (
      fullName.includes(lower) || lower.includes(fullName) ||
      uname.includes(lower) ||
      (email.length > 0 && email.includes(lower)) ||
      aliases.some(a => a.includes(lower) || lower.includes(a))
    );
  });
  if (!match) return null;
  return {
    telegram_id: match.telegram_id,
    display_name: [match.first_name, match.last_name].filter(Boolean).join(" ") || match.username || String(match.telegram_id),
  };
}

// ── Tool implementations (MCP prослойки — резолв + shared engine + форматирование) ──

export async function toolAddTask(args: {
  title: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string;
  task_role?: string;
  source: string;
  context_id?: string;
  labels?: string[];
  requesting_user_id?: number;
}): Promise<string> {
  const assignees: string[] = [];
  let assignee_telegram_ids: number[] = [];
  let matchWarning = "";

  if (args.assignee_name) {
    const match = await matchAssignee(args.assignee_name);
    if (match) {
      assignees.push(match.display_name);
      assignee_telegram_ids = [match.telegram_id];
    } else {
      assignees.push(args.assignee_name);
      matchWarning = " ⚠️ исполнитель не найден в профилях — записан как текст";
    }
  }

  const groupId = args.requesting_user_id ? await resolveGroupId(args.requesting_user_id) : null;

  // Смарт-метки: только на личной задаче владельца. Наличие меток делает задачу личной.
  const labelIds = args.labels?.length && args.requesting_user_id
    ? await resolveLabelIds(args.requesting_user_id, args.labels, true)
    : [];

  try {
    const task = await createTask({
      title: args.title,
      description: args.description ?? null,
      assignees,
      assignee_telegram_ids,
      country: args.country ?? null,
      due_date: args.due_date ?? null,
      task_role: args.task_role ?? null,
      source: args.source,
      status: "open",
      meeting_id: args.context_id ?? null,
      tags: [],
      confirmed: false,
      created_by_telegram_id: args.requesting_user_id ?? null,
      label_ids: labelIds,
      is_private: labelIds.length > 0 ? true : undefined,
      owner_id: labelIds.length > 0 ? (args.requesting_user_id ?? null) : undefined,
    }, groupId ?? undefined);
    if (args.requesting_user_id) {
      await notifyCreator(args.requesting_user_id, args.title);
    }
    return `✅ Задача создана (id: ${task.id})${matchWarning}.`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function toolUpdateTask(args: {
  id: string;
  title?: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string | null;
  status?: string;
  task_role?: string;
  labels?: string[];
  requesting_user_id: number;
}): Promise<string> {
  const task = await getTask(args.id);
  if (!task) return `Задача ${args.id} не найдена.`;
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId || task.group_id !== groupId) return `Нет доступа: задача не принадлежит твоему воркспейсу.`;

  const fields: Record<string, unknown> = {};

  // Смарт-метки: только на своей личной задаче.
  if (args.labels !== undefined) {
    if (!(task.is_private && task.owner_id === args.requesting_user_id)) {
      return "Метки доступны только на твоих личных задачах.";
    }
    fields.label_ids = await resolveLabelIds(args.requesting_user_id, args.labels, true);
  }

  if (args.title !== undefined) fields.title = args.title;
  if (args.description !== undefined) fields.description = args.description;
  if (args.country !== undefined) fields.country = args.country;
  if ("due_date" in args) fields.due_date = args.due_date ?? null;
  if (args.status !== undefined) fields.status = args.status;
  if (args.task_role !== undefined) fields.task_role = args.task_role;

  if (args.assignee_name !== undefined) {
    if (!args.assignee_name) {
      fields.assignees = [];
      fields.assignee_telegram_ids = [];
    } else {
      const match = await matchAssignee(args.assignee_name);
      if (match) {
        fields.assignees = [match.display_name];
        fields.assignee_telegram_ids = [match.telegram_id];
      } else {
        fields.assignees = [args.assignee_name];
        fields.assignee_telegram_ids = [];
      }
    }
  }

  try {
    await updateTask(args.id, fields);
    return `✅ Задача обновлена.`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function toolDeleteTask(args: { id: string; requesting_user_id: number }): Promise<string> {
  const task = await getTask(args.id);
  if (!task) return `Задача ${args.id} не найдена.`;
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId || task.group_id !== groupId) return `Нет доступа: задача не принадлежит твоему воркспейсу.`;
  try {
    await deleteTask(args.id);
    return `✅ Задача «${task.title}» удалена.`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function toolGetTasks(args: {
  assignee?: string;
  country?: string;
  status?: string;
  period?: string;
  label?: string;
  requesting_user_id: number;
}): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  const labelIds = args.label ? await resolveLabelIds(args.requesting_user_id, [args.label], false) : [];

  const tasks = await listTasks({
    status: args.status,
    country: args.country,
    period: args.period,
    assigneeText: args.assignee,
    labelIds: labelIds.length ? labelIds : undefined,
    viewerId: args.requesting_user_id,
    limit: 30,
  }, groupId);

  if (!tasks.length) return "Задач не найдено.";

  return tasks.map(t => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` | дедлайн: ${t.due_date}` : "";
    const country = t.country ? ` | ${t.country}` : "";
    return `• [${t.status}] ${t.title}\n  Исполнитель: ${who}${due}${country}`;
  }).join("\n\n");
}

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "add_task",
    description: "Создать новую задачу. Используй после того как пользователь подтвердил список задач из транскрипта.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название задачи" },
        description: { type: "string", description: "Описание или детали (опционально)" },
        assignee_name: { type: "string", description: "Имя, фамилия или ник исполнителя (опционально)" },
        country: { type: "string", description: "Рынок/страна (опционально)" },
        due_date: { type: "string", description: "Дедлайн в формате YYYY-MM-DD (опционально)" },
        source: { type: "string", enum: ["transcript", "claude", "manual"], description: "Источник задачи" },
        context_id: { type: "string", description: "ID записи в базе знаний (опционально)" },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        labels: { type: "array", items: { type: "string" }, description: "Имена личных смарт-меток (папок). Задача с метками становится личной." },
      },
      required: ["title", "source"],
    },
  },
  {
    name: "update_task",
    description: "Обновить задачу по ID. Передай только поля которые нужно изменить. due_date: null — убрать дедлайн.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        title: { type: "string" },
        description: { type: "string" },
        assignee_name: { type: "string", description: "Новый исполнитель. Пустая строка — убрать исполнителя." },
        country: { type: "string" },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD или null чтобы убрать" },
        status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"] },
        labels: { type: "array", items: { type: "string" }, description: "Имена личных смарт-меток. Работает только на твоих личных задачах." },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["id", "requesting_user_id"],
    },
  },
  {
    name: "delete_task",
    description: "Удалить задачу по ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["id", "requesting_user_id"],
    },
  },
];

export const LABEL_TOOL_DEFINITIONS = [
  {
    name: "list_task_labels",
    description: "Показать твои личные смарт-метки (папки) задач: имя + id.",
    inputSchema: {
      type: "object",
      properties: { requesting_user_id: { type: "number", description: "Твой Telegram user ID" } },
      required: ["requesting_user_id"],
    },
  },
];
