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

/**
 * id проектов, задачи которых зрителю не показываются. Без воркспейса — по всем проектам.
 * Сбой чтения — ошибка, а не пустой список: пустой список означал бы «показать всё».
 */
export async function loadHiddenProjectIds(
  groupId: string | undefined,
  viewerId: number | undefined,
): Promise<string[]> {
  // Архивные строки тоже: архивный закрытый проект прячет свои задачи так же, как живой.
  let q = supabase.from("projects").select("id, parent_id, created_by, is_private");
  if (groupId) q = q.eq("group_id", groupId);
  const { data, error } = await q.limit(PROJECT_ROWS_CAP);
  if (error) throw new Error(`project visibility: ${error.message}`);
  return hiddenProjectIds(
    (data ?? []) as Array<ProjectAccessRow & { id: string }>,
    viewerId,
  );
}

/**
 * Условие PostgREST для `.or(...)`: задача без проекта или проект не из скрытых.
 * null — скрытых нет, фильтр не нужен. id — uuid из базы, экранирование не требуется.
 */
export function visibleProjectFilter(hidden: string[]): string | null {
  if (hidden.length === 0) return null;
  return `project_id.is.null,project_id.not.in.(${hidden.join(",")})`;
}

/** Видна ли зрителю эта задача по её проекту. Задача без проекта видна всем в воркспейсе. */
export async function taskVisibleByProject(
  task: { group_id?: string | null; project_id?: string | null },
  viewerId: number | undefined,
): Promise<boolean> {
  if (!task.project_id) return true;
  const hidden = await loadHiddenProjectIds(task.group_id ?? undefined, viewerId);
  return !hidden.includes(task.project_id);
}
