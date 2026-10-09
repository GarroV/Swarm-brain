import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Task, TaskInput } from "./types.ts";
import { completionPatch, hidesClosedByDefault, isClosedStatus, shouldCascadeClose } from "./statuses.ts";
import { buildRecurPatch, type RecurRow, todayInTz } from "./recurrence.ts";
import { defaultDueDate } from "./due.ts";
import { historyRowsFor, isJournaled, type TaskSnapshot } from "./history.ts";
import { duplicateRecurClose, recurCloseNote } from "./recur-close.ts";
import { ASSIGNEE_SCAN_LIMIT, narrowByAssignee } from "./assignee-filter.ts";
import { archivePatch } from "./live.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function createTask(
  input: TaskInput,
  groupId?: string,
): Promise<Task> {
  const { data, error } = await supabase.from("tasks").insert({
    title: input.title,
    description: input.description ?? null,
    assignees: input.assignees ?? [],
    assignee_telegram_ids: input.assignee_telegram_ids ?? [],
    assignee_person_id: input.assignee_person_id ?? null,
    coassignee_person_ids: input.coassignee_person_ids ?? [],
    // Срок обязателен у КАЖДОЙ задачи, откуда бы она ни пришла — веб, бот, MCP, доска
    // (решение владельца 21.09.2026: «по дефолту дедлайн +1 день от времени добавления»).
    // Значение ставится здесь, в единственной точке создания, а не в трёх клиентах: копии
    // одного правила в разных клиентах у нас уже расходились (линза задач, #440).
    due_date: input.due_date ?? defaultDueDate(),
    remind_date: input.remind_date ?? null,
    remind_set_by: input.remind_date ? (input.remind_set_by ?? input.created_by_telegram_id ?? null) : null,
    tags: input.tags ?? [],
    country: input.country ?? null,
    task_role: input.task_role ?? null,
    priority: input.priority ?? null,
    source: input.source ?? "manual",
    status: input.status ?? "open",
    // Задача может родиться уже закрытой (импорт, MCP) — тогда дата закрытия ставится сразу.
    completed_at: isClosedStatus(input.status) ? new Date().toISOString() : null,
    meeting_id: input.meeting_id ?? null,
    group_id: groupId ?? input.group_id ?? null,
    confirmed: input.confirmed ?? false,
    created_by_telegram_id: input.created_by_telegram_id ?? null,
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
    recur_interval: input.recur_interval ?? 1,
    recur_weekdays: input.recur_weekdays ?? null,
    recur_setpos: input.recur_setpos ?? null,
    // Пустой массив, а не null: колонка объявлена not null, и «ссылок нет» — это пустой
    // список, по которому фронт сразу рисует поле, не проверяя на null.
    links: input.links ?? [],
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function getTask(id: string): Promise<Task | null> {
  // Архивная задача для приложения не существует — ровно как удалённая до 21.09.2026 (issue #427).
  const { data } = await supabase.from("tasks").select("*").eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
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
  sprintId?: string;
  tags?: string[]; // ANY-совпадение (overlaps)
  labelIds?: string[]; // ANY-совпадение (overlaps по label_ids)
  projectId?: string;
  /** Только задачи вне проектов (`project_id IS NULL`), issue #626. */
  noProject?: boolean;
  startDateFrom?: string;
  startDateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}, groupId?: string): Promise<{ tasks: Task[]; total: number | null }> {
  let q = supabase
    .from("tasks")
    .select(filters.columns ?? "*", { count: "exact" })
    .is("archived_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (filters.confirmed !== undefined) q = q.eq("confirmed", filters.confirmed);
  // Правило «закрытые прячем» живёт в statuses.ts чистой функцией (issue #304): здесь оно
  // накладывалось ДО eq("status", …), и явный запрос `status: "done"` давал пустое пересечение.
  if (hidesClosedByDefault(filters)) {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.country) q = q.ilike("country", `%${filters.country}%`);
  if (filters.createdBy !== undefined) {
    q = q.eq("created_by_telegram_id", filters.createdBy);
  }
  if (filters.sprintId) q = q.eq("sprint_id", filters.sprintId);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.noProject) q = q.is("project_id", null);
  if (filters.tags && filters.tags.length > 0) {
    q = q.overlaps("tags", filters.tags);
  }
  if (filters.labelIds && filters.labelIds.length > 0) {
    q = q.overlaps("label_ids", filters.labelIds);
  }
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

  const limit = filters.limit ?? 200;
  // Исполнитель фильтруется в JS (assignee-filter.ts), поэтому при нём база отдаёт широкий
  // срез, а лимит выдачи применяется уже после фильтра (issue #626).
  const { data, count } = await q.limit(
    filters.assigneeText ? Math.max(limit, ASSIGNEE_SCAN_LIMIT) : limit,
  );
  // Двойное приведение: при динамическом select(string) supabase-js не может вывести форму
  // строки и типизирует результат как GenericStringError[]. Форму гарантирует TASK_LIST_COLUMNS
  // (под тестом) и тип Task, где выброшенные проекцией поля помечены опциональными.
  const tasks = (data ?? []) as unknown as Task[];

  // total = сколько строк подходит под фильтры БЕЗ лимита. Нужен, чтобы ответ мог честно
  // сказать «показаны N из M»: лимит режет КОНЕЦ сортировки (due_date ASC nulls last), то есть
  // задачи без срока (issue #111/#112).
  if (filters.assigneeText) {
    // Срез базы сам упёрся в потолок — число подошедших тогда неизвестно, врать им нельзя.
    const scanCapped = typeof count === "number" && count > tasks.length;
    const narrowed = narrowByAssignee(tasks, filters.assigneeText, limit);
    return { tasks: narrowed.tasks, total: scanCapped ? null : narrowed.total };
  }

  return { tasks, total: typeof count === "number" ? count : null };
}

/** Обёртка для вызывающих, которым нужен только список (бот, MCP). */
export async function listTasks(
  filters: Parameters<typeof listTasksWithTotal>[0],
  groupId?: string,
): Promise<Task[]> {
  return (await listTasksWithTotal(filters, groupId)).tasks;
}

/** Снимок задачи ДО апдейта: поля для переката, даты закрытия и журнала изменений. */
type UpdateSnapshotRow = TaskSnapshot & {
  status: string;
  completed_at: string | null;
  recur_freq: string | null;
  recur_anchor_dom: number | null;
  recur_interval: number | null;
  recur_weekdays: number[] | null;
  recur_setpos: number | null;
  due_date: string | null;
  start_date: string | null;
  remind_date: string | null;
  group_id: string | null;
};

/** Задача не закрылась, а перекатилась на следующий цикл: `from` — прежний срок, `to` — новый. */
export interface RecurResult {
  recurred: { from: string; to: string };
}

type UpdateFields = Partial<TaskInput> & {
  status?: string;
  url?: string;
  due_date?: string | null;
};
type UpdateOpts = { actor?: string; actorTelegramId?: number };

/**
 * Строку изменили между чтением снимка и записью (ответ функции task_apply_update с кодом
 * PT409). Ничего не записано — патч и журнал надо пересчитать от свежего снимка.
 */
class TaskUpdateConflict extends Error {}

/**
 * Ошибка, текст которой предназначен человеку (конфликт правки, задача не найдена).
 * swarm-api отдаёт её клиенту со своим статусом, а не общим «Something went wrong» (#584).
 */
export class TaskUserError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
  }
}

