import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Project, ProjectInput } from "./types.ts";
import { type ProjectRef, validateParent } from "./project-nesting.ts";
import { canViewProject, parentLookup, type ProjectAccessRow } from "./project-access.ts";
import { projectEventRow, type ProjectHistoryRow, projectHistoryRowsFor } from "./project-history.ts";
import { onlyLive } from "./live.ts";
import {
  dissolvePlan,
  dissolveTargets,
  parentForSprintGroup,
  type ProjectMove,
  withoutSprintGroups,
} from "./sprint-groups.ts";
import { updateTask } from "./db.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Все операции изолированы по group_id — проект принадлежит воркспейсу.

/**
 * Единственная точка записи журнала проектов (issue #426). Ошибку НЕ роняем наверх — журнал не
 * должен ломать саму операцию, — но и не проглатываем молча: пустая история через месяц
 * неотличима от «никто ничего не двигал», и именно так уже вышло с задачами (issue #287).
 */
async function writeHistory(rows: ProjectHistoryRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("project_history").insert(rows);
  if (error) {
    console.error("project_history insert failed:", error.message);
  }
}

export type ProjectWithCounts = Project & {
  task_count: number;
  backlog_count: number;
};

// Проекты воркспейса + счётчики: всего задач в проекте и из них в бэклоге (project_linked=false).
// Счётчики считают все живые задачи воркспейса: «личных» задач нет (решение 2026-10-09).
export async function listProjects(
  groupId: string,
  opts: {
    viewerId?: number;
    /**
     * Включить группы спринта (`sprint_group`). Нужно только экрану спринта и MCP: по умолчанию
     * их нет нигде — доска «Проекты», селекторы и хаб не должны видеть временных групп.
     */
    withSprintGroups?: boolean;
  } = {},
): Promise<ProjectWithCounts[]> {
  // Тянем ВСЕ строки воркспейса и фильтруем приватность проектов в JS ниже — осознанный трейдофф:
  // проектов в воркспейсе на порядки меньше, чем задач/записей (обычно единицы-десятки, не тысячи).
  // .limit(500) — просто защитный потолок, а не расчётный лимит: DB-гард глубины (migration
  // 20260812140000) ограничивает вложенность (2 уровня), но НЕ число строк на group_id.
  // Порядок задаёт `position` (перестановка на доске, issue #433); строки без неё — в хвост по
  // дате создания. Тот же предикат повторяет фронт (miniapp/src/lib/projectOrder.ts): порядок
  // должен совпадать до и после перерисовки списка. `archived_at is null` — архив не показываем
  // нигде, где раньше показывался удалённый проект, то есть нигде (issue #427).
  const { data: projects } = await supabase
    .from("projects").select("*").eq("group_id", groupId)
    .is("archived_at", null)
    .order("position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(500);
  let list = (projects ?? []) as Project[];

  // Доска — общее пространство команды (решение владельца 2026-08-24): проект и подпроект видны
  // всем в воркспейсе, пока на них (или на их группе) не включён тумблер-глаз `is_private`.
  // Приватность наследуется вниз — закрытая группа уносит с собой все свои подпроекты; индекс
  // родителей строим по ПОЛНОМУ списку воркспейса ДО фильтрации, иначе у подпроекта пропадёт
  // группа и он схлопнется в fail-closed. created_by=null (легаси/системная строка) не прячем
  // ни от кого. Админского обхода нет намеренно (решение 2026-08-21).
  const index = parentLookup(list);
  // Группы спринта отсекаются по ПОЛНОМУ списку: ребёнку группы нужен родитель, чтобы понять,
  // что он тоже спрятан (sprint-groups.ts).
  const shown = opts.withSprintGroups ? list : withoutSprintGroups(list);
  list = shown.filter((p) => canViewProject(p, opts.viewerId, index));
  if (list.length === 0) return [];

  // Считаем задачи по проектам одним запросом (без N+1).
  const tasksQuery = onlyLive(
    supabase
      .from("tasks").select("project_id, project_linked"),
  )
    .eq("group_id", groupId)
    .in("project_id", list.map((p) => p.id));
  const { data: tasks } = await tasksQuery;
  const counts = new Map<string, { total: number; backlog: number }>();
  ((tasks ?? []) as Array<
    { project_id: string | null; project_linked: boolean }
  >).forEach((t) => {
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

/** Одна инициатива воркспейса. Нужна правке: часть проверок сверяется с тем, что уже стоит. */
export async function getProject(
  id: string,
  groupId: string,
): Promise<Project | null> {
  const { data } = await supabase.from("projects")
    .select("*").eq("id", id).eq("group_id", groupId)
    .is("archived_at", null).maybeSingle();
  return (data as Project | null) ?? null;
}

/** Позиция для новой строки: в конец списка своих братьев (шаг тот же, что у бэкфилла миграции). */
const POSITION_STEP = 1000;
async function nextPosition(
  groupId: string,
  parentId: string | null,
): Promise<number> {
  let q = supabase.from("projects").select("position").eq("group_id", groupId)
    .not("position", "is", null)
    .order("position", { ascending: false }).limit(1);
  q = parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId);
  const { data } = await q.maybeSingle();
  const last = (data as { position: number | null } | null)?.position ?? null;
  return last === null ? POSITION_STEP : last + POSITION_STEP;
}

export async function createProject(
  input: ProjectInput,
  groupId: string,
  createdBy: number | null,
): Promise<Project> {
  const parentId = input.parent_id ?? null;
  if (parentId !== null) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id, sprint_group").eq(
        "group_id",
        groupId,
      )
      .is("archived_at", null);
    const all = (refs ?? []) as Array<ProjectRef & { sprint_group: boolean }>;
    const v = validateParent({ projectId: null, parentId, all });
    if (!v.ok) throw new Error(v.error);
    // Под группу спринта ничего не вешаем — ни новую группу, ни обычный подпроект: ребёнок
    // спрятался бы вместе с ней, а после «проброса» висел бы на доске без смысла.
    const groupErr = parentForSprintGroup(parentId, all);
    if (groupErr) throw new Error(groupErr);
  }
  const position = input.position ?? await nextPosition(groupId, parentId);
  const { data, error } = await supabase.from("projects").insert({
    group_id: groupId,
    name: input.name,
    position,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    parent_id: parentId,
    created_by: createdBy,
    sprint_id: input.sprint_id ?? null,
    is_private: input.is_private ?? false,
    owner_telegram_id: input.owner_telegram_id ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    sprint_group: input.sprint_group ?? false,
  }).select().single();
  if (error) throw new Error(error.message);
  const project = data as Project;
  await writeHistory([
    projectEventRow({
      projectId: project.id,
      event: "created",
      value: project.name,
      actorTelegramId: createdBy ?? null,
      groupId,
    }),
  ]);
  return project;
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
  // Признак группы спринта только снимается («В проекты»): поставить его существующему проекту
  // значило бы молча убрать проект с доски у всей команды.
  if (fields.sprint_group === true) {
    throw new Error("sprint_group можно только снять");
  }
  if ("parent_id" in fields) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id, sprint_group").eq(
        "group_id",
        groupId,
      )
      .is("archived_at", null);
    const all = (refs ?? []) as Array<ProjectRef & { sprint_group: boolean }>;
    const v = validateParent({
      projectId: id,
      parentId: fields.parent_id ?? null,
      all,
    });
    if (!v.ok) throw new Error(v.error);
    const groupErr = parentForSprintGroup(fields.parent_id ?? null, all);
    if (groupErr) throw new Error(groupErr);
  }
  if (!(await canMutateProject(id, groupId, opts))) return null;
  // Снимок ДО правки — иначе журналу не с чем сравнивать, и в него пошли бы строки
  // «было X, стало X» на каждое поле формы, в которых настоящий переезд не найти.
  const before = await getProject(id, groupId);
  const { data } = await supabase.from("projects")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  const updated = (data as Project | null) ?? null;
  if (!updated) return null;

  const rows = projectHistoryRowsFor({
    projectId: id,
    snapshot: before as unknown as Record<string, unknown> | null,
    patch: fields as Record<string, unknown>,
    actorTelegramId: opts.viewerId ?? null,
    groupId,
  });

  // Переезд в другое пространство тащит за собой подпроекты. Инвариант «подпроект живёт в
  // пространстве родителя» держится везде, где подпроект создаётся или перетаскивается
  // (SprintBoard), — но переезд самого родителя его ломал: дети оставались в прежнем
  // пространстве, а доска рисует их ЧЕРЕЗ родителя, поэтому расхождение было бы не видно
  // глазом и всплыло бы позже, как уже всплыло однажды с пустым разделом.
  if (
    "sprint_id" in fields && before && before.parent_id === null &&
    before.sprint_id !== (fields.sprint_id ?? null)
  ) {
    const { data: kids } = await supabase.from("projects")
      .update({ sprint_id: fields.sprint_id ?? null })
      .eq("group_id", groupId).eq("parent_id", id).is("archived_at", null)
      .select("id");
    for (const kid of (kids ?? []) as Array<{ id: string }>) {
      rows.push(...projectHistoryRowsFor({
        projectId: kid.id,
        snapshot: { sprint_id: before.sprint_id },
        patch: { sprint_id: fields.sprint_id ?? null },
        actorTelegramId: opts.viewerId ?? null,
        groupId,
        note: "вслед за родительским проектом",
      }));
    }
  }

  await writeHistory(rows);
  return updated;
}

