// Задачи СТОРОНЫ (страны) для блока контекста встречи в рекордере (meeting-context).
//
// Вынесено из обработчика ради теста на базе: выборка идёт SERVICE_ROLE_KEY мимо listTasks, и
// пропущенный здесь фильтр видимости показывает задачу закрытого проекта на экране чужого
// созвона (решение владельца 16.10.2026, docs/decisions/2026-10-16-security-fixes.md).
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onlyLive } from "./live.ts";
import { dropUnknownProjects, loadProjectVisibility, visibleProjectFilter } from "./project-visibility.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type CountryTaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  assignees: string[] | null;
  status: string;
  project_id: string | null;
};

/** Открытые подтверждённые задачи страны в воркспейсе, видимые зрителю, по сроку. */
export async function loadCountryTasks(opts: {
  groupId: string | null;
  country: string;
  viewerId: number;
  hiddenStatuses: readonly string[];
  limit: number;
}): Promise<CountryTaskRow[]> {
  let q = onlyLive(
    supabase.from("tasks").select("id, title, due_date, assignees, status, project_id"),
  )
    .eq("country", opts.country)
    .not("status", "in", `(${opts.hiddenStatuses.join(",")})`)
    .eq("confirmed", true)
    .or(`is_private.eq.false,owner_id.eq.${opts.viewerId}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(opts.limit);
  if (opts.groupId) q = q.eq("group_id", opts.groupId);
  // Фильтр видимости — в самой выборке, а не после: иначе скрытые задачи съедали бы лимит.
  const visibility = await loadProjectVisibility(opts.groupId ?? undefined, opts.viewerId);
  const projectFilter = visibleProjectFilter(visibility.hidden);
  if (projectFilter) q = q.or(projectFilter);
  const { data, error } = await q;
  if (error) throw new Error(`country tasks: ${error.message}`);
  return dropUnknownProjects((data ?? []) as CountryTaskRow[], visibility.known);
}