/** Сколько раз пересчитываем патч, если строку изменили одновременно с нами. */
const MAX_CONFLICT_RETRIES = 3;

/**
 * Единственная точка записи задачи: веб (PATCH /tasks), бот и MCP ходят через неё.
 *
 * Изменение, перекат регулярной задачи и журнал пишутся ОДНОЙ транзакцией в Postgres
 * (`task_apply_update`, issue #577). Любой сбой записи — исключение: вызывающий обязан сказать
 * человеку «не сохранилось», а не «обновлено». До #577 это были три независимых вызова, и
 * ошибку UPDATE никто не читал.
 */
export async function updateTask(
  id: string,
  fields: UpdateFields,
  opts: UpdateOpts = {},
): Promise<RecurResult | null> {
  for (let attempt = 1;; attempt++) {
    try {
      return await updateTaskOnce(id, fields, opts);
    } catch (e) {
      if (!(e instanceof TaskUpdateConflict)) throw e;
      if (attempt >= MAX_CONFLICT_RETRIES) {
        throw new TaskUserError(
          "Задачу одновременно изменил кто-то ещё — обнови и попробуй снова",
          409,
        );
      }
    }
  }
}

async function loadSnapshot(id: string): Promise<UpdateSnapshotRow | null> {
  const { data, error } = await supabase.from("tasks")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  // Без снимка регулярная задача закрылась бы как обычная, а журнал записал бы пустоту —
  // поэтому сбой чтения роняет запрос, а не превращается в «снимка нет».
  if (error) throw new Error(`Не удалось прочитать задачу: ${error.message}`);
  // Двойное приведение: при динамическом select(string) supabase-js форму строки не выводит.
  return data as unknown as UpdateSnapshotRow | null;
}

