import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
  country: string | null;
  task_role: string | null;
  source: string;
  status: string;
  created_at: string;
};

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

export async function toolAddTask(args: {
  title: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string;
  task_role?: string;
  source: string;
  context_id?: string;
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

  const { data, error } = await supabase.from("tasks").insert({
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
  }).select("id").single();

  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача создана (id: ${data.id})${matchWarning}.`;
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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (args.title !== undefined) updates.title = args.title;
  if (args.description !== undefined) updates.description = args.description;
  if (args.country !== undefined) updates.country = args.country;
  if ("due_date" in args) updates.due_date = args.due_date ?? null;
  if (args.status !== undefined) updates.status = args.status;
  if (args.task_role !== undefined) updates.task_role = args.task_role;

  if (args.assignee_name !== undefined) {
    if (!args.assignee_name) {
      updates.assignees = [];
      updates.assignee_telegram_ids = [];
    } else {
      const match = await matchAssignee(args.assignee_name);
      if (match) {
        updates.assignees = [match.display_name];
        updates.assignee_telegram_ids = [match.telegram_id];
      } else {
        updates.assignees = [args.assignee_name];
        updates.assignee_telegram_ids = [];
      }
    }
  }

  const { error } = await supabase.from("tasks").update(updates).eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача обновлена.`;
}

export async function toolDeleteTask(args: { id: string }): Promise<string> {
  const { data: task } = await supabase.from("tasks").select("title").eq("id", args.id).maybeSingle();
  if (!task) return `Задача ${args.id} не найдена.`;
  await supabase.from("task_history").delete().eq("task_id", args.id);
  const { error } = await supabase.from("tasks").delete().eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача «${(task as { title: string }).title}» удалена.`;
}

export async function toolGetTasks(args: {
  assignee?: string;
  country?: string;
  status?: string;
  period?: string;
}): Promise<string> {
  let query = supabase.from("tasks").select("*").order("due_date", { ascending: true });

  if (args.status) {
    query = query.eq("status", args.status);
  } else {
    query = query.not("status", "in", '("done","cancelled","draft")');
  }
  if (args.country) query = query.ilike("country", `%${args.country}%`);
  if (args.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data, error } = await query.limit(30);
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Задач не найдено.";

  let tasks = data as TaskRow[];
  if (args.assignee) {
    const lower = args.assignee.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some((a: string) => a.toLowerCase().includes(lower)));
  }

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
