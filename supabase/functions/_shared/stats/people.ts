// Статистика по людям (экран «Статистика» в вебе, решение владельца 2026-09-25) — чистый расчёт.
//
// Все выборки приходят уже отфильтрованными по воркспейсу и видимости смотрящего: доступ здесь
// НЕ проверяется, функция только считает. Числа — то, что человек прочтёт как факт о коллеге,
// поэтому модуль под тестами, а каждое определение метрики записано рядом с ней.
//
// Дни считаем по времени команды (Белград), а не по UTC: иначе действие в 00:30 попадает во
// «вчера», и полоска активности врёт на границе суток.

import { isClosedStatus } from "../tasks/statuses.ts";

export const TEAM_TZ = "Europe/Belgrade";
/** Окно активности: столько последних дней рисует полоска и считает «активных дней». */
export const ACTIVITY_DAYS = 14;
/** Окно «закрыто за период», доли в срок и среднего времени закрытия. */
export const CLOSED_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

export type StatsMember = { telegram_id: number; name: string };
export type StatsTaskRow = {
  status: string;
  created_at?: string | null;
  completed_at?: string | null;
  due_date?: string | null;
  assignee_telegram_ids?: number[] | null;
};
export type StatsMeetingRow = { author: number | null };
/** Датированное действие человека: правка задачи, комментарий, запись встречи, заметка. */
export type ActivityEvent = { telegram_id: number; at: string };

export type PersonStats = {
  telegram_id: number;
  name: string;
  tasks: {
    open: number;
    inProgress: number;
    /** Незакрытые со сроком раньше сегодняшнего дня. */
    overdue: number;
    /** Закрыто всего (done и cancelled — по общему правилу isClosedStatus). */
    closed: number;
    /** Закрыто за последние CLOSED_WINDOW_DAYS дней — по completed_at, не по updated_at. */
    closedRecent: number;
    /** Доля закрытых в срок среди закрытых за окно, у которых был срок. null — таких нет. */
    onTimeRate: number | null;
    onTimeBase: number;
    /** Среднее «поставлена → закрыта» за окно, в днях. null — не по чему считать. */
    avgCloseDays: number | null;
  };
  meetings: {
    /** Опубликованные встречи, где человек автор. */
    published: number;
    /** На вычитке. null — смотрящему это число не положено (см. swarm-api/stats.ts). */
    inReview: number | null;
  };
  activity: {
    /** Сколько из последних ACTIVITY_DAYS дней было хоть одно действие. */
    activeDays: number;
    /** Действий по дням, от самого старого к сегодняшнему; длина ACTIVITY_DAYS. */
    strip: number[];
    /** Последнее известное действие (ISO) или null. */
    lastActiveAt: string | null;
  };
};

/** Календарный день момента по времени команды, YYYY-MM-DD. */
export function teamDay(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  // en-CA даёт ровно YYYY-MM-DD.
  return d.toLocaleDateString("en-CA", { timeZone: TEAM_TZ });
}

/** Последние `n` дней по времени команды, от старого к сегодняшнему. */
export function lastDays(now: Date, n: number): string[] {
  const out: string[] = [];
  // Шаг по полудню, а не по полуночи: так переход на летнее время не съедает и не дублирует день.
  const noon = Date.parse(`${teamDay(now)}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    out.push(teamDay(new Date(noon - i * DAY_MS)));
  }
  return out;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;

function taskStats(rows: StatsTaskRow[], now: Date): PersonStats["tasks"] {
  const today = teamDay(now);
  const since = now.getTime() - CLOSED_WINDOW_DAYS * DAY_MS;
  let open = 0, inProgress = 0, overdue = 0, closed = 0, closedRecent = 0;
  let onTime = 0, onTimeBase = 0;
  const leads: number[] = [];
  for (const t of rows) {
    if (!isClosedStatus(t.status)) {
      if (t.status === "in_progress") inProgress++;
      else open++;
      if (t.due_date && t.due_date.slice(0, 10) < today) overdue++;
      continue;
    }
    closed++;
    if (!t.completed_at || Date.parse(t.completed_at) < since) continue;
    closedRecent++;
    if (t.due_date) {
      onTimeBase++;
      if (teamDay(t.completed_at) <= t.due_date.slice(0, 10)) onTime++;
    }
    if (t.created_at) {
      const d = (Date.parse(t.completed_at) - Date.parse(t.created_at)) /
        DAY_MS;
      if (d >= 0) leads.push(d);
    }
  }
  return {
    open,
    inProgress,
    overdue,
    closed,
    closedRecent,
    onTimeRate: onTimeBase ? round2(onTime / onTimeBase) : null,
    onTimeBase,
    avgCloseDays: leads.length
      ? round1(leads.reduce((a, b) => a + b, 0) / leads.length)
      : null,
  };
}

/**
 * Сводка по каждому участнику. Задача засчитывается КАЖДОМУ исполнителю из
 * assignee_telegram_ids (у общей задачи два исполнителя — она в работе у обоих).
 * `reviewCounts` = null — число «на вычитке» не отдаём никому.
 */
export function computePeopleStats(input: {
  members: StatsMember[];
  tasks: StatsTaskRow[];
  meetings: StatsMeetingRow[];
  reviewCounts: Map<number, number> | null;
  events: ActivityEvent[];
  now: Date;
}): PersonStats[] {
  const { members, now } = input;
  const days = lastDays(now, ACTIVITY_DAYS);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const byId = new Map(members.map((m) => [m.telegram_id, m]));

  const tasksOf = new Map<number, StatsTaskRow[]>();
  for (const t of input.tasks) {
    for (const id of new Set(t.assignee_telegram_ids ?? [])) {
      if (!byId.has(id)) continue;
      const list = tasksOf.get(id) ?? [];
      list.push(t);
      tasksOf.set(id, list);
    }
  }

  const published = new Map<number, number>();
  for (const m of input.meetings) {
    if (m.author != null) {
      published.set(m.author, (published.get(m.author) ?? 0) + 1);
    }
  }

  const strips = new Map<number, number[]>();
  const last = new Map<number, string>();
  for (const e of input.events) {
    if (!byId.has(e.telegram_id) || Number.isNaN(Date.parse(e.at))) continue;
    const prev = last.get(e.telegram_id);
    if (!prev || Date.parse(e.at) > Date.parse(prev)) {
      last.set(e.telegram_id, e.at);
    }
    const i = dayIndex.get(teamDay(e.at));
    if (i === undefined) continue;
    const strip = strips.get(e.telegram_id) ?? new Array(ACTIVITY_DAYS).fill(0);
    strip[i]++;
    strips.set(e.telegram_id, strip);
  }

  return members.map((m) => {
    const strip = strips.get(m.telegram_id) ?? new Array(ACTIVITY_DAYS).fill(0);
    return {
      telegram_id: m.telegram_id,
      name: m.name,
      tasks: taskStats(tasksOf.get(m.telegram_id) ?? [], now),
      meetings: {
        published: published.get(m.telegram_id) ?? 0,
        inReview: input.reviewCounts
          ? input.reviewCounts.get(m.telegram_id) ?? 0
          : null,
      },
      activity: {
        activeDays: strip.filter((n) => n > 0).length,
        strip,
        lastActiveAt: last.get(m.telegram_id) ?? null,
      },
    };
  });
}
