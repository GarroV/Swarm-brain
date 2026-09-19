// Состав спринта: строки `sprint_items` — связь задача↔спринт, отметки сверки, пометки
// переноса и упоминания удалённых задач.
//
// Отдельно от `sprint-cycles.ts`: там период и его жизненный цикл, здесь — то, что внутри.
// Файл не должен разрастаться во «всё про спринты» — этим уже болеет swarm-api/index.ts
// (issue #265).
//
// ⚠️ Таблица `sprints` — вкладки доски проектов. Спринты живут в `sprint_cycles`.

// Линт просит короткое имя из карты импортов вместо адреса. Здесь — нельзя: карта лежит в
// корневом deno.json, а раскатку собирает Supabase CLI из каталога функций, и увидит ли он
// корневую карту — непроверено. Ошибка вылезла бы только в проде, поэтому все файлы функций
// импортируют по адресу; короткие имена оставлены тестам, которые не раскатываются.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TASK_FIELDS =
  "id, title, status, assignees, project_id, completed_at, due_date, is_private, owner_id";

/** Отметка сверки: как идут дела у задачи в середине спринта. */
export const CHECK_STATUSES = ["ok", "risk", "problem"] as const;
export type CheckStatus = typeof CHECK_STATUSES[number];

export function isCheckStatus(v: unknown): v is CheckStatus {
  return typeof v === "string" &&
    (CHECK_STATUSES as readonly string[]).includes(v);
}

/** Задача в составе спринта: до приёмки — живая, после — из клона. */
export interface SprintItem {
  id: string;
  task_id: string | null;
  in_plan: boolean;
  added_at: string;
  title: string;
  status: string;
  assignees: string[];
  project_id: string | null;
  project: string | null;
  completed_at: string | null;
  due_date: string | null;
  frozen: boolean;
  check_status: CheckStatus | null;
  check_note: string | null;
  check_at: string | null;
  check_by: string | null;
  to_carry: boolean;
  carry_reason: string | null;
  carry_count: number;
  carried_manual: boolean | null;
  /** Задача удалена: строка осталась упоминанием и в счёт не идёт. */
  removed: boolean;
  removed_at: string | null;
  /**
   * Задача скрыта от смотрящего (она приватная, а он не владелец). Строка остаётся видимой,
   * но без содержимого: убрать её совсем значило бы молча уменьшить состав спринта, и цифры
   * отчёта перестали бы сходиться у разных людей.
   */
  hidden: boolean;
}

export interface Viewer {
  /** Telegram id смотрящего строкой — как он лежит в `tasks.owner_id`. */
  id: string | null;
  isAdmin: boolean;
}

/**
 * Приватная задача видна только владельцу — то же правило, что в списках задач
 * (`is_private = false OR owner_id = я`). Админ права обхода здесь НЕ получает: решение
 * владельца 07.08.2026 о приватных записях и встречах.
 *
 * Задача без владельца при этом остаётся скрытой от всех: приватность без хозяина — это
 * повод разбираться с данными, а не показывать содержимое всей команде.
 */
function isHidden(task: Record<string, unknown>, viewer: Viewer): boolean {
  if (!task.is_private) return false;
  const owner = task.owner_id == null ? null : String(task.owner_id);
  return owner === null || viewer.id === null || owner !== viewer.id;
}

/**
 * Состав спринта глазами конкретного человека.
 *
 * `viewer` обязателен и значения по умолчанию не имеет намеренно: состав спринта обязан
 * показываться глазами конкретного человека, и параметр, который можно забыть передать, —
 * это правило, которое однажды не применится.
 */
