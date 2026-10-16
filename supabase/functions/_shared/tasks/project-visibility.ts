// Видимость ЗАДАЧ через их проект: задача закрытого проекта видна только тому, кто видит
// сам проект (решение владельца 16.10.2026, docs/decisions/2026-10-16-security-fixes.md).
//
// Правило — canViewProject (project-access.ts); здесь только загрузка строк воркспейса и
// форма фильтра для выборки задач. Все ходят SERVICE_ROLE_KEY, RLS не защищает: пропущенная
// здесь проверка сразу показывает задачу.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hiddenProjectIds, type ProjectAccessRow } from "./project-access.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Потолок строк проектов на воркспейс — тот же порядок, что у canMutateProject (единицы-десятки).
const PROJECT_ROWS_CAP = 2000;

export type ProjectVisibility = {
  /** Проекты, задачи которых зрителю не показываются. Идут в фильтр выборки. */
  hidden: string[];
  /** Все проекты области (с архивными). Задача с проектом вне этого списка не показывается. */
  known: Set<string>;
};

/**
 * Видимость проектов области для зрителя. Без воркспейса — по всем проектам.
 * Всё, что не удалось установить, — отказ, а не «показать»: сбой чтения и упор в потолок
 * строк дают ошибку (иначе проекты за потолком не попали бы в скрытые), а проект, которого
 * нет в списке (`known`), прячет свою задачу (taskVisibleByProject, dropUnknownProjects).
 */
export async function loadProjectVisibility(
  groupId: string | undefined,
  viewerId: number | undefined,
): Promise<ProjectVisibility> {
  // Архивные строки тоже: архивный закрытый проект прячет свои задачи так же, как живой.
  let q = supabase.from("projects").select("id, parent_id, created_by, is_private");
  if (groupId) q = q.eq("group_id", groupId);
  const { data, error } = await q.limit(PROJECT_ROWS_CAP + 1);
  if (error) throw new Error(`project visibility: ${error.message}`);
  const rows = (data ?? []) as Array<ProjectAccessRow & { id: string }>;
  if (rows.length > PROJECT_ROWS_CAP) {
    throw new Error(`project visibility: больше ${PROJECT_ROWS_CAP} проектов — видимость не установить`);
  }
  return {
    hidden: hiddenProjectIds(rows, viewerId),
    known: new Set(rows.map((r) => r.id)),
  };
}

/** Только скрытые — для вызывающих, которым нужен фильтр выборки. */
export async function loadHiddenProjectIds(
  groupId: string | undefined,
  viewerId: number | undefined,
): Promise<string[]> {
  return (await loadProjectVisibility(groupId, viewerId)).hidden;
}

/**
 * Условие PostgREST для `.or(...)`: задача без проекта или проект не из скрытых.
 * null — скрытых нет, фильтр не нужен. id — uuid из базы, экранирование не требуется.
 */
export function visibleProjectFilter(hidden: string[]): string | null {
  if (hidden.length === 0) return null;
  return `project_id.is.null,project_id.not.in.(${hidden.join(",")})`;
}

/**
 * Добивка после выборки: задача, чей проект не найден в области (чужой воркспейс, сбитая
 * ссылка), не показывается — фильтр выборки знает только «скрытые» и такую пропустил бы.
 * Строки без колонки `project_id` в проекции не трогаются: по ним решить нечего.
 */
export function dropUnknownProjects<T extends { project_id?: string | null }>(
  rows: T[],
  known: Set<string>,
): T[] {
  return rows.filter((t) => !t.project_id || known.has(t.project_id));
}

/** Видна ли зрителю эта задача по её проекту. Задача без проекта видна всем в воркспейсе. */
export async function taskVisibleByProject(
  task: { group_id?: string | null; project_id?: string | null },
  viewerId: number | undefined,
): Promise<boolean> {
  if (!task.project_id) return true;
  const { hidden, known } = await loadProjectVisibility(task.group_id ?? undefined, viewerId);
  return known.has(task.project_id) && !hidden.includes(task.project_id);
}
