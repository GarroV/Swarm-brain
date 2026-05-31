import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTask, getTask, listTasks, updateTask, deleteTask } from "../../_shared/tasks/db.ts";

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

async function matchAssignee(name: string): Promise<{ telegram_id: number; display_name: string } | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, email, name_aliases");

  if (!data?.length) return null;
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
    }, groupId ?? undefined);
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
}): Promise<string> {
  const fields: Record<string, unknown> = {};

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

export async function toolDeleteTask(args: { id: string }): Promise<string> {
  const task = await getTask(args.id);
  if (!task) return `Задача ${args.id} не найдена.`;
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
  requesting_user_id?: number;
}): Promise<string> {
  const groupId = args.requesting_user_id ? await resolveGroupId(args.requesting_user_id) : null;

  const tasks = await listTasks({
    status: args.status,
    country: args.country,
    period: args.period,
    assigneeText: args.assignee,
    limit: 30,
  }, groupId ?? undefined);

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
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Удалить задачу по ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
      },
      required: ["id"],
    },
  },
];