export async function listItems(
  cycleId: string,
  groupId: string,
  viewer: Viewer,
): Promise<SprintItem[]> {
  const { data: cycle } = await supabase.from("sprint_cycles")
    .select("id").eq("id", cycleId).eq("group_id", groupId).maybeSingle();
  if (!cycle) return [];

  // Поля перечислены прямо здесь одной строкой, а не вынесены в константу: клиент Supabase
  // разбирает список полей ТИПОМ на этапе компиляции, и как только строка становится
  // вычисляемой, ответ превращается в «неизвестно что» (TS2352).
  const { data: rows } = await supabase.from("sprint_items")
    .select(
      "id, task_id, in_plan, added_at, frozen_at, frozen_title, frozen_status, frozen_assignees, frozen_project, frozen_completed_at, frozen_due_date, check_status, check_note, check_at, check_by, to_carry, carry_reason, carry_count, carried_manual, removed_title, removed_project_id, removed_at",
    )
    .eq("cycle_id", cycleId).order("added_at", { ascending: true });
  const items = (rows ?? []) as Record<string, unknown>[];
  if (items.length === 0) return [];

  const liveIds = items.filter((r) => !r.frozen_at && r.task_id).map((r) =>
    r.task_id as string
  );
  const live = new Map<string, Record<string, unknown>>();
  if (liveIds.length > 0) {
    const { data: tasks } = await supabase.from("tasks").select(TASK_FIELDS).in(
      "id",
      liveIds,
    );
    for (const t of (tasks ?? []) as Record<string, unknown>[]) {
      live.set(t.id as string, t);
    }
  }

  const projectNames = await loadProjectNames(items, live);

  return items.map((r) => {
    const t = r.task_id ? live.get(r.task_id as string) : undefined;
    const frozen = !!r.frozen_at;
    const removed = r.removed_at != null;
    const hidden = !frozen && !!t && isHidden(t, viewer);
    const projectId = (t?.project_id as string | null) ?? null;

    const title = removed
      ? (r.removed_title as string | null) ?? "(задача удалена)"
      : frozen
      ? (r.frozen_title as string)
      : hidden
      ? "Приватная задача"
      : ((t?.title as string) ?? "(задача удалена)");

    return {
      id: r.id as string,
      task_id: hidden ? null : (r.task_id as string | null) ?? null,
      in_plan: !!r.in_plan,
      added_at: r.added_at as string,
      title,
      status: frozen
        ? (r.frozen_status as string)
        : ((t?.status as string) ?? "cancelled"),
      assignees: hidden
        ? []
        : frozen
        ? ((r.frozen_assignees as string[]) ?? [])
        : ((t?.assignees as string[]) ?? []),
      project_id: hidden ? null : projectId,
      project: removed
        ? null
        : frozen
        ? ((r.frozen_project as string | null) ?? null)
        : hidden
        ? null
        : (projectId ? projectNames.get(projectId) ?? null : null),
      completed_at: frozen
        ? ((r.frozen_completed_at as string | null) ?? null)
        : ((t?.completed_at as string | null) ?? null),
      due_date: frozen
        ? ((r.frozen_due_date as string | null) ?? null)
        : hidden
        ? null
        : ((t?.due_date as string | null) ?? null),
      frozen,
      check_status: (r.check_status as CheckStatus | null) ?? null,
      check_note: hidden ? null : (r.check_note as string | null) ?? null,
      check_at: (r.check_at as string | null) ?? null,
      check_by: (r.check_by as string | null) ?? null,
      to_carry: !!r.to_carry,
      carry_reason: hidden ? null : (r.carry_reason as string | null) ?? null,
      carry_count: (r.carry_count as number | null) ?? 0,
      carried_manual: (r.carried_manual as boolean | null) ?? null,
      removed,
      removed_at: (r.removed_at as string | null) ?? null,
      hidden,
    };
  });
}

async function loadProjectNames(
  items: Record<string, unknown>[],
  live: Map<string, Record<string, unknown>>,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of items) {
    const t = r.task_id ? live.get(r.task_id as string) : undefined;
    const pid = t?.project_id as string | null | undefined;
    if (pid) ids.add(pid);
  }
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const { data } = await supabase.from("projects").select("id, name").in("id", [
    ...ids,
  ]);
  for (const p of (data ?? []) as { id: string; name: string }[]) {
    names.set(p.id, p.name);
  }
  return names;
}

