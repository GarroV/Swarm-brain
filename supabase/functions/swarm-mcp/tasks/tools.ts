import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTask, getTask, listTasks, updateTask, deleteTask } from "../../_shared/tasks/db.ts";
import { recurrencePatchFor, resolveRecurrence } from "../../_shared/tasks/recurrence.ts";
import { validateCommentContent } from "../../_shared/tasks/comments.ts";
import { canViewTask, taskAccessError } from "../../_shared/tasks/access.ts";
import { pickProjectByName, type ProjectNameRow } from "../../_shared/tasks/project-access.ts";
import { listProjects } from "../../_shared/tasks/projects.ts";
import { visibleProjectNames } from "../../_shared/tasks/project-access.ts";
import {
  addTaskOutcome,
  formatProjectTree,
  formatRecentComments,
  formatTaskLine,
  projectNotFoundMessage,
  type RecentCommentRow,
} from "./format.ts";

// Оверсайт руководителя по ЗАДАЧАМ — осознанное решение владельца, см. docs/decisions/2026-08-21-admin-visibility.md.
// На проекты и записи он НЕ распространяется.
export const ADMIN_USER_ID = 744230399;


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

export async function resolveGroupId(telegramId: number): Promise<string | null> {
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

// Имя проекта/подпроекта доски → id, в пределах воркспейса (issue #28: MCP не умел класть
// задачи на доску — только в общий список). Точное совпадение по имени приоритетнее частичного;
// при неоднозначности (несколько совпадений) — не гадаем, отдаём null + предупреждение вызывающему,
// как и matchAssignee при неопознанном исполнителе.
export async function fetchProjectRows(groupId: string): Promise<ProjectNameRow[]> {
  const { data } = await supabase.from("projects")
    .select("id, name, parent_id, created_by, is_private").eq("group_id", groupId);
  return (data ?? []) as ProjectNameRow[];
}

async function matchProject(
  groupId: string,
  name: string,
  viewerId: number | undefined,
): Promise<{ id: string; ambiguous: boolean } | null> {
  // Админского обхода нет (решение владельца 2026-08-21): чужой приватный проект не резолвится
  // ни у кого, включая владельца продукта.
  return pickProjectByName(await fetchProjectRows(groupId), name, viewerId);
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
  project_name?: string;
  recur_freq?: string | null;
  status?: string;
  confirmed?: boolean;
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

  // Проект/подпроект доски (issue #28): без него задача создаётся, но на доску (SprintBoard)
  // не попадёт — доска показывает только задачи с project_id.
  let project_id: string | null = null;
  if (args.project_name && groupId) {
    const match = await matchProject(groupId, args.project_name, args.requesting_user_id);
    if (match) {
      project_id = match.id;
      if (match.ambiguous) matchWarning += ` ⚠️ несколько проектов с похожим именем «${args.project_name}» — взят первый попавшийся, проверь на доске`;
    } else {
      matchWarning += ` ⚠️ проект «${args.project_name}» не найден — задача создана без проекта`;
    }
  }

  // Смарт-метки: только на личной задаче владельца. Наличие меток делает задачу личной.
  const labelIds = args.labels?.length && args.requesting_user_id
    ? await resolveLabelIds(args.requesting_user_id, args.labels, true)
    : [];

  // Цикличность — тем же хелпером, что в вебе: частота проверяется, число месяца выводится из
  // срока. Без срока считать следующее вхождение не от чего, поэтому отказ, а не тихое NULL.
  const recur = resolveRecurrence(args.recur_freq, args.due_date ?? null);
  if (!recur.ok) return `Ошибка: ${recur.error}`;

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
      // Бэклог доски — это статус "backlog" (колонка «Бэклог» на SprintBoard ловит всё, что не
      // open/in_progress/done). Без параметра задача ложилась в «Открыто», и человек перетаскивал
      // её руками (issue #200).
      status: args.status ?? "open",
      meeting_id: args.context_id ?? null,
      tags: [],
      // Задача от агента создаётся по прямой команде человека — это не авто-извлечение из
      // встречи, вычитывать её не надо (решение владельца 2026-09-03, issue #201). Веб просит
      // ТОЛЬКО confirmed=true (fetchTasks), поэтому confirmed:false = задача невидима во всём
      // интерфейсе и подтверждается лишь в боте.
      confirmed: args.confirmed ?? true,
      created_by_telegram_id: args.requesting_user_id ?? null,
      label_ids: labelIds,
      is_private: labelIds.length > 0 ? true : undefined,
      owner_id: labelIds.length > 0 ? (args.requesting_user_id ?? null) : undefined,
      project_id,
      recur_freq: recur.recur_freq,
      recur_anchor_dom: recur.recur_anchor_dom,
    }, groupId ?? undefined);
    // Уведомление «подтверди в боте» — только у задач, которые правда ждут вычитки. У задачи,
    // сразу попавшей на доску, подтверждать нечего, и гнать человека в бота незачем.
    const confirmed = args.confirmed ?? true;
    if (!confirmed && args.requesting_user_id) {
      await notifyCreator(args.requesting_user_id, args.title);
    }
    return addTaskOutcome({ id: task.id, confirmed, warning: matchWarning });
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
  project_name?: string;
  recur_freq?: string | null;
  requesting_user_id: number;
}): Promise<string> {
  const task = await getTask(args.id);
  const groupId = await resolveGroupId(args.requesting_user_id);
  // Воркспейс + приватность одним гардом (issue #45): раньше проверялся только воркспейс, и
  // вызов без `labels` правил ЧУЖУЮ личную задачу. Отказ неотличим от «не найдена».
  const denied = taskAccessError(
    args.id, task, args.requesting_user_id,
    args.requesting_user_id === ADMIN_USER_ID, groupId ?? null,
  );
  if (denied) return denied;
  // Сужение для компилятора: гард уже вернул «не найдена» и при task=null, и при groupId=null
  // (тогда task.group_id !== null). Строка недостижима, но без неё TS не знает о сужении.
  if (!task || !groupId) return `Задача ${args.id} не найдена.`;

  const fields: Record<string, unknown> = {};
  let matchWarning = "";

  // Проект/подпроект доски (issue #28). Пустая строка — как у assignee_name — снимает проект.
  if (args.project_name !== undefined) {
    if (!args.project_name) {
      fields.project_id = null;
    } else {
      const match = await matchProject(groupId, args.project_name, args.requesting_user_id);
      if (match) {
        fields.project_id = match.id;
        if (match.ambiguous) matchWarning += ` ⚠️ несколько проектов с похожим именем «${args.project_name}» — взят первый попавшийся, проверь на доске`;
      } else {
        matchWarning += ` ⚠️ проект «${args.project_name}» не найден — project_id не менялся`;
      }
    }
  }

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

  // Цикличность (null — снять). Считаем от ИТОГОВОГО срока: его могли поменять этим же вызовом.
  // Якорь числа месяца хелпер трогает только когда изменился срок или частота — иначе правка
  // одного названия увела бы зажатую задачу с 31-го числа на 28-е.
  if ("recur_freq" in args) {
    const effDue = "due_date" in args ? (args.due_date ?? null) : task.due_date;
    const recur = recurrencePatchFor(args.recur_freq, effDue, task);
    if (!recur.ok) return `Ошибка: ${recur.error}`;
    fields.recur_freq = recur.recur_freq;
    if ("recur_anchor_dom" in recur) fields.recur_anchor_dom = recur.recur_anchor_dom;
  }
  // Регулярная задача без срока молча перестала бы повторяться.
  const effFreq = "recur_freq" in fields ? fields.recur_freq : task.recur_freq;
  const effDueFinal = "due_date" in fields ? fields.due_date : task.due_date;
  if (effFreq && !effDueFinal) {
    return "Ошибка: у регулярной задачи должен быть срок — задай due_date или сними цикличность (recur_freq: null).";
  }

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
    await updateTask(args.id, fields, { actorTelegramId: args.requesting_user_id });
    return `✅ Задача обновлена.${matchWarning}`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function toolDeleteTask(args: { id: string; requesting_user_id: number }): Promise<string> {
  const task = await getTask(args.id);
  const groupId = await resolveGroupId(args.requesting_user_id);
  // Приватность не проверялась ВОВСЕ — участник воркспейса удалял чужую личную задачу (issue #45).
  const denied = taskAccessError(
    args.id, task, args.requesting_user_id,
    args.requesting_user_id === ADMIN_USER_ID, groupId ?? null,
  );
  if (denied) return denied;
  if (!task) return `Задача ${args.id} не найдена.`;   // сужение: гард уже отсёк null
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
  project?: string;
  requesting_user_id: number;
}): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  const labelIds = args.label ? await resolveLabelIds(args.requesting_user_id, [args.label], false) : [];

  // Проект/подпроект доски (issue #28). Не найден — ОТКАЗ, а не игнор фильтра (issue #199):
  // молча отданная полная доска неотличима от «в проекте столько задач», и агент докладывает
  // содержимое чужого проекта как содержимое запрошенного. Строки тянем один раз — из них же
  // берётся подсказка с доступными именами.
  let projectMatch: { id: string; ambiguous: boolean } | null = null;
  if (args.project) {
    const rows = await fetchProjectRows(groupId);
    projectMatch = pickProjectByName(rows, args.project, args.requesting_user_id);
    if (!projectMatch) {
      return projectNotFoundMessage(args.project, visibleProjectNames(rows, args.requesting_user_id));
    }
  }

  const tasks = await listTasks({
    status: args.status,
    country: args.country,
    period: args.period,
    assigneeText: args.assignee,
    labelIds: labelIds.length ? labelIds : undefined,
    projectId: projectMatch?.id,
    viewerId: args.requesting_user_id,
    limit: 30,
  }, groupId);

  if (!tasks.length) return "Задач не найдено.";

  return tasks.map((t) => formatTaskLine(t)).join("\n\n");
}

