// Журнал пространства: одна лента событий по задачам вкладки — правки, комментарии, состав
// спринтов, сами спринты.
//
// Отдельным модулем, а не в index.ts: тот уже 2400+ строк при пределе 800 (issue #265).
//
// ⚠️ Лента собирается из ЧУЖИХ таблиц, у каждой своя защита. Здесь она одна на всех: сначала
// определяется список задач, которые человеку можно видеть, и только по ним берутся события.
// Обратный порядок (взять события, потом отфильтровать) означал бы, что новая таблица событий
// попадает в ленту мимо проверки — так журнал и становится обходным путём к чужому приватному.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Больше восьмисот строк человек не читает, а запрос становится тяжёлым. */
const MAX_ROWS = 800;

const PERIODS: Record<string, number | null> = {
  "1": 1,
  "3": 3,
  "7": 7,
  all: null,
};

export type JournalKind =
  | "task_change"
  | "comment"
  | "item_added"
  | "check"
  | "carry"
  | "removed"
  | "cycle_started"
  | "cycle_accepted";

export interface JournalEvent {
  at: string;
  kind: JournalKind;
  actor: string | null;
  task_id: string | null;
  task_title: string | null;
  text: string;
}

function since(days: number | null): string | null {
  if (days === null) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/**
 * Задачи пространства, которые этому человеку можно видеть.
 *
 * Пространство — вкладка доски: её проекты (`projects.sprint_id = tabId`), их задачи. Правило
 * видимости то же, что в списках задач: приватную видит только владелец. Админского обхода
 * здесь нет намеренно — журнал не должен быть щелью, которой нет в обычном списке.
 */
async function visibleTasks(
  tabId: string,
  groupId: string,
  viewerId: number | null,
): Promise<Map<string, string>> {
  const { data: projects } = await supabase.from("projects")
    .select("id").eq("group_id", groupId).eq("sprint_id", tabId);
  const projectIds = (projects ?? []).map((p) => (p as { id: string }).id);
  const titles = new Map<string, string>();
  if (projectIds.length === 0) return titles;

  let q = supabase.from("tasks")
    .select("id, title")
    .eq("group_id", groupId).in("project_id", projectIds);
  q = viewerId === null
    ? q.eq("is_private", false)
    : q.or(`is_private.eq.false,owner_id.eq.${viewerId}`);

  const { data: tasks } = await q.limit(2000);
  for (const t of (tasks ?? []) as { id: string; title: string }[]) {
    titles.set(t.id, t.title);
  }
  return titles;
}

/** `GET /spaces/:tabId/journal?days=1|3|7|all` — лента пространства, новые сверху. */
export async function handleSpaceJournalRoutes(
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  origin: string,
): Promise<Response | null> {
  const match = routePath.match(/^\/spaces\/([^/]+)\/journal$/);
  if (!match) return null;
  if (req.method !== "GET") return null;

  const tabId = match[1];
  const raw = new URL(req.url).searchParams.get("days") ?? "7";
  if (!(raw in PERIODS)) {
    return apiErr(400, "days: принимаются 1, 3, 7 или all", origin);
  }
  const from = since(PERIODS[raw]);

  // Вкладка чужого воркспейса — 404, а не пустая лента: пустая выглядит как «событий нет» и
  // не даёт понять, что человек смотрит не туда.
  const { data: tab } = await supabase.from("sprints")
    .select("id").eq("id", tabId).eq("group_id", groupId).maybeSingle();
  if (!tab) return apiErr(404, "Not found", origin);

  const titles = await visibleTasks(tabId, groupId, telegramId);
  const taskIds = [...titles.keys()];
  const events: JournalEvent[] = [];

  if (taskIds.length > 0) {
    let hq = supabase.from("task_history")
      .select("task_id, field, old_value, new_value, changed_by, created_at")
      .in("task_id", taskIds);
    if (from) hq = hq.gte("created_at", from);
    const { data: history } = await hq.order("created_at", {
      ascending: false,
    }).limit(MAX_ROWS);

    for (
      const h of (history ?? []) as {
        task_id: string;
        field: string;
        old_value: string | null;
        new_value: string | null;
        changed_by: string;
        created_at: string;
      }[]
    ) {
      events.push({
        at: h.created_at,
        kind: "task_change",
        actor: h.changed_by,
        task_id: h.task_id,
        task_title: titles.get(h.task_id) ?? null,
        text: `${h.field}: ${h.old_value ?? "—"} → ${h.new_value ?? "—"}`,
      });
    }

    let cq = supabase.from("task_comments")
      .select("task_id, content, added_by, created_at")
      .in("task_id", taskIds);
    if (from) cq = cq.gte("created_at", from);
    const { data: comments } = await cq.order("created_at", {
      ascending: false,
    }).limit(MAX_ROWS);

    for (
      const c of (comments ?? []) as {
        task_id: string;
        content: string;
        added_by: string;
        created_at: string;
      }[]
    ) {
      events.push({
        at: c.created_at,
        kind: "comment",
        actor: c.added_by,
        task_id: c.task_id,
        task_title: titles.get(c.task_id) ?? null,
        text: c.content,
      });
    }
  }

  // События спринтов пространства: сам спринт и его состав.
  const { data: cycles } = await supabase.from("sprint_cycles")
    .select("id, name, status, started_at, accepted_at, accepted_by, stats")
    .eq("group_id", groupId).eq("tab_id", tabId);

  const cycleNames = new Map<string, string>();
  for (
    const c of (cycles ?? []) as {
      id: string;
      name: string;
      started_at: string | null;
      accepted_at: string | null;
      accepted_by: string | null;
      stats: { planPercent?: number } | null;
    }[]
  ) {
    cycleNames.set(c.id, c.name);
    if (c.started_at && (!from || c.started_at >= from)) {
      events.push({
        at: c.started_at,
        kind: "cycle_started",
        actor: null,
        task_id: null,
        task_title: null,
        text: `Спринт начат: ${c.name}`,
      });
    }
    if (c.accepted_at && (!from || c.accepted_at >= from)) {
      const percent = c.stats?.planPercent;
      events.push({
        at: c.accepted_at,
        kind: "cycle_accepted",
        actor: c.accepted_by,
        task_id: null,
        task_title: null,
        text: percent === undefined
          ? `Спринт принят: ${c.name}`
          : `Спринт принят: ${c.name} — выполнено ${percent}%`,
      });
    }
  }

  const cycleIds = [...cycleNames.keys()];
  if (cycleIds.length > 0) {
    const { data: items } = await supabase.from("sprint_items")
      .select(
        "cycle_id, task_id, added_at, added_by, check_status, check_at, check_by, to_carry, carry_reason, carry_at, carry_by, removed_title, removed_at",
      )
      .in("cycle_id", cycleIds).limit(MAX_ROWS);

    for (
      const it of (items ?? []) as {
        cycle_id: string;
        task_id: string | null;
        added_at: string;
        added_by: string | null;
        check_status: string | null;
        check_at: string | null;
        check_by: string | null;
        to_carry: boolean;
        carry_reason: string | null;
        carry_at: string | null;
        carry_by: string | null;
        removed_title: string | null;
        removed_at: string | null;
      }[]
    ) {
      // Строка состава ведёт к задаче: нет её в списке видимых — событие в ленту не идёт.
      // Упоминание удалённой задачи (task_id уже null) показываем: самой задачи нет, её
      // приватность больше ничего не закрывает, а пропажу из спринта надо объяснить.
      const title = it.task_id ? titles.get(it.task_id) : null;
      if (it.task_id && !title) continue;
      const cycle = cycleNames.get(it.cycle_id) ?? "спринт";

      if (!from || it.added_at >= from) {
        events.push({
          at: it.added_at,
          kind: "item_added",
          actor: it.added_by,
          task_id: it.task_id,
          task_title: title ?? null,
          text: `Взята в ${cycle}`,
        });
      }
      if (it.check_at && it.check_status && (!from || it.check_at >= from)) {
        events.push({
          at: it.check_at,
          kind: "check",
          actor: it.check_by,
          task_id: it.task_id,
          task_title: title ?? null,
          text: `Сверка: ${it.check_status}`,
        });
      }
      if (it.carry_at && it.to_carry && (!from || it.carry_at >= from)) {
        events.push({
          at: it.carry_at,
          kind: "carry",
          actor: it.carry_by,
          task_id: it.task_id,
          task_title: title ?? null,
          text: it.carry_reason
            ? `К переносу: ${it.carry_reason}`
            : "К переносу",
        });
      }
      if (it.removed_at && (!from || it.removed_at >= from)) {
        events.push({
          at: it.removed_at,
          kind: "removed",
          actor: null,
          task_id: null,
          task_title: it.removed_title,
          text: `Задача удалена, в ${cycle} осталась упоминанием`,
        });
      }
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return json({ events: events.slice(0, MAX_ROWS) }, 200, origin);
}