/** Набор состава. Чужие воркспейсы, приватные и уже добавленные отсеиваются молча. */
export async function addItems(
  cycleId: string,
  taskIds: string[],
  groupId: string,
  addedBy: string | null,
): Promise<number> {
  if (taskIds.length === 0) return 0;
  const { data: cycle } = await supabase.from("sprint_cycles")
    .select("id, status").eq("id", cycleId).eq("group_id", groupId)
    .maybeSingle();
  if (!cycle || (cycle as { status: string }).status === "accepted") return 0;

  const { data: tasks } = await supabase.from("tasks")
    .select("id, status")
    .in("id", taskIds).eq("group_id", groupId).eq("is_private", false);
  const allowed = (tasks ?? []) as { id: string; status: string }[];
  if (allowed.length === 0) return 0;

  const { data: existing } = await supabase.from("sprint_items")
    .select("task_id").eq("cycle_id", cycleId);
  const already = new Set(
    (existing ?? []).map((r) => (r as { task_id: string | null }).task_id),
  );

  const fresh = allowed.filter((t) => !already.has(t.id));
  if (fresh.length === 0) return 0;

  const { data: inserted } = await supabase.from("sprint_items").insert(
    fresh.map((t) => ({
      cycle_id: cycleId,
      task_id: t.id,
      // Спринт уже идёт — значит это «сверх плана»; в черновике план ещё не зафиксирован.
      in_plan: (cycle as { status: string }).status === "draft",
      added_by: addedBy,
    })),
  ).select("id");

  // Задача из бэклога, взятая в спринт, становится открытой: в спринтовом канбане колонки
  // «Бэклог» нет — её роль играет пул слева, и такая задача не попала бы ни в одну колонку.
  // Поведение из #267, перенесено вместе с функцией; без него задача исчезает с доски.
  const fromBacklog = fresh.filter((t) => t.status === "backlog").map((t) =>
    t.id
  );
  if (fromBacklog.length > 0) {
    await supabase.from("tasks")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .in("id", fromBacklog);
  }

  return (inserted ?? []).length;
}

export async function removeItem(
  cycleId: string,
  taskId: string,
  groupId: string,
): Promise<boolean> {
  const { data: cycle } = await supabase.from("sprint_cycles")
    .select("id, status").eq("id", cycleId).eq("group_id", groupId)
    .maybeSingle();
  if (!cycle || (cycle as { status: string }).status === "accepted") {
    return false;
  }
  const { data } = await supabase.from("sprint_items")
    .delete().eq("cycle_id", cycleId).eq("task_id", taskId)
    .select("id").maybeSingle();
  return !!data;
}

export interface ItemPatch {
  check_status?: CheckStatus | null;
  check_note?: string | null;
  to_carry?: boolean;
  carry_reason?: string | null;
}

/** Правка строки принятого спринта: отказ, который роут превращает в 409. */
export class ItemLockedError extends Error {}

/**
 * Отметка сверки и пометка «к переносу».
 *
 * Принятый спринт не правится: его строки — снимок, по которому уже прочитан отчёт. Отказ
 * явный, а не тихое «ничего не обновилось»: человек должен понять, почему его отметка не
 * сохранилась.
 */
export async function updateItem(
  cycleId: string,
  taskId: string,
  groupId: string,
  patch: ItemPatch,
  actor: string | null,
): Promise<SprintItem | null> {
  const { data: cycle } = await supabase.from("sprint_cycles")
    .select("id, status").eq("id", cycleId).eq("group_id", groupId)
    .maybeSingle();
  if (!cycle) return null;
  if ((cycle as { status: string }).status === "accepted") {
    throw new ItemLockedError("Спринт принят, отметки больше не меняются");
  }

  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {};
  if ("check_status" in patch) {
    fields.check_status = patch.check_status;
    fields.check_at = patch.check_status ? now : null;
    fields.check_by = patch.check_status ? actor : null;
  }
  if ("check_note" in patch) fields.check_note = patch.check_note;
  if ("to_carry" in patch) {
    fields.to_carry = patch.to_carry;
    fields.carry_at = patch.to_carry ? now : null;
    fields.carry_by = patch.to_carry ? actor : null;
    // Пометку сняли — причина теряет смысл и не должна всплыть в следующем спринте.
    if (!patch.to_carry) fields.carry_reason = null;
  }
  if ("carry_reason" in patch && patch.to_carry !== false) {
    fields.carry_reason = patch.carry_reason;
  }
  if (Object.keys(fields).length === 0) return null;

  const { data } = await supabase.from("sprint_items")
    .update(fields).eq("cycle_id", cycleId).eq("task_id", taskId)
    .select("id").maybeSingle();
  if (!data) return null;

  const items = await listItems(cycleId, groupId, {
    id: actor,
    isAdmin: false,
  });
  return items.find((i) => i.task_id === taskId) ?? null;
}