/** Последнее закрытие цикла этой задачи — для защиты от повторного «готово» (F-018). */
async function lastRecurClose(
  id: string,
): Promise<{ note: string | null; created_at: string } | null> {
  const { data, error } = await supabase.from("task_history")
    .select("note, created_at")
    .eq("task_id", id)
    .like("note", "цикл закрыт%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Не удалось прочитать журнал задачи: ${error.message}`);
  }
  return data as { note: string | null; created_at: string } | null;
}

/** Значение графика: из ЭТОГО патча, если оно в нём есть, иначе сохранённое. */
function pick<K extends keyof RecurRow>(
  fields: UpdateFields,
  row: UpdateSnapshotRow,
  key: K,
): RecurRow[K] {
  const f = fields as Record<string, unknown>;
  return (key in f && f[key] !== undefined ? f[key] ?? null : row[key]) as RecurRow[K];
}

async function updateTaskOnce(
  id: string,
  fields: UpdateFields,
  opts: UpdateOpts,
): Promise<RecurResult | null> {
  let patch: Record<string, unknown> = { ...fields };
  let result: RecurResult | null = null;
  let row: UpdateSnapshotRow | null = null;
  // Чего ждём в строке на момент записи: от этих значений посчитаны перекат и журнал.
  const expect: Record<string, unknown> = {};

  // Снимок нужен, чтобы понять, не перекат ли это, ставить ли дату закрытия и что писать в
  // журнал (решение владельца 09.09.2026: журналируется ЛЮБОЕ поле, кроме служебного шума).
  // Патч только из служебных полей (координаты дерева и т.п.) снимка не требует.
  const touchesJournaled = Object.keys(fields).some(isJournaled);
  if (touchesJournaled) {
    row = await loadSnapshot(id);
    if (!row) throw new TaskUserError("Задача не найдена", 404);

    // Закрытие РЕГУЛЯРНОЙ задачи — не закрытие, а перекат на следующее вхождение графика.
    if (fields.status === "done") {
      // Значения из ЭТОГО же патча важнее сохранённых: срок/частоту могли поменять и закрыть
      // задачу одним запросом (MCP умеет), и считать надо от нового графика.
      const effective: RecurRow = {
        status: "done",
        recur_freq: pick(fields, row, "recur_freq"),
        recur_anchor_dom: pick(fields, row, "recur_anchor_dom"),
        recur_interval: pick(fields, row, "recur_interval"),
        recur_weekdays: pick(fields, row, "recur_weekdays"),
        recur_setpos: pick(fields, row, "recur_setpos"),
        due_date: pick(fields, row, "due_date"),
        start_date: pick(fields, row, "start_date"),
        remind_date: pick(fields, row, "remind_date"),
      };
      const recurPatch = buildRecurPatch(effective, todayInTz());
      if (recurPatch) {
        // Повтор только что выполненного «готово» (двойной клик, ретрай MCP) не перекатывает
        // срок второй раз, а отвечает тем же перекатом (F-018). Только если патч не трогает
        // сам график: «перенеси срок и закрой» — это уже другой запрос.
        const touchesSchedule = [
          "due_date",
          "recur_freq",
          "recur_anchor_dom",
          "recur_interval",
          "recur_weekdays",
          "recur_setpos",
        ].some((k) => k in fields);
        if (!touchesSchedule) {
          const dup = duplicateRecurClose({
            lastClose: await lastRecurClose(id),
            currentDue: row.due_date,
            nowMs: Date.now(),
          });
          if (dup) return { recurred: dup };
        }
        patch = { ...patch, ...recurPatch }; // у переката приоритет над «done» из запроса
        result = {
          recurred: { from: effective.due_date!, to: recurPatch.due_date },
        };
        // Перекат считан от этого срока и этого статуса: если параллельный запрос успел их
        // сменить, наш перекат недействителен.
        expect.due_date = row.due_date;
        expect.status = row.status;
        expect.recur_freq = row.recur_freq;
      }
    }
    // Журнал пишет «было → стало» от снимка. Если поле успели поменять параллельно, «было»
    // соврёт — поэтому ждём в строке ровно те значения, от которых считали.
    for (const k of Object.keys(fields)) {
      if (isJournaled(k) && k in row) expect[k] = row[k] ?? null;
    }
  }

  // Дата закрытия считается от ЭФФЕКТИВНОГО статуса — то есть уже после переката, который
  // возвращает задачу в «open»: перекатившаяся задача закрытой не считается.
  const nextStatus = patch.status as string | undefined;
  patch = {
    ...patch,
    ...completionPatch(
      nextStatus,
      row?.completed_at,
      new Date().toISOString(),
    ),
    updated_at: new Date().toISOString(),
  };

  const groupId = (row?.group_id as string | null | undefined) ?? null;
  const history = result
    // В roll-forward-модели от выполнения не остаётся НИКАКОГО следа (статус снова «открыто»),
    // поэтому строка журнала — единственная память о том, что цикл закрыли.
    ? [{
      task_id: id,
      field: "status",
      old_value: "done",
      new_value: "open",
      changed_by: opts.actor ?? "recurring",
      changed_by_telegram_id: opts.actorTelegramId ?? null,
      group_id: groupId,
      old_status: "done",
      new_status: "open",
      note: recurCloseNote(result.recurred.from, result.recurred.to),
    }]
    // Журнал изменений: по строке на каждое РЕАЛЬНО изменившееся поле (issue #286).
    : historyRowsFor({
      taskId: id,
      snapshot: row,
      patch,
      actor: opts.actor ?? null,
      actorTelegramId: opts.actorTelegramId ?? null,
      groupId,
    });

  const { error } = await supabase.rpc("task_apply_update", {
    p_task_id: id,
    p_patch: patch,
    p_expect: expect,
    p_history: history,
  });
  if (error) {
    if (error.code === "PT409") throw new TaskUpdateConflict(error.message);
    if (error.code === "PT404") throw new TaskUserError("Задача не найдена", 404);
    throw new Error(`Задача не сохранена: ${error.message}`);
  }

  // Каскад закрытия на подзадачи (#478). Через ту же функцию: у каждой подзадачи свой журнал и
  // своя дата закрытия. Каждая подзадача — своя транзакция: родитель к этому моменту уже
  // записан, а сбой на подзадаче уходит наверх ошибкой, а не теряется в логе.
  if (row && shouldCascadeClose(row.status, nextStatus, !!result)) {
    const { data: kids, error: kidsErr } = await supabase.from("tasks")
      .select("id, status")
      .eq("parent_id", id)
      .is("archived_at", null);
    if (kidsErr) {
      throw new Error(
        `Задача сохранена, но подзадачи не закрыты: ${kidsErr.message}`,
      );
    }
    for (const k of (kids ?? []) as Array<{ id: string; status: string }>) {
      if (isClosedStatus(k.status)) continue;
      await updateTask(k.id, { status: nextStatus }, opts);
    }
  }

  return result;
}

