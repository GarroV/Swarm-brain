import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Task, TaskInput } from "./types.ts";
import { buildRecurPatch, todayInTz, type RecurRow } from "./recurrence.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function createTask(input: TaskInput, groupId?: string): Promise<Task> {
  const { data, error } = await supabase.from("tasks").insert({
    title: input.title,
    description: input.description ?? null,
    assignees: input.assignees ?? [],
    assignee_telegram_ids: input.assignee_telegram_ids ?? [],
    due_date: input.due_date ?? null,
    remind_date: input.remind_date ?? null,
    remind_set_by: input.remind_date ? (input.remind_set_by ?? input.created_by_telegram_id ?? null) : null,
    tags: input.tags ?? [],
    country: input.country ?? null,
    task_role: input.task_role ?? null,
    priority: input.priority ?? null,
    source: input.source ?? "manual",
    status: input.status ?? "open",
    meeting_id: input.meeting_id ?? null,
    group_id: groupId ?? input.group_id ?? null,
    confirmed: input.confirmed ?? false,
    created_by_telegram_id: input.created_by_telegram_id ?? null,
    is_private: input.is_private ?? false,
    owner_id: input.owner_id ?? null,
    start_date: input.start_date ?? null,
    timeline_position: input.timeline_position ?? null,
    sprint_id: input.sprint_id ?? null,
    label_ids: input.label_ids ?? [],
    project_id: input.project_id ?? null,
    project_linked: input.project_linked ?? false,
    parent_id: input.parent_id ?? null,
    tree_x: input.tree_x ?? null,
    tree_y: input.tree_y ?? null,
    recur_freq: input.recur_freq ?? null,
    recur_anchor_dom: input.recur_anchor_dom ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function getTask(id: string): Promise<Task | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return data as Task | null;
}

export async function listTasksWithTotal(filters: {
  status?: string;
  country?: string;
  period?: string;
  telegramId?: number;
  assigneeText?: string;
  limit?: number;
  // Какие колонки тянуть. По умолчанию "*" — так ходят бот и MCP: боту нужен description
  // для формата сообщения. Веб передаёт узкую проекцию (TASK_LIST_COLUMNS, issue #116):
  // вес строки задачи — во многом имена 35 полей JSON, 1146 Б против 583 Б на проекции.
  columns?: string;
  confirmed?: boolean;
  createdBy?: number;
  dueToday?: boolean;
  // Модуль задач (Рой):
  viewerId?: number;        // для visibility приватных задач
  isAdmin?: boolean;        // админ видит все приватные
  sprintId?: string;
  tags?: string[];          // ANY-совпадение (overlaps)
  labelIds?: string[];      // ANY-совпадение (overlaps по label_ids)
  projectId?: string;
  startDateFrom?: string;
  startDateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}, groupId?: string): Promise<{ tasks: Task[]; total: number | null }> {
  let q = supabase
    .from("tasks")
    .select(filters.columns ?? "*", { count: "exact" })
    .order("due_date", { ascending: true, nullsFirst: false });

  // Видимость приватных задач: приватная видна только владельцу (админ — все).
  // Безопасный дефолт: без viewerId показываем только публичные.
  if (!filters.isAdmin) {
    if (filters.viewerId !== undefined) {
      q = q.or(`is_private.eq.false,owner_id.eq.${filters.viewerId}`);
    } else {
      q = q.eq("is_private", false);
    }
  }

  if (filters.confirmed !== undefined) {
    q = q.eq("confirmed", filters.confirmed);
  } else if (!filters.dueToday) {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.country) q = q.ilike("country", `%${filters.country}%`);
  if (filters.createdBy !== undefined) q = q.eq("created_by_telegram_id", filters.createdBy);
  if (filters.sprintId) q = q.eq("sprint_id", filters.sprintId);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.tags && filters.tags.length > 0) q = q.overlaps("tags", filters.tags);
  if (filters.labelIds && filters.labelIds.length > 0) q = q.overlaps("label_ids", filters.labelIds);
  if (filters.startDateFrom) q = q.gte("start_date", filters.startDateFrom);
  if (filters.startDateTo) q = q.lte("start_date", filters.startDateTo);
  if (filters.dueDateFrom) q = q.gte("due_date", filters.dueDateFrom);
  if (filters.dueDateTo) q = q.lte("due_date", filters.dueDateTo);

  if (filters.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [filters.telegramId]);
  }

  if (filters.dueToday) {
    const today = new Date().toISOString().split("T")[0];
    q = q.lte("due_date", today).eq("confirmed", true);
  }

  if (filters.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  if (groupId) q = q.eq("group_id", groupId);

  const { data, count } = await q.limit(filters.limit ?? 200);
  // Двойное приведение: при динамическом select(string) supabase-js не может вывести форму
  // строки и типизирует результат как GenericStringError[]. Форму гарантирует TASK_LIST_COLUMNS
  // (под тестом) и тип Task, где выброшенные проекцией поля помечены опциональными.
  let tasks = (data ?? []) as unknown as Task[];

  // total = сколько строк подходит под фильтры БЕЗ лимита. Нужен, чтобы ответ мог честно
  // сказать «показаны N из M»: сейчас усечение молчит, а лимит режет КОНЕЦ сортировки
  // (due_date ASC nulls last), то есть задачи без срока (issue #111/#112).
  // assigneeText фильтруется уже в JS, ниже, поэтому при нём счётчик из базы соврал бы —
  // отдаём null вместо неверного числа.
  let total: number | null = typeof count === "number" ? count : null;

  if (filters.assigneeText) {
    const lower = filters.assigneeText.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
    total = null;
  }

  return { tasks, total };
}

