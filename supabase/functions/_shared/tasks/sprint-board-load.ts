// Данные доски спринтов одним запросом (GET /sprint-cycles/board). Чистая часть — полоска
// спринтов задачи — в `sprint-board.ts` под тестами; здесь только сборка из базы.
//
// Доступ — как у панели «План» и у состава спринта, ничего нового не придумано:
//  - группы пространства и их видимость — `listProjects` (закрытый проект скрыт от тех, кто его
//    не видит, вместе со всеми своими задачами);
//  - состав спринтов — `listComposition` с тем же зрителем (закрытые проекты, чужие воркспейсы);
//  - итоги принятых спринтов — `redactCycleStats` (пересчёт без невидимого зрителю).
//
// Принятые спринты приходят БЕЗ состава (`loaded: false`): на доске они свёрнутые полоски с
// заморожёнными итогами, а состав каждого — это ещё шесть запросов. Состав разворачиваемой
// полоски веб берёт обычным GET /sprint-cycles/:id.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onlyLive } from "./live.ts";
import { listProjects } from "./projects.ts";
import { listCycles, redactCycleStats, type SprintCycle } from "./sprint-cycles.ts";
import { listComposition, type SprintItem } from "./sprint-items.ts";
import { buildPlanSpans, type PlanGroupView, type PlanTaskView, type SpanRow } from "./sprint-board.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Страница выборки и общий потолок. Потолок — ошибка, а не молчаливое усечение: обрезанный
// мастер-план выглядел бы как «задач меньше, чем есть».
const PAGE = 1000;
const ROWS_CAP = 20000;

export interface BoardCycle {
  cycle: SprintCycle;
  /** Живой состав; у принятого — пусто, см. `loaded`. */
  items: SprintItem[];
  /** Снимки ушедших переносом. */
  moved: SprintItem[];
  /** Снятые из идущего спринта: нужны шапке, чтобы процент считался от плана старта. */
  withdrawn: SprintItem[];
  /** false — состав не загружен (принятый спринт): итоги в `cycle.stats`, состав — по запросу. */
  loaded: boolean;
}

export interface BoardData {
  plan: { groups: PlanGroupView[] };
  cycles: BoardCycle[];
}

/** Выборка постранично до конца; больше потолка — ошибка. `fetchPage` отдаёт срез [from, to]. */
async function fetchAll<T>(
  what: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from <= ROWS_CAP; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`sprint board ${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`sprint board ${what}: больше ${ROWS_CAP} строк — доска не собирается`);
}

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  assignees: string[] | null;
  assignee_telegram_ids: number[] | null;
  parent_id: string | null;
  project_id: string;
  created_at: string;
};

/**
 * Доска пространства: мастер-план (группы → задачи со спринтами) и спринты слева направо по
 * времени. `tabId = null` — служебное «Без вкладки»: у него нет групп, мастер-план пуст.
 * Статуса `draft` у задач больше нет (tasks_status_check, 05.09.2026), поэтому отдельного
 * отсева черновиков, как в lib/sprintPlan.ts, нет; `neq('status','draft')` потерял бы ещё и
 * задачи с пустым статусом.
 */
export async function loadBoard(groupId: string, tabId: string | null, viewerId: number): Promise<BoardData> {
  const cycles = (await redactCycleStats(await listCycles(groupId, tabId), groupId, viewerId))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));

  const groups = tabId === null ? [] : (await listProjects(groupId, { viewerId, withSprintGroups: true }))
    .filter((p) => p.sprint_group === true && p.sprint_id === tabId && p.parent_id === null);

  const tasks = groups.length === 0 ? [] : await fetchAll<TaskRow>(
    "tasks",
    (from, to) =>
      onlyLive(
        supabase.from("tasks").select(
          "id, title, status, due_date, assignees, assignee_telegram_ids, parent_id, project_id, created_at",
        ),
      )
        .eq("group_id", groupId).in("project_id", groups.map((g) => g.id))
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
  );

  const planIds = new Set(tasks.map((t) => t.id));
  const startOf = new Map(cycles.map((c) => [c.id, c.start_date]));
  const spanRows: SpanRow[] = cycles.length === 0 || tasks.length === 0 ? [] : (await fetchAll<
    { task_id: string | null; cycle_id: string; moved_at: string | null; withdrawn_at: string | null }
  >(
    "spans",
    (from, to) =>
      supabase.from("sprint_items").select("task_id, cycle_id, moved_at, withdrawn_at")
        .in("cycle_id", cycles.map((c) => c.id)).order("id", { ascending: true }).range(from, to),
  )).flatMap((r) =>
    r.task_id && planIds.has(r.task_id)
      ? [{
        task_id: r.task_id,
        cycle_id: r.cycle_id,
        start_date: startOf.get(r.cycle_id) ?? "",
        moved_at: r.moved_at,
        withdrawn_at: r.withdrawn_at,
      }]
      : []
  );
  const spans = buildPlanSpans(spanRows);

  const byGroup = new Map<string, PlanTaskView[]>();
  for (const t of tasks) {
    const list = byGroup.get(t.project_id) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      status: t.status,
      due_date: t.due_date,
      assignees: t.assignees ?? [],
      assignee_telegram_ids: t.assignee_telegram_ids ?? [],
      parent_id: t.parent_id,
      created_at: t.created_at,
      cycle_ids: spans.get(t.id) ?? [],
    });
    byGroup.set(t.project_id, list);
  }

  const boardCycles = await Promise.all(cycles.map(async (cycle): Promise<BoardCycle> => {
    if (cycle.status === "accepted") return { cycle, items: [], moved: [], withdrawn: [], loaded: false };
    const c = await listComposition(cycle.id, groupId, { viewerId });
    return { cycle, items: c.items, moved: c.moved, withdrawn: c.withdrawn, loaded: true };
  }));

  return {
    plan: { groups: groups.map((g) => ({ id: g.id, name: g.name, tasks: byGroup.get(g.id) ?? [] })) },
    cycles: boardCycles,
  };
}
