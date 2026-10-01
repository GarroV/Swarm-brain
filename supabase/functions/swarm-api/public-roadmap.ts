// Линт просит короткое имя из карты импортов; см. пояснение в _shared/tasks/sprint-items.ts.
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Публичная дорожная карта доски для хаба проектов (issue #562).
//
//   GET /public/roadmap/:projectId   — БЕЗ авторизации, обрабатывается в index.ts ДО проверки
//                                      сессии (как /maintenance).
//
// Выдача публичная по замыслу (решение владельца 28.09.2026: секретов в CI сайта нет, сайт
// забирает данные прямо в браузере). Поэтому модуль устроен от белого списка, а не от запрета:
//   • в базу уходят узкие select'ы без `*` — закрытые поля даже не читаются;
//   • ответ собирается поштучно (`toRoadmapItem`, `buildRoadmap`) — объект строки базы наружу не
//     уходит никогда, лишняя колонка в select не превращается в утечку;
//   • 404 одинаковый для «нет такой доски», «не опубликована», «в архиве» и мусорного id —
//     снаружи нельзя узнать, что доска существует.
// Договор с сайтом (форма ответа, правила статусов, порядок) — docs/ARCHITECTURE.md
// §«Публичная дорожная карта». Меняешь форму — меняешь договор, сайт строится по нему.

/** Сколько дней выкаченная задача остаётся на хабе. */
export const SHIPPED_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const PUBLIC_CACHE = "public, max-age=300";
// 404 кэшируем короче: доску могут опубликовать, и хаб не должен ждать пять минут.
const NOT_FOUND_CACHE = "public, max-age=60";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_RE = /^\/public\/roadmap(?:\/([^/]*))?\/?$/;

// Узкие проекции. Каждая колонка здесь — осознанное решение; закрытые (description, assignees,
// assignee_telegram_ids, country, tags, label_ids, id задачи, owner_id…) не читаются вовсе.
// Служебные (group_id, archived_at, is_private, sprint_group, confirmed, hidden_from_hub) нужны фильтрам и
// наружу не уходят — это гарантирует сборка ответа, а не select.
export const BOARD_COLUMNS =
  "id, name, group_id, public_roadmap, is_private, archived_at, sprint_group";
export const PROJECT_COLUMNS = "id, name, position, created_at";
export const TASK_COLUMNS =
  "title, status, due_date, completed_at, project_id, hidden_from_hub, is_private, archived_at, confirmed";

export type RoadmapState = "planned" | "in_progress" | "shipped";

export type RoadmapItem = {
  title: string;
  state: RoadmapState;
  due: string | null;
  shipped_at: string | null;
};

export type RoadmapProject = { id: string; name: string; items: RoadmapItem[] };

export type RoadmapPayload = {
  board: string;
  generated_at: string;
  projects: RoadmapProject[];
};

export type RoadmapTaskRow = {
  title: string;
  status: string | null;
  due_date: string | null;
  completed_at: string | null;
  project_id: string | null;
  hidden_from_hub?: boolean | null;
  is_private?: boolean | null;
  archived_at?: string | null;
  confirmed?: boolean | null;
};

export type RoadmapProjectRow = {
  id: string;
  name: string;
  position: number | null;
  created_at: string;
};

/** Дата `YYYY-MM-DD` из date/timestamptz; мусор — null (сайт получит «без даты», а не хлам). */
function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Задача → пункт дорожной карты, или null, если на хаб она не попадает.
 * Правила договора: backlog/open → planned, in_progress → in_progress, done → shipped только
 * если закрыта за последние SHIPPED_WINDOW_DAYS дней; cancelled и неизвестное — никогда.
 * Дублирует фильтры запроса намеренно: проверка в одном месте ломается молча.
 */
export function toRoadmapItem(
  t: RoadmapTaskRow,
  now: Date,
): RoadmapItem | null {
  if (t.hidden_from_hub === true || t.is_private === true) return null;
  if (t.archived_at || t.confirmed === false) return null;
  const due = isoDate(t.due_date);
  switch (t.status) {
    case "backlog":
    case "open":
      return { title: t.title, state: "planned", due, shipped_at: null };
    case "in_progress":
      return { title: t.title, state: "in_progress", due, shipped_at: null };
    case "done": {
      if (!t.completed_at) return null;
      const closed = new Date(t.completed_at).getTime();
      if (Number.isNaN(closed)) return null;
      if (now.getTime() - closed > SHIPPED_WINDOW_DAYS * DAY_MS) return null;
      return {
        title: t.title,
        state: "shipped",
        due: null,
        shipped_at: isoDate(t.completed_at),
      };
    }
    default:
      return null;
  }
}

const STATE_RANK: Record<RoadmapState, number> = {
  in_progress: 0,
  planned: 1,
  shipped: 2,
};

/** Сравнение дат `YYYY-MM-DD` по возрастанию; null — в конец. */
function byDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Порядок договора: in_progress, потом planned по сроку (без срока — в конец), потом shipped
 * по дате выкатки, новые сверху. При равенстве — по названию, чтобы ответ был стабильным.
 */
export function compareItems(a: RoadmapItem, b: RoadmapItem): number {
  const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
  if (rank !== 0) return rank;
  const byDate = a.state === "shipped"
    ? byDateAsc(b.shipped_at, a.shipped_at)
    : byDateAsc(a.due, b.due);
  return byDate !== 0 ? byDate : a.title.localeCompare(b.title);
}

/** Порядок подпроектов как на доске: position, строки без позиции — в хвост, дальше дата. */
export function compareProjects(
  a: RoadmapProjectRow,
  b: RoadmapProjectRow,
): number {
  if (a.position !== null && b.position !== null && a.position !== b.position) {
    return a.position - b.position;
  }
  if (a.position === null && b.position !== null) return 1;
  if (a.position !== null && b.position === null) return -1;
  return a.created_at.localeCompare(b.created_at);
}

/**
 * Ответ целиком. `projects` — сама доска (только если у неё есть свои пункты) и её прямые
 * подпроекты в порядке доски; подпроект без пунктов остаётся в списке — это проект хаба.
 */
export function buildRoadmap(input: {
  board: { id: string; name: string };
  projects: RoadmapProjectRow[];
  tasks: RoadmapTaskRow[];
  now: Date;
}): RoadmapPayload {
  const itemsOf = (projectId: string): RoadmapItem[] =>
    input.tasks
      .filter((t) => t.project_id === projectId)
      .map((t) => toRoadmapItem(t, input.now))
      .filter((i): i is RoadmapItem => i !== null)
      .sort(compareItems);

  const projects: RoadmapProject[] = [];
  const own = itemsOf(input.board.id);
  if (own.length) {
    projects.push({ id: input.board.id, name: input.board.name, items: own });
  }
  for (const p of [...input.projects].sort(compareProjects)) {
    projects.push({ id: p.id, name: p.name, items: itemsOf(p.id) });
  }
  return {
    board: input.board.name,
    generated_at: input.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    projects,
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function publicHeaders(cache: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": cache,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
  };
}

function reply(data: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: publicHeaders(cache),
  });
}

