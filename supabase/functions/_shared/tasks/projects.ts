import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Project, ProjectInput } from "./types.ts";
import { validateParent, type ProjectRef } from "./project-nesting.ts";
import { canViewProject, type ProjectAccessRow } from "./project-access.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Все операции изолированы по group_id — проект принадлежит воркспейсу.

export type ProjectWithCounts = Project & { task_count: number; backlog_count: number };

// Проекты воркспейса + счётчики: всего задач в проекте и из них в бэклоге (project_linked=false).
// Счётчики обязаны уважать приватность задач (та же видимость, что у listTasks) — иначе
// приватная задача чужого юзера, привязанная к проекту, невидима как узел (GET /tasks её
// отфильтрует), но продолжает утекать числом в task_count/backlog_count карточки проекта.
export async function listProjects(
  groupId: string,
  opts: { viewerId?: number } = {},
): Promise<ProjectWithCounts[]> {
  // В отличие от listTasks (predicate is_private/owner_id пушится в сам SQL-запрос + .limit(200)),
  // тут тянем ВСЕ строки воркспейса и фильтруем приватность в JS ниже — осознанный трейдофф:
  // проектов в воркспейсе на порядки меньше, чем задач/записей (обычно единицы-десятки, не тысячи).
  // .limit(500) — просто защитный потолок, а не расчётный лимит: DB-гард глубины (migration
  // 20260812140000) ограничивает вложенность (2 уровня), но НЕ число строк на group_id.
  const { data: projects } = await supabase
    .from("projects").select("*").eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(500);
  let list = (projects ?? []) as Project[];

  // Приватна строка, если это подпроект (parent_id≠null, скрыт от чужих по умолчанию — запрос
  // владельца 2026-08-19: «чтобы Анна видела не все подпроекты, а только проект Vibe Coding и свои
  // подпроекты») ИЛИ явно помечена is_private (тумблер на проекте ВЕРХНЕГО уровня, тот же день:
  // «скрыть этот конкретный проект из общего пула»). Приватная строка видна только своему
  // created_by (+ админу). created_by=null (легаси-строка/системное создание без юзера) НЕ прячем
  // ни от кого — молча терять доступ к «ничейной» строке хуже, чем показать её лишний раз.
  list = list.filter((p) => canViewProject(p, opts.viewerId));
  if (list.length === 0) return [];

  // Считаем задачи по проектам одним запросом (без N+1), с той же visibility-фильтрацией,
  // что применяет listTasks: приватная задача видна только владельцу (обхода для админа нет).
  // Безопасный дефолт без viewerId — как в listTasks: считаем только публичные.
  let tasksQuery = supabase
    .from("tasks").select("project_id, project_linked")
    .eq("group_id", groupId)
    .in("project_id", list.map((p) => p.id));
  tasksQuery = opts.viewerId !== undefined
    ? tasksQuery.or(`is_private.eq.false,owner_id.eq.${opts.viewerId}`)
    : tasksQuery.eq("is_private", false);
  const { data: tasks } = await tasksQuery;
  const counts = new Map<string, { total: number; backlog: number }>();
  ((tasks ?? []) as Array<{ project_id: string | null; project_linked: boolean }>).forEach((t) => {
    if (!t.project_id) return;
    const c = counts.get(t.project_id) ?? { total: 0, backlog: 0 };
    c.total += 1;
    if (!t.project_linked) c.backlog += 1;
    counts.set(t.project_id, c);
  });
  return list.map((p) => ({
    ...p,
    task_count: counts.get(p.id)?.total ?? 0,
    backlog_count: counts.get(p.id)?.backlog ?? 0,
  }));
}

export async function createProject(
  input: ProjectInput,
  groupId: string,
  createdBy: number | null,
): Promise<Project> {
  const parentId = input.parent_id ?? null;
  if (parentId !== null) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id").eq("group_id", groupId);
    const v = validateParent({ projectId: null, parentId, all: (refs ?? []) as ProjectRef[] });
    if (!v.ok) throw new Error(v.error);
  }
  const { data, error } = await supabase.from("projects").insert({
    group_id: groupId,
    name: input.name,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    parent_id: parentId,
    created_by: createdBy,
    sprint_id: input.sprint_id ?? null,
    is_private: input.is_private ?? false,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Project;
}

// Обновляет только проект своего воркспейса. Возвращает обновлённый или null (не найден/чужой/
// не свой подпроект — намеренно не различаем 404 от «нет доступа», как getEntrySecure для
// entries: не палим существование чужой строки).
export async function updateProject(
  id: string,
  fields: Partial<ProjectInput>,
  groupId: string,
  opts: { viewerId?: number } = {},
): Promise<Project | null> {
  if ("parent_id" in fields) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id").eq("group_id", groupId);
    const v = validateParent({ projectId: id, parentId: fields.parent_id ?? null, all: (refs ?? []) as ProjectRef[] });
    if (!v.ok) throw new Error(v.error);
  }
  if (!(await canMutateProject(id, groupId, opts))) return null;
  const { data } = await supabase.from("projects")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as Project | null) ?? null;
}

// Приватную строку (подпроект ИЛИ явный is_private на верхнем уровне) правит/удаляет только автор
// (+ админ) — тот же критерий, что в listProjects. Публичный проект верхнего уровня по-прежнему
// правит любой участник воркспейса (решение владельца 2026-07-01 — команда сама себе управляет
// общими проектами); это распространяется и на сам тумблер is_private, пока проект публичный —
// как только он станет приватным, дальнейшие правки (в т.ч. снять приватность) — только автору.
// SERVICE_ROLE_KEY используется везде (RLS не защищает) — эта проверка ЕДИНСТВЕННАЯ преграда
// между «Анна не видит чужой приватный проект в списке» и «Анна может его переименовать/удалить,
// зная id напрямую» (см. правило проекта: вся проверка доступа — только через код).
async function canMutateProject(id: string, groupId: string, opts: { viewerId?: number }): Promise<boolean> {
  const { data } = await supabase.from("projects").select("parent_id, created_by, is_private").eq("id", id).eq("group_id", groupId).maybeSingle();
  if (!data) return false;
  // Критерий тот же, что в listProjects — один предикат на просмотр и на мутацию (project-access.ts).
  return canViewProject(data as ProjectAccessRow, opts.viewerId);
}

// Удаляет проект своего воркспейса. Задачи освобождаются (FK ON DELETE SET NULL для project_id),
// а project_linked сбрасываем явно (FK его не трогает).
export async function deleteProject(id: string, groupId: string, opts: { viewerId?: number } = {}): Promise<boolean> {
  if (!(await canMutateProject(id, groupId, opts))) return false;
  const { data } = await supabase.from("projects")
    .delete().eq("id", id).eq("group_id", groupId).select("id").maybeSingle();
  if (!data) return false;
  await supabase.from("tasks")
    .update({ project_linked: false })
    .eq("group_id", groupId).is("project_id", null).eq("project_linked", true);
  return true;
}

export async function projectInWorkspace(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase
    .from("projects").select("id").eq("id", id).eq("group_id", groupId).maybeSingle();
  return !!data;
}