// Закрытую строку (тумблер-глаз на ней самой или на её группе) правит/удаляет только автор.
// Открытый проект и открытый подпроект правит любой участник воркспейса (решение владельца
// 2026-07-01 — команда сама себе управляет общими проектами); это распространяется и на сам
// тумблер is_private, пока строка открыта — как только её закрыли, дальнейшие правки (в т.ч.
// снять приватность) доступны только автору.
// SERVICE_ROLE_KEY используется везде (RLS не защищает) — эта проверка ЕДИНСТВЕННАЯ преграда
// между «Анна не видит чужой закрытый проект в списке» и «Анна может его переименовать/удалить,
// зная id напрямую» (см. правило проекта: вся проверка доступа — только через код).
//
// Экспортируется потому, что видимость и право правки у проекта СОВПАДАЮТ (открытый правит любой
// участник, закрытый — только автор), и журналу проекта нужна ровно эта проверка. Отдельный
// предикат «только для чтения» разошёлся бы с этим при первой же правке одного из двух.
//
// Тянем весь список воркспейса, а не одну строку: приватность подпроекта зависит от его группы,
// и без неё предикат честно схлопнется в fail-closed (проектов единицы-десятки, см. listProjects).
export async function canMutateProject(
  id: string,
  groupId: string,
  opts: { viewerId?: number },
): Promise<boolean> {
  const { data } = await supabase.from("projects")
    .select("id, parent_id, created_by, is_private").eq("group_id", groupId)
    .is("archived_at", null)
    .limit(500);
  const rows = (data ?? []) as Array<ProjectAccessRow & { id: string }>;
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  // Критерий тот же, что в listProjects — один предикат на просмотр и на мутацию (project-access.ts).
  return canViewProject(row, opts.viewerId, parentLookup(rows));
}