const notFound = () => reply({ error: "not_found" }, 404, NOT_FOUND_CACHE);

/** Путь — про публичную дорожную карту? `routePath` — путь после `/swarm-api`. */
export function isPublicRoadmapPath(routePath: string): boolean {
  return ROUTE_RE.test(routePath);
}

/**
 * Обработчик маршрута. Вызывается index.ts до авторизации, только когда
 * `isPublicRoadmapPath(routePath)`. Ошибки базы — 500 без подробностей наружу (детали в лог).
 */
export async function handlePublicRoadmap(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  now: Date = new Date(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: publicHeaders(PUBLIC_CACHE),
    });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...publicHeaders("no-store"), Allow: "GET, OPTIONS" },
    });
  }

  const projectId = ROUTE_RE.exec(routePath)?.[1] ?? "";
  if (!UUID_RE.test(projectId)) return notFound();

  try {
    const board = await loadBoard(supabase, projectId);
    if (!board) return notFound();
    const projects = await loadSubprojects(supabase, board);
    const tasks = await loadTasks(
      supabase,
      board.group_id,
      [board.id, ...projects.map((p) => p.id)],
      now,
    );
    return reply(
      buildRoadmap({ board, projects, tasks, now }),
      200,
      PUBLIC_CACHE,
    );
  } catch (e) {
    console.error("[public-roadmap] failed", {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
    return reply({ error: "internal" }, 500, "no-store");
  }
}

type BoardRow = {
  id: string;
  name: string;
  group_id: string;
  public_roadmap: boolean;
  is_private: boolean;
  archived_at: string | null;
  sprint_group: boolean;
};

async function loadBoard(
  supabase: SupabaseClient,
  id: string,
): Promise<BoardRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select(BOARD_COLUMNS)
    .eq("id", id)
    .eq("public_roadmap", true)
    // Флаг публикации не снимает приватность: личную доску видит только её автор, и наружу
    // она не уходит, даже если флаг кто-то поставил (в приложении обхода приватности нет).
    .eq("is_private", false)
    // Группа спринта — временная запись спринта, на хаб она не выходит, пока её не пробросили.
    .eq("sprint_group", false)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(`board: ${error.message}`);
  const row = data as BoardRow | null;
  // Повтор фильтров запроса: 404 обязан случиться, даже если условие в запросе потеряют.
  if (
    !row || row.public_roadmap !== true || row.is_private !== false ||
    row.archived_at || row.sprint_group !== false
  ) return null;
  return row;
}

async function loadSubprojects(
  supabase: SupabaseClient,
  board: BoardRow,
): Promise<RoadmapProjectRow[]> {
  // Личный подпроект на хаб не попадает: публикация доски не отменяет приватность детей.
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("parent_id", board.id)
    .eq("group_id", board.group_id)
    .eq("is_private", false)
    .eq("sprint_group", false)
    .is("archived_at", null);
  if (error) throw new Error(`subprojects: ${error.message}`);
  return (data ?? []) as RoadmapProjectRow[];
}

async function loadTasks(
  supabase: SupabaseClient,
  groupId: string,
  projectIds: string[],
  now: Date,
): Promise<RoadmapTaskRow[]> {
  const since = new Date(now.getTime() - SHIPPED_WINDOW_DAYS * DAY_MS)
    .toISOString();
  // confirmed=false — задача «на проверке», её не видно нигде в вебе; на хабе тем более.
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .in("project_id", projectIds)
    .eq("group_id", groupId)
    .eq("hidden_from_hub", false)
    .eq("is_private", false)
    .eq("confirmed", true)
    .is("archived_at", null)
    .or(
      `status.in.(backlog,open,in_progress),and(status.eq.done,completed_at.gte.${since})`,
    );
  if (error) throw new Error(`tasks: ${error.message}`);
  return (data ?? []) as RoadmapTaskRow[];
}
