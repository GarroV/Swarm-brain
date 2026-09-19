"use client";
import { useMemo, useState } from "react";
import type {
  Project,
  SprintCycle,
  SprintCycleDetail,
  Task,
  User,
} from "@/types";
import {
  buildSpaceReport,
  type SpaceReport,
  spaceReportMarkdown,
} from "@/lib/spaceAnalytics";
import { useDt } from "@/components/roy/nav";
import { ProgressBar } from "./atoms";
import { fmtDay } from "./format";

// Аналитика пространства: те же семь таблиц, что в эталоне. Экран только рисует — считает
// `lib/spaceAnalytics.ts` под тестами, потому что эти числа пересказывают на встрече как
// факт, и ошибка в них молчит.

function Table(
  { title, head, rows }: {
    title: string;
    head: string[];
    rows: (string | number | null)[][];
  },
) {
  // Пустую таблицу не рисуем: читать нечего, а семь пустых заголовков подряд создают
  // впечатление сломанного экрана.
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="px-0.5 text-sm font-bold text-ink">{title}</h3>
      {/* Таблица шире экрана прокручивается сама, а не растягивает страницу. */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface/40 dark:backdrop-blur-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line/60 text-left text-ink-soft">
              {head.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-2.5 py-1.5 font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line/30 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-2.5 py-1.5 align-top text-ink">
                    {cell === null || cell === ""
                      ? <span className="text-ink-soft/50">—</span>
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AnalyticsScreen(
  { cycles, current, projects, tasks, users, space, spaceName }: {
    cycles: SprintCycle[];
    current: SprintCycleDetail | null;
    projects: Project[];
    tasks: Task[];
    users: User[];
    space: string | null;
    spaceName: string;
  },
) {
  const dt = useDt();
  const [fallback, setFallback] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const report: SpaceReport = useMemo(
    () => buildSpaceReport({ cycles, current, projects, tasks, space }),
    [cycles, current, projects, tasks, space],
  );
  const ownerName = (id: number | null) =>
    id === null
      ? null
      : users.find((u) => u.telegram_id === id)?.name ?? String(id);

  function copy() {
    // Текст готовим ЗДЕСЬ же и пишем в буфер синхронно, без похода на сервер: в Safari и
    // Firefox запись после await молча не срабатывает, потому что жест пользователя уже
    // «потрачен» (D009). Отказ не глотаем — показываем текст полем, его можно выделить.
    const md = spaceReportMarkdown(report, spaceName);
    try {
      navigator.clipboard.writeText(md).then(
        () => {
          setCopied(true);
          setFallback(null);
        },
        () => setFallback(md),
      );
    } catch {
      setFallback(md);
    }
  }

  return (
    <div className="flex-1 min-w-0 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2">
        {report.current && (
          <>
            <span className="text-sm font-bold text-ink">
              {report.current.name}
            </span>
            <ProgressBar percent={report.current.percent} className="w-28" />
            <span className="text-xs tabular-nums text-ink-soft">
              {report.current.done}/{report.current.total} ·{" "}
              {report.current.percent}%
            </span>
          </>
        )}
        <button
          type="button"
          onClick={copy}
          className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2 dark:backdrop-blur-sm"
        >
          {copied
            ? dt("Скопировано", "Copied")
            : dt("Скопировать итоги", "Copy the summary")}
        </button>
      </div>

      {fallback !== null && (
        <div className="space-y-1">
          <p className="text-xs text-destructive">
            {dt(
              "Браузер не дал записать в буфер — выделите текст и скопируйте руками.",
              "The browser refused clipboard access — select the text and copy it by hand.",
            )}
          </p>
          <textarea
            readOnly
            value={fallback}
            rows={8}
            className="w-full rounded-lg border border-line bg-card px-2 py-1.5 font-mono text-[11px] text-ink"
          />
        </div>
      )}

      <Table
        title={dt("Текущий спринт", "Current sprint")}
        head={[
          dt("Сделано", "Done"),
          "%",
          dt("Риск", "Risk"),
          dt("Проблема", "Problem"),
          dt("Не отмечено", "Not checked"),
          dt("К переносу", "To carry"),
          dt("Отменено", "Cancelled"),
        ]}
        rows={report.current
          ? [[
            `${report.current.done}/${report.current.total}`,
            report.current.percent,
            report.current.risk,
            report.current.problem,
            report.current.unchecked,
            report.current.toCarry,
            report.current.cancelled,
          ]]
          : []}
      />

      <Table
        title={dt("Риски", "Risks")}
        head={[
          dt("Задача", "Task"),
          dt("Кто", "Who"),
          dt("Состояние", "State"),
          dt("Комментарий", "Comment"),
        ]}
        rows={report.risks.map((r) => [
          r.title,
          r.person,
          r.status === "problem"
            ? dt("проблема", "problem")
            : dt("риск", "at risk"),
          r.note,
        ])}
      />

      <Table
        title={dt("Причины переносов", "Carry-over reasons")}
        head={[
          dt("Задача", "Task"),
          dt("Переносилась раз", "Times carried"),
          dt("Причина", "Reason"),
        ]}
        rows={report.carries.map((c) => [c.title, c.count, c.reason])}
      />

      <Table
        title={dt("По инициативам", "By initiative")}
        head={[
          dt("Направление", "Direction"),
          dt("Инициатива", "Initiative"),
          dt("Ответственный", "Owner"),
          dt("Сделано", "Done"),
          "%",
          dt("До", "Due"),
          dt("Просрочена", "Overdue"),
        ]}
        rows={report.initiatives.map((
          i,
        ) => [
          i.direction,
          i.initiative,
          ownerName(i.owner),
          `${i.done}/${i.total}`,
          i.percent,
          i.end_date ? fmtDay(i.end_date) : null,
          i.overdue ? dt("да", "yes") : "",
        ])}
      />

      <Table
        title={dt("По людям", "By person")}
        head={[
          dt("Кто", "Who"),
          dt("Сделано", "Done"),
          "%",
          dt("Риск", "Risk"),
          dt("Проблема", "Problem"),
          dt("Не отмечено", "Not checked"),
          dt("Переносилось", "Carried"),
        ]}
        rows={report.people.map((
          p,
        ) => [
          p.person ?? dt("без исполнителя", "unassigned"),
          `${p.done}/${p.total}`,
          p.percent,
          p.risk,
          p.problem,
          p.unchecked,
          p.carried,
        ])}
      />

      <Table
        title={dt("Просрочка", "Overdue")}
        head={[
          dt("Задача", "Task"),
          dt("Кто", "Who"),
          dt("Срок", "Due"),
          dt("Дней", "Days"),
        ]}
        rows={report.overdue.map((
          o,
        ) => [o.title, o.person, fmtDay(o.due_date), o.daysLate])}
      />

      <Table
        title={dt("История спринтов", "Sprint history")}
        head={[
          dt("Спринт", "Sprint"),
          dt("Даты", "Dates"),
          dt("План", "Plan"),
          "%",
          dt("Сверх плана", "Extra"),
          dt("Перенесено", "Carried"),
          dt("Отменено", "Cancelled"),
        ]}
        rows={report.history.map((
          h,
        ) => [
          h.name,
          `${fmtDay(h.start_date)} — ${fmtDay(h.end_date)}`,
          `${h.done}/${h.total}`,
          h.percent,
          `${h.extraDone}/${h.extra}`,
          h.carried,
          h.cancelled,
        ])}
      />

      {report.history.length === 0 && report.current === null && (
        <p className="py-10 text-center text-sm text-ink-soft/70">
          {dt(
            "Считать пока нечего: в пространстве нет ни живого спринта, ни принятых.",
            "Nothing to report yet: this space has neither a live sprint nor accepted ones.",
          )}
        </p>
      )}
    </div>
  );
}