// АРХИВИРУЕТ проект своего воркспейса (решение владельца 21.09.2026: «всё что удаляется — не
// удаляется, а архивируется», issue #427). Для человека поведение прежнее — проект исчезает из
// интерфейса; разница в том, что строка остаётся в базе и возвращается одним UPDATE.
//
// Уходит ВСЁ поддерево: подпроекты архивируются вместе с группой. Раньше DELETE группы отдавал
// их FK `on delete set null`, и подпроекты всплывали на верхний уровень как самостоятельные —
// человек удалял один проект, а получал россыпь чужих кусков.
//
// Задачи НЕ отвязываем (раньше отвязывали). Связь `tasks.project_id` — это и есть то, что
// делает восстановление осмысленным: вернули проект — вернулся и его состав. Из раздела
// «Задачи» они никуда не пропадают, там свой фильтр по `tasks.archived_at`.
export async function deleteProject(
  id: string,
  groupId: string,
  opts: { viewerId?: number } = {},
): Promise<boolean> {
  if (!(await canMutateProject(id, groupId, opts))) return false;
  const archive = {
    archived_at: new Date().toISOString(),
    archived_by: opts.viewerId ?? null,
  };
  const { data } = await supabase.from("projects")
    .update(archive)
    .eq("id", id).eq("group_id", groupId).is("archived_at", null)
    .select("id").maybeSingle();
  if (!data) return false;
  const { data: kids } = await supabase.from("projects")
    .update(archive)
    .eq("group_id", groupId).eq("parent_id", id).is("archived_at", null)
    .select("id");

  const kidIds = ((kids ?? []) as Array<{ id: string }>).map((k) => k.id);
  await writeHistory([
    projectEventRow({
      projectId: id,
      event: "archived",
      value: kidIds.length ? `с подпроектами: ${kidIds.length}` : null,
      actorTelegramId: opts.viewerId ?? null,
      groupId,
    }),
    ...kidIds.map((kid) =>
      projectEventRow({
        projectId: kid,
        event: "archived",
        actorTelegramId: opts.viewerId ?? null,
        groupId,
        note: "вслед за родительским проектом",
      })
    ),
  ]);
  return true;
}

