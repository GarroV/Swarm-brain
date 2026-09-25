import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { buildEntriesQuery } from "./entries-guard.ts";
import { reviewCountsByMember } from "./admin.ts";
import { listTasksWithTotal } from "../_shared/tasks/db.ts";
import {
  ACTIVITY_DAYS,
  type ActivityEvent,
  CLOSED_WINDOW_DAYS,
  computePeopleStats,
} from "../_shared/stats/people.ts";

// GET /stats/people — экран «Статистика» (решение владельца 2026-09-25): по каждому участнику
// воркспейса задачи, встречи и активность. Считает _shared/stats/people.ts; здесь только выборки.
//
// Доступ. Все выборки — через общие правила видимости: задачи через listTasksWithTotal
// (приватные видит владелец, админ — все: оверсайт по задачам, решение 2026-08-21), записи через
// buildEntriesQuery. Наружу уходят только числа и даты, без названий и текста.
// «На вычитке» — только число, его видят все (решение владельца 2026-09-25: «число "на вычитке"
// можно показывать. саму вычитку никто кроме пользователя видеть не должен»). Содержимое
// черновиков сюда не попадает: reviewCountsByMember отдаёт счётчики.
//
// Выборки узкие (id людей и даты), текст записей не тянем. Строки листаем страницами: PostgREST
// отдаёт не больше max_rows = 1000 за запрос и режет молча.

/** Насколько назад ищем «последнюю активность». Старше — считаем, что не было. */
const LAST_ACTIVE_LOOKBACK_DAYS = 90;
const PAGE = 1000;
/** Предохранитель от бесконечного цикла: 20 страниц = 20 000 строк на источник. */
const MAX_PAGES = 20;
const TASK_LIMIT = 1000;
const DAY_MS = 86_400_000;

// data — unknown: при select(строка) supabase-js не выводит форму строки (GenericStringError[]),
// форму задаёт тип T у вызова.
type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function allRows<T>(
  label: string,
  page: (from: number, to: number) => Page,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(
    `${label}: больше ${MAX_PAGES * PAGE} строк — поднять предел осознанно`,
  );
}

type Recorder = { telegram_id?: number; claimed_at?: string };

async function activityEvents(
  supabase: SupabaseClient,
  groupId: string,
  telegramId: number,
  sinceISO: string,
): Promise<ActivityEvent[]> {
  const [hist, comments, entries, meetings] = await Promise.all([
    allRows<{ changed_by_telegram_id: number; created_at: string }>(
      "task_history",
      (a, b) =>
        supabase.from("task_history").select(
          "changed_by_telegram_id, created_at",
        )
          .eq("group_id", groupId).gte("created_at", sinceISO)
          .not("changed_by_telegram_id", "is", null)
          .order("created_at").range(a, b),
    ),
    allRows<{ added_by_telegram_id: number; created_at: string }>(
      "task_comments",
      (a, b) =>
        supabase.from("task_comments").select(
          "added_by_telegram_id, created_at, tasks!inner(group_id)",
        )
          .eq("tasks.group_id", groupId).gte("created_at", sinceISO)
          .not("added_by_telegram_id", "is", null)
          .order("created_at").range(a, b),
    ),
    allRows<{ owner_id: number; created_at: string }>(
      "entries",
      (a, b) =>
        buildEntriesQuery(supabase, "owner_id, created_at", {
          groupId,
          telegramId,
        })
          .gte("created_at", sinceISO).not("owner_id", "is", null)
          .order("created_at").range(a, b),
    ),
    allRows<{ recorders: Recorder[] | null }>(
      "meetings",
      (a, b) =>
        supabase.from("meetings").select("recorders")
          .eq("group_id", groupId).gte("created_at", sinceISO)
          .order("created_at").range(a, b),
    ),
  ]);
  const out: ActivityEvent[] = [
    ...hist.map((r) => ({
      telegram_id: r.changed_by_telegram_id,
      at: r.created_at,
    })),
    ...comments.map((r) => ({
      telegram_id: r.added_by_telegram_id,
      at: r.created_at,
    })),
    ...entries.map((r) => ({ telegram_id: r.owner_id, at: r.created_at })),
  ];
  for (const m of meetings) {
    for (const r of m.recorders ?? []) {
      if (typeof r.telegram_id === "number" && r.claimed_at) {
        out.push({ telegram_id: r.telegram_id, at: r.claimed_at });
      }
    }
  }
  return out;
}

export async function handleStatsRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  if (routePath !== "/stats/people") return null;
  if (req.method !== "GET") return apiErr(405, "Method not allowed", origin);

  const now = new Date();
  const sinceISO = new Date(now.getTime() - LAST_ACTIVE_LOOKBACK_DAYS * DAY_MS)
    .toISOString();
  try {
    const [memberRows, taskRes, published, reviewCounts, events] = await Promise
      .all([
        allRows<{ telegram_id: number }>(
          "allowed_users",
          (a, b) =>
            supabase.from("allowed_users").select("telegram_id").eq(
              "group_id",
              groupId,
            )
              .order("telegram_id").range(a, b),
        ),
        listTasksWithTotal({
          columns:
            "status, created_at, completed_at, due_date, assignee_telegram_ids",
          confirmed: true,
          viewerId: telegramId,
          isAdmin,
          limit: TASK_LIMIT,
        }, groupId),
        allRows<{ owner_id: number | null; added_by: number | null }>(
          "published",
          (a, b) =>
            buildEntriesQuery(
              supabase,
              "owner_id, added_by:metadata->added_by_telegram_id",
              {
                groupId,
                telegramId,
              },
            ).eq("entry_type", "meeting").eq("metadata->>confirmed", "true")
              .order("created_at").range(a, b),
        ),
        reviewCountsByMember(supabase, groupId),
        activityEvents(supabase, groupId, telegramId, sinceISO),
      ]);

    const ids = memberRows.map((m) => m.telegram_id);
    const names = await resolveNames(ids);
    const members = ids
      .map((id) => ({ telegram_id: id, name: names.get(id) ?? `#${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    const people = computePeopleStats({
      members,
      tasks: taskRes.tasks,
      meetings: published.map((e) => ({
        author: e.owner_id ??
          (typeof e.added_by === "number" ? e.added_by : null),
      })),
      reviewCounts,
      events,
      now,
    });
    return json(
      {
        people,
        activityDays: ACTIVITY_DAYS,
        closedWindowDays: CLOSED_WINDOW_DAYS,
        // Задач больше лимита — числа по задачам неполные; экран обязан это сказать.
        tasksTruncated: taskRes.total !== null &&
          taskRes.total > taskRes.tasks.length,
      },
      200,
      origin,
    );
  } catch (e) {
    console.error("[GET /stats/people]", e);
    return apiErr(500, "Could not build stats", origin);
  }
}