// АРХИВИРУЕТ задачу (решение владельца 21.09.2026, issue #427). Для человека поведение
// прежнее: задача исчезает из списков. Разница — строка остаётся в базе.
//
// Историю больше НЕ стираем. Раньше `deleteTask` сносил `task_history` первым делом, и журнал
// пропадал ровно в том случае, ради которого заводился: «куда делась задача и кто её убрал».
export async function deleteTask(
  id: string,
  archivedBy?: number,
): Promise<void> {
  await supabase.from("tasks")
    .update(archivePatch(archivedBy))
    .eq("id", id).is("archived_at", null);
}

/** Сколько архивных задач отдаём за раз: архив копится годами, а читают его верхушку. */
export const ARCHIVE_PAGE = 200;

/** Архив воркспейса (#489), свежие сверху. Воркспейс задаёт вызывающий. */
export async function listArchivedTasks(groupId: string): Promise<Task[]> {
  // archive-ok: это и есть экран архива — выборка ровно архивных задач
  const { data, error } = await supabase.from("tasks").select("*")
    .eq("group_id", groupId).not("archived_at", "is", null)
    .order("archived_at", { ascending: false }).limit(ARCHIVE_PAGE);
  if (error) throw new Error(`archive list: ${error.message}`);
  return (data ?? []) as Task[];
}

/** Архивная задача по id; живая — null (возвращать из архива нечего). */
export async function getArchivedTask(id: string): Promise<Task | null> {
  // archive-ok: возврат из архива читает именно архивную строку
  const { data } = await supabase.from("tasks").select("*").eq("id", id)
    .not("archived_at", "is", null).maybeSingle();
  return data as Task | null;
}

/** Вернуть задачу из архива (#489). Состав спринтов, из которого она ушла при архивации, не
 *  восстанавливается: спринт за это время мог быть принят, и задача вернулась бы в чужой план. */
export async function restoreTask(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("tasks")
    .update({ archived_at: null, archived_by: null, updated_at: new Date().toISOString() })
    .eq("id", id).not("archived_at", "is", null).select("id").maybeSingle();
  if (error) throw new Error(`archive restore: ${error.message}`);
  return !!data;
}