export async function projectInWorkspace(
  id: string,
  groupId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("projects").select("id").eq("id", id).eq("group_id", groupId)
    .is("archived_at", null)
    .maybeSingle();
  return !!data;
}

/**
 * Распустить группу спринта: задачи возвращаются, откуда пришли (по журналу задачи; нет записи
 * или прежний проект убран — туда, где висела группа), сама группа архивируется — не удаляется (правило архивации, issue #427).
 * Только для `sprint_group`: обычный проект этой кнопкой не разбирается (sprint-groups.ts).
 *
 * Задачи переносятся через `updateTask` по одной: у каждой свой журнал (issue #286), а групп
 * спринта — единицы задач. Отбор задач — по воркспейсу И проекту: id группы уже проверен на
 * воркспейс, но выборка задач не должна полагаться на это молча.
 * Возвращает число перенесённых задач или null (не найдена / нет права / не группа спринта).
 */
export async function dissolveSprintGroup(
  id: string,
  groupId: string,
  opts: { viewerId?: number } = {},
): Promise<{ moved: number } | null> {
  if (!(await canMutateProject(id, groupId, opts))) return null;
  const project = await getProject(id, groupId);
  if (!project) return null;
  const plan = dissolvePlan(project);
  if (!plan.ok) return null;

  const { data: tasks, error } = await onlyLive(
    supabase.from("tasks").select("id, parent_id").eq("group_id", groupId).eq("project_id", id),
  );
  if (error) throw new Error(error.message);
  const rows = (tasks ?? []) as Array<{ id: string; parent_id: string | null }>;
  const ids = rows.map((t) => t.id);
  // Откуда задачи пришли — из журнала (#286); живые проекты — чтобы не вернуть задачу в архив.
  const [movesRes, liveRes] = await Promise.all([
    ids.length
      ? supabase.from("task_history")
        .select("task_id, old_value, new_value, created_at")
        .eq("field", "project").eq("new_value", id).in("task_id", ids)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("projects").select("id")
      .eq("group_id", groupId).is("archived_at", null).neq("id", id),
  ]);
  if (movesRes.error) throw new Error(movesRes.error.message);
  if (liveRes.error) throw new Error(liveRes.error.message);
  const targets = dissolveTargets({
    groupId: id,
    fallback: plan.moveTasksTo,
    tasks: rows,
    moves: (movesRes.data ?? []) as ProjectMove[],
    liveProjectIds: new Set(((liveRes.data ?? []) as Array<{ id: string }>).map((p) => p.id)),
  });
  for (const taskId of ids) {
    // Не `??`: null — законный ответ «вернуть без проекта», а не «ответа нет».
    const to = targets.has(taskId) ? targets.get(taskId)! : plan.moveTasksTo;
    await updateTask(taskId, { project_id: to }, {
      actorTelegramId: opts.viewerId,
    });
  }
  // Архив — после переноса: наоборот задачи на миг указывали бы на архивную группу и
  // при сбое посередине остались бы в «Без направления» вместо родительского проекта.
  const archived = await deleteProject(id, groupId, opts);
  if (!archived) return null;
  return { moved: ids.length };
}
