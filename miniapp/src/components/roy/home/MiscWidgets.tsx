"use client";
import { useEffect, useMemo, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { DashTaskRow } from "../dash/shared";
import type { DashboardData } from "../dash/useDashboardData";
import { AreaSpark } from "./LineChart";
import { Delta } from "./QualityWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { FILL_CARD } from "./blockFill";
import { isDone, isOverdue } from "@/lib/smartLists";
import { countryFlag } from "@/lib/countries";
import { homeDateReason, nextHomeTasks } from "@/lib/homeTasks";
import { NEXT_TASK_TEXT } from "./nextTaskText";
import { NextTaskRow } from "./NextTaskRow";
import { fetchProjects } from "@/lib/api";
import type { Project } from "@/types";

// Ближайшие задачи и продажи. Доска стикеров — StickerBoard.tsx.

// legacy — главная без флага экрана «А» (lib/homeFlag.ts): прежняя строка DashTaskRow и «Все →» внизу, без запроса проектов.
export function TopTasksWidget({ data, onCreate, legacy = false }: { data: DashboardData; onCreate: () => void; legacy?: boolean }) {
  const dt = useDt();
  const { openTasks } = useRoyNav();
  const open = useMemo(() => data.mine.filter((t) => !isDone(t)), [data.mine]);
  const now = useMemo(() => new Date(), [data.tasks]);
  const top = useMemo(() => nextHomeTasks(open, now), [open, now]);
  const overdue = open.filter((t) => isOverdue(t)).length;
  const { loading, failed, retry } = data.tasksState;
  // Названия проектов — подпись под задачей. Не пришли — подписи нет, строки те же.
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    if (legacy) return;
    fetchProjects().then(setProjects).catch((e) => console.warn("[home] projects", e));
  }, [legacy]);
  return (
    <div className={`rounded-[12px] border border-line bg-surface p-2 ${FILL_CARD}`}>
      {loading && [0, 1, 2].map((i) => <div key={i} className="roy-shim m-1" style={{ height: 34, borderRadius: 8 }} />)}
      {failed && (
        <div className="px-3 py-3 text-ink-soft" style={{ fontSize: 13 }}>
          {dt("Не загрузилось", "Failed to load")} <button type="button" onClick={retry} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
        </div>
      )}
      {!loading && !failed && top.map((t) => {
        const reason = homeDateReason(t, now);
        if (legacy) return <DashTaskRow key={t.id} task={t} reminder={reason?.kind === "ping" ? { date: reason.date, label: dt(...NEXT_TASK_TEXT.reminderReason) } : undefined} />;
        const project = projects.find((p) => p.id === t.project_id)?.name ?? null;
        return <DashTaskRow key={t.id} task={t} render={(shown, onToggle) => <NextTaskRow task={shown} project={project} reason={reason} now={now} onToggle={onToggle} />} />;
      })}
      {!loading && !failed && !top.length && (
        <div className="px-3 py-5 text-center text-ink-mute" style={{ fontSize: 13 }}>{dt(...NEXT_TASK_TEXT.empty)}</div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2" style={{ fontSize: 12 }}>
        <span className="text-ink-mute">
          <span className="block">{dt(...NEXT_TASK_TEXT.order)}</span>
          {overdue > 0 && <b className="text-[var(--pri-high)]">{dt(`${overdue} просрочено`, `${overdue} overdue`)} · </b>}
          {dt(`всего открытых ${open.length}`, `${open.length} open`)}
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={onCreate} className="font-medium text-primary hover:underline">{dt("+ задача", "+ task")}</button>
          {legacy && <button type="button" onClick={() => openTasks("mine", "all")} className="font-medium text-primary hover:underline">{dt("Все →", "All →")}</button>}
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
