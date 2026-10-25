"use client";
import { useMemo } from "react";
import { useDt, useRoyNav } from "../nav";
import { DashTaskRow } from "../dash/shared";
import type { DashboardData } from "../dash/useDashboardData";
import { AreaSpark } from "./LineChart";
import { Delta } from "./QualityWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { FILL_CARD } from "./blockFill";
import { isDone, isOverdue } from "@/lib/smartLists";
import { countryFlag } from "@/lib/countries";

// Ближайшие задачи и продажи. Доска стикеров — StickerBoard.tsx.

export const TOP_TASKS = 5;

export function TopTasksWidget({ data, onCreate }: { data: DashboardData; onCreate: () => void }) {
  const dt = useDt();
  const { openTasks } = useRoyNav();
  const open = useMemo(() => data.mine.filter((t) => !isDone(t)), [data.mine]);
  const top = useMemo(() => [...open].filter((t) => t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, TOP_TASKS), [open]);
  const overdue = open.filter((t) => isOverdue(t)).length;
  const { loading, failed, retry } = data.tasksState;
  return (
    <div className={`rounded-[12px] border border-line bg-surface p-2 ${FILL_CARD}`}>
      {loading && [0, 1, 2].map((i) => <div key={i} className="roy-shim m-1" style={{ height: 34, borderRadius: 8 }} />)}
      {failed && (
        <div className="px-3 py-3 text-ink-soft" style={{ fontSize: 13 }}>
          {dt("Не загрузилось", "Failed to load")} <button type="button" onClick={retry} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
        </div>
      )}
      {!loading && !failed && top.map((t) => <DashTaskRow key={t.id} task={t} />)}
      {!loading && !failed && !top.length && (
        <div className="px-3 py-5 text-center text-ink-mute" style={{ fontSize: 13 }}>{dt("Задач со сроком на вас нет", "No tasks with a due date on you")}</div>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2" style={{ fontSize: 12 }}>
        <span className="text-ink-mute">
          {overdue > 0 && <b className="text-[var(--pri-high)]">{dt(`${overdue} просрочено`, `${overdue} overdue`)} · </b>}
          {dt(`всего открытых ${open.length}`, `${open.length} open`)}
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={onCreate} className="font-medium text-primary hover:underline">{dt("+ задача", "+ task")}</button>
          <button type="button" onClick={() => openTasks("mine", "all")} className="font-medium text-primary hover:underline">{dt("Все →", "All →")}</button>
        </span>
      </div>
    </div>
  );
}

export function SalesWidget({ codes, sales }: { codes: string[]; sales: SalesState }) {
  const dt = useDt();
  const list = codes.map((cc) => sales.byCc[cc]).filter(Boolean);
  const total = list.reduce((s, c) => s + (c.last ?? 0), 0);
  const prev = list.reduce((s, c) => s + (c.months.at(-2)?.[1] ?? 0), 0);
  const months = Array.from(new Set(list.flatMap((c) => c.months.map((m) => m[0])))).sort().slice(-12);
  const series = months.map((m) => list.reduce((s, c) => s + (c.months.find((x) => x[0] === m)?.[1] ?? 0), 0));
  const lastMonth = months.at(-1);
  return (
    <div className={`rounded-[12px] border border-line bg-surface p-4 ${FILL_CARD}`}>
      {sales.loading ? <div className="roy-shim" style={{ height: 90, borderRadius: 8 }} /> : (
        <>
          <div className="font-mono font-semibold text-ink" style={{ fontSize: 30, letterSpacing: "-0.02em" }}>{list.length ? fmtEur(total) : "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
            <Delta v={prev ? ((total - prev) / prev) * 100 : null} />
            <span className="text-ink-mute">{dt(`за ${lastMonth ?? "—"} к прошлому месяцу, %`, `${lastMonth ?? "—"} vs previous month, %`)}</span>
          </div>
          <AreaSpark values={series} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-soft" style={{ fontSize: 11.5 }}>
            {list.map((c) => <span key={c.cc}>{countryFlag(c.cc)} {c.last != null ? fmtEur(c.last) : "—"}</span>)}
            {sales.failed.length > 0 && <span className="text-[var(--pri-high)]">{dt(`не загрузилось: ${sales.failed.join(", ")}`, `failed: ${sales.failed.join(", ")}`)}</span>}
          </div>
        </>
      )}
    </div>
  );
}
