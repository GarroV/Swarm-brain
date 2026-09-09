// Текстовый вид статистики и журнала задач для MCP (issue #286). Чистые функции — то, что агент
// читает глазами и приносит человеку, тестируется отдельно от запросов (analytics-format.test.ts).
//
// Правило файла то же, что у format.ts: выдача обязана говорить, ЧТО получилось, и честно
// признаваться, чего в данных нет. Молчаливый ноль хуже ошибки — он выглядит как факт.

import type { TaskStats } from "../../_shared/tasks/analytics.ts";

/** Дата раскатки журнала перемещений: раньше неё истории почти нет (см. миграцию #286). */
export const JOURNAL_SINCE_NOTE =
  "Журнал перемещений ведётся с раскатки #286 — за более раннее время истории в данных нет.";

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const day = (iso: string): string => iso.slice(0, 10);

export function formatTaskStats(s: TaskStats, opts: { label: string; scope?: string }): string {
  const lines: string[] = [
    `📊 Задачи — ${opts.label} (с ${day(s.sinceISO)})${opts.scope ? `, ${opts.scope}` : ""}`,
    "",
    `Создано: ${s.createdInPeriod} · Закрыто: ${s.closedInPeriod}`,
    `Открыто сейчас: ${s.openNow} (в работе ${s.inProgressNow}, просрочено ${s.overdueNow})`,
  ];

  lines.push(
    s.leadTimeAvgDays === null
      ? "Время от постановки до закрытия: нет закрытых задач в периоде"
      : `Время от постановки до закрытия: в среднем ${s.leadTimeAvgDays} дн, медиана ${s.leadTimeMedianDays} дн`,
  );
  lines.push(
    s.onTimeRate === null
      ? "В срок: считать не на чем — у закрытых задач не стояли дедлайны"
      : `В срок: ${pct(s.onTimeRate)} (из ${s.onTimeBase} задач со сроком)`,
  );
  if (s.oldestOpenDays !== null) lines.push(`Самая старая незакрытая: ${s.oldestOpenDays} дн`);

  if (s.closedByAssignee.length) {
    lines.push("", "Закрыли за период:");
    for (const r of s.closedByAssignee) lines.push(`• ${r.name} — ${r.count}`);
  }

  lines.push(
    "",
    "Что здесь НЕ посчитано: время в каждом статусе, cycle time и переносы сроков — они считаются по журналу перемещений.",
    JOURNAL_SINCE_NOTE,
  );
  return lines.join("\n");
}

export type JournalRow = {
  field: string;
  old_value: string | null;
  new_value: string | null;
  author: string;
  created_at: string;
};

const FIELD_LABEL: Record<string, string> = {
  status: "статус",
  due_date: "срок",
  assignee: "исполнитель",
  project: "проект",
  sprint: "спринт",
  priority: "приоритет",
};

const change = (r: JournalRow): string => {
  const label = FIELD_LABEL[r.field] ?? r.field;
  const from = r.old_value ?? "—";
  const to = r.new_value ?? "—";
  return `${label}: ${from} → ${to}`;
};

const stamp = (iso: string): string => iso.slice(0, 16).replace("T", " ");

export function formatTaskHistory(rows: JournalRow[], opts: { title?: string } = {}): string {
  const head = opts.title ? `История задачи «${opts.title}»` : "История задачи";
  if (!rows.length) return `${head}: изменений не записано. ${JOURNAL_SINCE_NOTE}`;
  return [
    `${head}: ${rows.length} изменений`,
    "",
    ...rows.map((r) => `• [${stamp(r.created_at)}] ${r.author}: ${change(r)}`),
  ].join("\n");
}

export type RecentChangeRow = JournalRow & { task_id: string; task_title: string };

/**
 * Все изменения за период, сгруппированные по задаче — вход для выгрузки статистики
 * «где, когда, куда передвинули». `truncated` говорится ПРЯМО: обрезанная молча выдача
 * неотличима от спокойной недели.
 */
export function formatRecentChanges(
  rows: RecentChangeRow[],
  opts: { sinceISO: string; truncated?: boolean },
): string {
  if (!rows.length) {
    return `Изменений по задачам с ${day(opts.sinceISO)} нет. ${JOURNAL_SINCE_NOTE}`;
  }
  const byTask = new Map<string, RecentChangeRow[]>();
  for (const r of rows) {
    const list = byTask.get(r.task_id) ?? [];
    list.push(r);
    byTask.set(r.task_id, list);
  }
  const blocks = [...byTask.entries()].map(([id, list]) =>
    [`• ${list[0].task_title} (id: ${id})`, ...list.map((r) => `  [${stamp(r.created_at)}] ${r.author}: ${change(r)}`)].join("\n")
  );
  const tail = opts.truncated
    ? "\n\n⚠️ Выдача обрезана лимитом — изменений БОЛЬШЕ, чем показано. Подними limit или сузь since."
    : "";
  return `Изменения по задачам с ${day(opts.sinceISO)}: ${rows.length} в ${byTask.size} задачах.\n\n${blocks.join("\n\n")}${tail}`;
}