// Дерево досок воркспейса (issue #198): без него агент не знал имён проектов и подпроектов и
// угадывал их вслепую — «VC», «аудит», «додо аудит систем» мимо `Vibe Coding` / `Audit
// Management System`. Админского обхода нет (решение 2026-08-21): чужие закрытые проекты не
// показываем никому.
export async function toolGetProjects(args: { requesting_user_id: number }): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";
  const projects = await listProjects(groupId, { viewerId: args.requesting_user_id });
  return formatProjectTree(projects);
}

// ── Комментарии к задачам (апдейты) ────────────────────────────────────────────

async function commentTaskGuard(taskId: string, requestingUserId: number): Promise<{ ok: true } | { ok: false; msg: string }> {
  const task = await getTask(taskId);
  const groupId = await resolveGroupId(requestingUserId);
  // Приватную задачу видит только владелец — в MCP админ-байпас НЕ применяем (чистка в вебе),
  // поэтому isAdmin=false намеренно. Тексты отказов сведены к одному «не найдена» (issue #45):
  // раньше «задача приватная» и «не в твоём воркспейсе» отличались от «не найдена», и перебором
  // id подтверждалось само существование чужой личной задачи.
  const denied = taskAccessError(taskId, task, requestingUserId, requestingUserId === ADMIN_USER_ID, groupId ?? null);
  if (denied) return { ok: false, msg: denied };
  return { ok: true };
}