/** Обёртка для вызывающих, которым нужен только список (бот, MCP). */
export async function listTasks(
  filters: Parameters<typeof listTasksWithTotal>[0],
  groupId?: string,
): Promise<Task[]> {
  return (await listTasksWithTotal(filters, groupId)).tasks;
}

/** Задача не закрылась, а перекатилась на следующий цикл: `from` — прежний срок, `to` — новый. */
export interface RecurResult {
  recurred: { from: string; to: string };
}

export async function updateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
  opts: { actor?: string } = {},
): Promise<RecurResult | null> {
  let patch: Record<string, unknown> = { ...fields };
  let result: RecurResult | null = null;

  // Закрытие РЕГУЛЯРНОЙ задачи — не закрытие, а перекат на следующее вхождение графика.
  // Живёт здесь, потому что это единственная точка записи статуса задач: веб (PATCH /tasks),
  // бот и MCP ходят через неё, и обойти перекат нельзя. Лишний SELECT — только на «done».
  if (fields.status === "done") {
    const { data: row } = await supabase.from("tasks")
      .select("status, recur_freq, recur_anchor_dom, due_date, start_date, remind_date")
      .eq("id", id)
      .maybeSingle();
    if (row) {
      // Значения из ЭТОГО же патча важнее сохранённых: срок/частоту могли поменять и закрыть
      // задачу одним запросом (MCP умеет), и считать надо от нового графика, а не от прежнего.
      const effective: RecurRow = {
        status: (fields.status as string) ?? row.status,
        recur_freq: fields.recur_freq !== undefined ? fields.recur_freq ?? null : row.recur_freq,
        recur_anchor_dom: fields.recur_anchor_dom !== undefined ? fields.recur_anchor_dom ?? null : row.recur_anchor_dom,
        due_date: fields.due_date !== undefined ? fields.due_date ?? null : row.due_date,
        start_date: fields.start_date !== undefined ? fields.start_date ?? null : row.start_date,
        remind_date: fields.remind_date !== undefined ? fields.remind_date ?? null : row.remind_date,
      };
      const recurPatch = buildRecurPatch(effective, todayInTz());
      if (recurPatch) {
        patch = { ...patch, ...recurPatch }; // у переката приоритет над «done» из запроса
        result = { recurred: { from: effective.due_date!, to: recurPatch.due_date } };
      }
    }
  }

  await supabase.from("tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  // В roll-forward-модели от выполнения не остаётся НИКАКОГО следа (статус снова «открыто»,
  // задача в «Готовых» не появится). Строка в уже существующей task_history — единственная
  // память о том, что цикл закрыли.
  if (result) {
    await supabase.from("task_history").insert({
      task_id: id,
      changed_by: opts.actor ?? "recurring",
      old_status: fields.status ?? null,
      new_status: "open",
      note: `цикл закрыт, следующий срок ${result.recurred.to} (было ${result.recurred.from})`,
    });
  }

  return result;
}

export async function deleteTask(id: string): Promise<void> {
  await supabase.from("task_history").delete().eq("task_id", id);
  await supabase.from("tasks").delete().eq("id", id);
}
