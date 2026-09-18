// Спринты: доступ к данным. Логика итогов — в `sprint-stats.ts` (чистая, под тестами),
// правила доступа — в вызывающих роутах (`swarm-api/sprint-cycles.ts`).
//
// ⚠️ Таблица `sprints` — это вкладки доски проектов. Спринты живут в `sprint_cycles`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeSprintStats, type SprintItemView } from "./sprint-stats.ts";
import { isClosedStatus } from "./statuses.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type CycleStatus = "draft" | "active" | "accepted";

export interface SprintCycle {
  id: string;
  group_id: string;
  /**
   * Пространство (вкладка доски проектов), внутри которого идёт спринт. NULL — спринт из
   * времён до пространств или у него удалили вкладку: такие показываются в служебном
   * «Без вкладки», а не пропадают.
   */
  tab_id: string | null;
  /** День сверки — середина спринта, когда участники отмечают «идёт / риск / проблема». */
  check_date: string | null;
  name: string;
  start_date: string;
  end_date: string;
  status: CycleStatus;
  created_by: string | null;
  started_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  summary: string | null;
  stats: unknown | null;
  created_at: string;
}

export interface CycleInput {
  name: string;
  start_date: string;
  end_date: string;
  tab_id?: string | null;
  check_date?: string | null;
}

/** В пространстве уже есть живой спринт: роут превращает это в 409. */
export class LiveCycleExistsError extends Error {}

/** Вкладка из чужого воркспейса или её нет вовсе: роут превращает это в 400. */
export class UnknownTabError extends Error {}

/**
 * Сверка — на шестой день от старта, если не задана руками. Совпадает с расчётом следующего
 * спринта при приёмке (`sprint-dates.ts`), чтобы ритуал не зависел от того, как спринт создан.
 */
const CHECK_OFFSET_DAYS = 6;

// Все операции изолированы по group_id — спринт принадлежит воркспейсу, как и всё остальное.

export async function listCycles(
  groupId: string,
  tabId?: string | null,
): Promise<SprintCycle[]> {
  let q = supabase.from("sprint_cycles").select("*").eq("group_id", groupId);
  // Без параметра — все спринты воркспейса, как было до пространств: так старый веб в ночь
  // раскатки продолжает видеть то же, что видел.
  if (tabId === null) q = q.is("tab_id", null);
  else if (tabId !== undefined) q = q.eq("tab_id", tabId);
  const { data } = await q.order("start_date", { ascending: false });
  return (data ?? []) as SprintCycle[];
}

/** Вкладка принадлежит этому воркспейсу? Чужую подсовывать нельзя — это чужое планирование. */
async function tabInGroup(tabId: string, groupId: string): Promise<boolean> {
  const { data } = await supabase.from("sprints")
    .select("id").eq("id", tabId).eq("group_id", groupId).maybeSingle();
  return !!data;
}

export async function getCycle(
  id: string,
  groupId: string,
): Promise<SprintCycle | null> {
  const { data } = await supabase.from("sprint_cycles")
    .select("*").eq("id", id).eq("group_id", groupId).maybeSingle();
  return (data as SprintCycle | null) ?? null;
}

export async function createCycle(
  input: CycleInput,
  groupId: string,
  createdBy: string | null,
): Promise<SprintCycle> {
  const tabId = input.tab_id ?? null;
  if (tabId !== null && !(await tabInGroup(tabId, groupId))) {
    throw new UnknownTabError("Такого пространства нет в этом воркспейсе");
  }

  const { data, error } = await supabase.from("sprint_cycles").insert({
    group_id: groupId,
    tab_id: tabId,
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    check_date: input.check_date ?? defaultCheckDate(input.start_date),
    status: "draft",
    created_by: createdBy,
  }).select().single();

  if (error) {
    // 23505 — частичный уникальный индекс: в пространстве уже есть черновик или идущий
    // спринт. Это не поломка, а ровно то правило, ради которого индекс и заведён, и человеку
    // надо сказать по-человечески, а не «duplicate key value violates unique constraint».
    if (error.code === "23505") {
      throw new LiveCycleExistsError(
        "В этом пространстве уже есть незакрытый спринт — примите или удалите его",
      );
    }
    throw new Error(error.message);
  }
  return data as SprintCycle;
}

/** Календарное «плюс N дней» без часовых поясов — та же арифметика, что в `sprint-dates.ts`. */
function defaultCheckDate(startDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) return null;
  const t = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + CHECK_OFFSET_DAYS),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${
    pad(t.getUTCDate())
  }`;
}

export async function updateCycle(
  id: string,
  fields: Partial<CycleInput> & { summary?: string | null },
  groupId: string,
): Promise<SprintCycle | null> {
  const { data } = await supabase.from("sprint_cycles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as SprintCycle | null) ?? null;
}

export async function deleteCycle(
  id: string,
  groupId: string,
): Promise<boolean> {
  // Принятый спринт — архив, его не удаляют: иначе исчезает единственная память о периоде.
  const { data } = await supabase.from("sprint_cycles")
    .delete().eq("id", id).eq("group_id", groupId).neq("status", "accepted")
    .select("id").maybeSingle();
  return !!data;
}

/**
 * Старт спринта: всё, что сейчас в составе, становится «планом», от которого потом считается
 * процент. Добавленное позже пойдёт как «сверх плана» — именно это различие владелец просил
 * видеть в итогах, чтобы набранная по ходу мелочь не улучшала картинку.
 */
export async function startCycle(
  id: string,
  groupId: string,
): Promise<SprintCycle | null> {
  const cycle = await getCycle(id, groupId);
  if (!cycle || cycle.status !== "draft") return null;

  await supabase.from("sprint_items").update({ in_plan: true }).eq(
    "cycle_id",
    id,
  );
  const { data } = await supabase.from("sprint_cycles")
    .update({
      status: "active",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as SprintCycle | null) ?? null;
}
