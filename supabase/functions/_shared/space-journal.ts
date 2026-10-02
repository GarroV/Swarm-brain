// Журнал пространства спринтов: одна лента событий по задачам его спринтов — правки, комментарии, состав
// спринтов, сами спринты.
//
// Общий модуль (#485): ленту читают и веб (swarm-api `GET /spaces/:id/journal`), и Claude
// (swarm-mcp `get_sprint_journal`). Правило видимости одно — две копии разошлись бы, и одна из
// дверей стала бы обходным путём к чужому приватному.
//
// ⚠️ Лента собирается из ЧУЖИХ таблиц, у каждой своя защита. Здесь она одна на всех: сначала
// определяется список задач, которые человеку можно видеть, и только по ним берутся события.
// Обратный порядок (взять события, потом отфильтровать) означал бы, что новая таблица событий
// попадает в ленту мимо проверки — так журнал и становится обходным путём к чужому приватному.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { actorIds, displayActor } from "./journal-actors.ts";

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
  /** Готовая строка по-русски — запасной вариант для старого клиента. */
  text: string;
  /** Части события для сборки строки на языке клиента (issue #459: демо — по-английски). */
  params?: JournalParams;
}

export interface JournalParams {
  cycle?: string | null;
  percent?: number;
  status?: string;
  reason?: string | null;
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
 * Задачи пространства — это состав его спринтов (`sprint_items`). НЕ проекты с
 * `projects.sprint_id = tabId`: так было, пока пространство и вкладка доски «Проекты» были одной
 * записью. После их разделения (issue #423) у пространства проектов нет вовсе, и журнал молча
 * терял все правки задач и комментарии — на проде у обоих пространств выходил ноль (24.09.2026).
 *
 * Правило видимости то же, что в списках задач: приватную видит только владелец. Админского
 * обхода здесь нет намеренно — журнал не должен быть щелью, которой нет в обычном списке.
 */
async function visibleTasks(
  tabId: string,
  groupId: string,
  viewerId: number | null,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const { data: cycles, error: cyclesErr } = await supabase.from(
    "sprint_cycles",
  )
    .select("id").eq("group_id", groupId).eq("tab_id", tabId);
  if (cyclesErr) {
    console.error("[space-journal] sprint_cycles", cyclesErr.message);
  }
  const cycleIds = (cycles ?? []).map((c) => (c as { id: string }).id);
  if (cycleIds.length === 0) return titles;

  const { data: items, error: itemsErr } = await supabase.from("sprint_items")
    .select("task_id").in("cycle_id", cycleIds).not("task_id", "is", null);
  if (itemsErr) console.error("[space-journal] sprint_items", itemsErr.message);
  const taskIds = [
    ...new Set((items ?? []).map((i) => (i as { task_id: string }).task_id)),
  ];
  if (taskIds.length === 0) return titles;

  // archive-ok: журнал пространства подписывает события, в том числе об архивной задаче
  let q = supabase.from("tasks")
    .select("id, title")
    .eq("group_id", groupId).in("id", taskIds);
  q = viewerId === null ? q.eq("is_private", false) : q.or(`is_private.eq.false,owner_id.eq.${viewerId}`);

  const { data: tasks, error: tasksErr } = await q.limit(2000);
  if (tasksErr) console.error("[space-journal] tasks", tasksErr.message);
  for (const t of (tasks ?? []) as { id: string; title: string }[]) {
    titles.set(t.id, t.title);
  }
  return titles;
}

export type JournalResult =
  | { ok: true; events: JournalEvent[] }
  | { ok: false; status: 400 | 404; error: string };

/** Допустимые периоды ленты: `1`, `3`, `7` дней или `all`. */
export const JOURNAL_PERIODS = Object.keys(PERIODS);

/** Лента пространства за период, новые сверху. `days` — `1|3|7|all`. */
export async function loadSpaceJournal(
  tabId: string,
  groupId: string,
  telegramId: number,
  days: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<JournalResult> {
  if (!(days in PERIODS)) {
    return { ok: false, status: 400, error: "days: принимаются 1, 3, 7 или all" };
  }
  const from = since(PERIODS[days]);

  // Вкладка чужого воркспейса — 404, а не пустая лента: пустая выглядит как «событий нет» и
  // не даёт понять, что человек смотрит не туда. Вкладка доски «Проекты» — тоже 404: это другая
  // сущность в той же таблице (issue #423), журнала спринтов у неё нет.
  const { data: tab } = await supabase.from("sprints")
    .select("id").eq("id", tabId).eq("group_id", groupId).eq("kind", "space")
    .maybeSingle();
  if (!tab) return { ok: false, status: 404, error: "Not found" };

  const titles = await visibleTasks(tabId, groupId, telegramId);
  const taskIds = [...titles.keys()];
  const events: JournalEvent[] = [];

  if (taskIds.length > 0) {
    let hq = supabase.from("task_history")
      .select("task_id, field, old_value, new_value, changed_by, created_at")
      .in("task_id", taskIds);
    if (from) hq = hq.gte("created_at", from);
    const { data: history, error: histErr } = await hq.order("created_at", {
      ascending: false,
    }).limit(MAX_ROWS);
    if (histErr) console.error("[space-journal] history", histErr.message);

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
      .select("task_id, content, added_by, added_by_telegram_id, created_at")
      .in("task_id", taskIds);
    if (from) cq = cq.gte("created_at", from);
    const { data: comments, error: comErr } = await cq.order("created_at", {
      ascending: false,
    }).limit(MAX_ROWS);
    if (comErr) console.error("[space-journal] comments", comErr.message);

    for (
      const c of (comments ?? []) as {
        task_id: string;
        content: string;
        added_by: string | null;
        added_by_telegram_id: number | null;
        created_at: string;
      }[]
    ) {
      events.push({
        at: c.created_at,
        kind: "comment",
        // Новые комментарии пишут автора в added_by_telegram_id, added_by — старые строки.
        actor: c.added_by_telegram_id !== null ? String(c.added_by_telegram_id) : c.added_by,
        task_id: c.task_id,
        task_title: titles.get(c.task_id) ?? null,
        text: c.content,
      });
    }
  }

  // События спринтов пространства: сам спринт и его состав.
  const { data: cycles, error: cycErr } = await supabase.from("sprint_cycles")
    .select("id, name, status, started_at, accepted_at, accepted_by, stats")
    .eq("group_id", groupId).eq("tab_id", tabId);
  if (cycErr) console.error("[space-journal] cycles", cycErr.message);

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
        params: { cycle: c.name },
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
        text: percent === undefined ? `Спринт принят: ${c.name}` : `Спринт принят: ${c.name} — выполнено ${percent}%`,
        params: percent === undefined ? { cycle: c.name } : { cycle: c.name, percent },
      });
    }
  }

  const cycleIds = [...cycleNames.keys()];
  if (cycleIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase.from("sprint_items")
      .select(
        "cycle_id, task_id, added_at, added_by, check_status, check_at, check_by, to_carry, carry_reason, carry_at, carry_by, removed_title, removed_at",
      )
      .in("cycle_id", cycleIds).limit(MAX_ROWS);
    if (itemsErr) console.error("[space-journal] items", itemsErr.message);

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
      const cycleName = cycleNames.get(it.cycle_id) ?? null;
      const cycle = cycleName ?? "спринт";

      if (!from || it.added_at >= from) {
        events.push({
          at: it.added_at,
          kind: "item_added",
          actor: it.added_by,
          task_id: it.task_id,
          task_title: title ?? null,
          text: `Взята в ${cycle}`,
          params: { cycle: cycleName },
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
          params: { status: it.check_status },
        });
      }
      if (it.carry_at && it.to_carry && (!from || it.carry_at >= from)) {
        events.push({
          at: it.carry_at,
          kind: "carry",
          actor: it.carry_by,
          task_id: it.task_id,
          task_title: title ?? null,
          text: it.carry_reason ? `К переносу: ${it.carry_reason}` : "К переносу",
          params: { reason: it.carry_reason },
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
          params: { cycle: cycleName },
        });
      }
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  const page = events.slice(0, MAX_ROWS);
  // Автор в старых строках — telegram_id строкой (sprint-cycles писал String(id)): показываем
  // имя. Имена и 'demo' остаются как есть.
  const names = await resolveNames(actorIds(page.map((e) => e.actor)));
  const named = page.map((e) => ({
    ...e,
    actor: displayActor(e.actor, names),
  }));
  return { ok: true, events: named };
}