export async function toolGetTaskComments(args: { task_id: string; requesting_user_id: number }): Promise<string> {
  const guard = await commentTaskGuard(args.task_id, args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const { data, error } = await supabase
    .from("task_comments").select("content, added_by_telegram_id, created_at")
    .eq("task_id", args.task_id).order("created_at", { ascending: true });
  if (error) {
    console.error("task_comments list failed:", error);
    return "Ошибка: не удалось загрузить комментарии.";
  }
  const rows = (data ?? []) as Array<{ content: string; added_by_telegram_id: number | null; created_at: string }>;
  if (!rows.length) return "Комментариев пока нет.";
  const ids = [...new Set(rows.map((r) => r.added_by_telegram_id).filter((x): x is number => !!x))];
  const { data: profs } = await supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids.length ? ids : [0]);
  const nameById = new Map<number, string>();
  for (const p of (profs ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>) {
    nameById.set(p.telegram_id, [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.telegram_id));
  }
  return rows.map((r) => {
    const who = r.added_by_telegram_id ? (nameById.get(r.added_by_telegram_id) ?? String(r.added_by_telegram_id)) : "—";
    const when = r.created_at.slice(0, 10);
    return `• [${when}] ${who}: ${r.content}`;
  }).join("\n\n");
}

export async function toolAddTaskComment(args: { task_id: string; content: string; requesting_user_id: number }): Promise<string> {
  const guard = await commentTaskGuard(args.task_id, args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const v = validateCommentContent(args.content);
  if (!v.ok) return `Ошибка: ${v.error}`;
  const { error } = await supabase
    .from("task_comments").insert({ task_id: args.task_id, content: v.value, added_by_telegram_id: args.requesting_user_id });
  if (error) return `Ошибка: ${error.message}`;
  return "✅ Комментарий добавлен.";
}

// Свежие комментарии одним запросом (issue #276). Сценарий — утренний дайджест по задачам
// команды: раньше он требовал N вызовов get_task_comments, по одному на изменившуюся задачу.
const RECENT_DEFAULT_WINDOW_H = 24;   // since не задан — сутки назад: дайджест ежедневный
const RECENT_DEFAULT_LIMIT = 50;
const RECENT_MAX_LIMIT = 200;
// Читаем с запасом к лимиту выдачи: приватные задачи отсеиваются УЖЕ В КОДЕ (RLS не механизм
// авторизации, всё ходит service_role), и без запаса один болтливый чужой тред съедал бы всю
// выдачу — человек получил бы пустой дайджест при живых апдейтах по своим задачам.
const RECENT_READ_MULTIPLIER = 4;
const RECENT_READ_CAP = 500;

export async function toolGetRecentComments(
  args: { since?: string; limit?: number; requesting_user_id: number },
): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  // Неразобранный since — ОТКАЗ, а не тихий дефолт: молча подставленные сутки неотличимы от
  // «за твой период ничего не было», и дайджест соврёт про спокойную неделю.
  let sinceMs: number;
  if (args.since === undefined) {
    sinceMs = Date.now() - RECENT_DEFAULT_WINDOW_H * 3600_000;
  } else {
    const parsed = Date.parse(args.since);
    if (Number.isNaN(parsed)) {
      return `Ошибка: since «${args.since}» не разобрать — нужна дата ISO (2026-09-09 или 2026-09-09T07:00:00Z). Комментарии НЕ показаны.`;
    }
    sinceMs = parsed;
  }
  const sinceISO = new Date(sinceMs).toISOString();
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? RECENT_DEFAULT_LIMIT)), RECENT_MAX_LIMIT);
  const readCap = Math.min(limit * RECENT_READ_MULTIPLIER, RECENT_READ_CAP);

  const { data, error } = await supabase
    .from("task_comments").select("task_id, content, added_by_telegram_id, created_at")
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(readCap);
  if (error) {
    console.error("task_comments recent failed:", error);
    return "Ошибка: не удалось загрузить комментарии.";
  }
  const raw = (data ?? []) as Array<{ task_id: string; content: string; added_by_telegram_id: number | null; created_at: string }>;
  if (!raw.length) return formatRecentComments([], { sinceISO });

  // Видимость считаем тем же каноническим правилом, что и поштучное чтение (canViewTask +
  // воркспейс). Оверсайт админа по задачам сохраняется осознанно — docs/decisions/2026-08-21-admin-visibility.md.
  const isAdmin = args.requesting_user_id === ADMIN_USER_ID;
  const { data: taskRows } = await supabase
    .from("tasks").select("id, title, group_id, is_private, owner_id")
    .in("id", [...new Set(raw.map((r) => r.task_id))]);
  const titleById = new Map<string, string>();
  for (const t of (taskRows ?? []) as Array<{ id: string; title: string; group_id: string | null; is_private: boolean; owner_id: number | null }>) {
    if (t.group_id !== groupId) continue;
    if (!canViewTask(t, args.requesting_user_id, isAdmin)) continue;
    titleById.set(t.id, t.title);
  }

  const visible = raw.filter((r) => titleById.has(r.task_id));
  // Обрезали, если уперлись в потолок чтения ИЛИ доступных больше, чем просили показать.
  const truncated = raw.length >= readCap || visible.length > limit;
  // Забираем limit самых свежих (выдача пришла desc), а печатаем по возрастанию: внутри задачи
  // апдейты должны читаться как история, а не с конца.
  const page = visible.slice(0, limit).reverse();
  if (!page.length) return formatRecentComments([], { sinceISO });

  const authorIds = [...new Set(page.map((r) => r.added_by_telegram_id).filter((x): x is number => !!x))];
  const { data: profs } = await supabase
    .from("user_profiles").select("telegram_id, first_name, last_name")
    .in("telegram_id", authorIds.length ? authorIds : [0]);
  const nameById = new Map<number, string>();
  for (const pr of (profs ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>) {
    nameById.set(pr.telegram_id, [pr.first_name, pr.last_name].filter(Boolean).join(" ") || String(pr.telegram_id));
  }

  const rows: RecentCommentRow[] = page.map((r) => ({
    task_id: r.task_id,
    task_title: titleById.get(r.task_id) ?? r.task_id,
    author: r.added_by_telegram_id ? (nameById.get(r.added_by_telegram_id) ?? String(r.added_by_telegram_id)) : "—",
    created_at: r.created_at,
    content: r.content,
  }));
  return formatRecentComments(rows, { sinceISO, truncated });
}

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "add_task",
    description: "Создать новую задачу. По умолчанию задача сразу попадает на доску и видна в вебе. Для доски укажи project_name (имя из get_projects), иначе задача уйдёт только в общий список.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название задачи" },
        description: { type: "string", description: "Описание или детали (опционально)" },
        assignee_name: { type: "string", description: "Имя, фамилия или ник исполнителя (опционально)" },
        country: { type: "string", description: "Рынок/страна (опционально)" },
        due_date: { type: "string", description: "Дедлайн в формате YYYY-MM-DD (опционально). Год — от текущей даты, не из головы" },
        source: { type: "string", enum: ["transcript", "claude", "manual"], description: "Источник задачи" },
        context_id: { type: "string", description: "ID записи в базе знаний (опционально)" },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        labels: { type: "array", items: { type: "string" }, description: "Имена личных смарт-меток (папок). Задача с метками становится личной." },
        project_name: { type: "string", description: "Имя проекта или подпроекта доски (Проекты/SprintBoard) — без него задача на доску не попадёт, только в общий список. При неточном совпадении берётся ближайшее по имени; при отсутствии — предупреждение в ответе, задача всё равно создаётся." },
        recur_freq: { type: ["string", "null"], enum: ["daily", "weekly", "monthly", null], description: "Цикличность: задача не закрывается, а переносится на следующее вхождение (daily — каждый день, weekly — тот же день недели, monthly — то же число месяца). ТРЕБУЕТ due_date: день недели и число берутся из срока. null — снять цикличность." },
        status: { type: "string", enum: ["backlog", "open", "in_progress", "done", "cancelled"], description: "Колонка доски, куда положить задачу. По умолчанию open («Открыто»); backlog — колонка «Бэклог»." },
        confirmed: { type: "boolean", description: "По умолчанию true — задача сразу на доске. false кладёт её в очередь «На проверке», которая видна ТОЛЬКО в Telegram-боте (в вебе такой задачи не видно вообще) — используй только если человек прямо попросил очередь." },
      },
      required: ["title", "source"],
    },
  },
  {
    name: "update_task",
    description: "Обновить задачу по ID. Передай только поля которые нужно изменить. due_date: null — убрать дедлайн. ⚠️ У РЕГУЛЯРНОЙ задачи (recur_freq заполнен) status: done задачу НЕ закрывает: срок переносится на следующее вхождение, статус снова open.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        title: { type: "string" },
        description: { type: "string" },
        assignee_name: { type: "string", description: "Новый исполнитель. Пустая строка — убрать исполнителя." },
        country: { type: "string" },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD или null чтобы убрать" },
        status: { type: "string", enum: ["backlog", "open", "in_progress", "done", "cancelled"], description: "Колонка доски. backlog — «Бэклог» (issue #200)." },
        labels: { type: "array", items: { type: "string" }, description: "Имена личных смарт-меток. Работает только на твоих личных задачах." },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        project_name: { type: "string", description: "Имя проекта или подпроекта доски. Пустая строка — снять проект (задача уйдёт с доски в общий список)." },
        recur_freq: { type: ["string", "null"], enum: ["daily", "weekly", "monthly", null], description: "Цикличность: задача не закрывается, а переносится на следующее вхождение (daily — каждый день, weekly — тот же день недели, monthly — то же число месяца). ТРЕБУЕТ due_date: день недели и число берутся из срока. null — снять цикличность." },
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

export const PROJECT_TOOL_DEFINITIONS = [
  {
    name: "get_projects",
    description: "Показать доски воркспейса деревом: проекты, их подпроекты, id и счётчики задач. Вызывай ПЕРЕД add_task/get_tasks с project_name — имена проектов угадать нельзя.",
    inputSchema: {
      type: "object",
      properties: {
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу и приватности" },
      },
      required: ["requesting_user_id"],
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

export const COMMENT_TOOL_DEFINITIONS = [
  {
    name: "get_recent_comments",
    description: "Свежие комментарии-апдейты по ВСЕМ доступным тебе задачам одним запросом — для дайджеста «что нового». Сгруппированы по задаче, у каждой печатается id.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "С какого момента брать комментарии: ISO-дата (2026-09-09) или момент (2026-09-09T07:00:00Z). По умолчанию — последние 24 часа. Неразобранное значение = отказ, а не тихий дефолт" },
        limit: { type: "number", description: "Сколько комментариев показать: по умолчанию 50, максимум 200. Если свежих больше — выдача честно скажет, что обрезана" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу и приватности" },
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_task_comments",
    description: "Показать комментарии-апдейты к задаче по её ID (если задача доступна тебе). ID берётся из выдачи get_tasks — он печатается в строке задачи.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи — полный uuid из строки задачи в get_tasks (сокращённый префикс не резолвится)" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["task_id", "requesting_user_id"],
    },
  },
  {
    name: "add_task_comment",
    description: "Добавить комментарий-апдейт к задаче по её ID от твоего лица.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи — полный uuid из строки задачи в get_tasks (сокращённый префикс не резолвится)" },
        content: { type: "string", description: "Текст комментария" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен" },
      },
      required: ["task_id", "content", "requesting_user_id"],
    },
  },
];
