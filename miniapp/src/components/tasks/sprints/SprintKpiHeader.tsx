"use client";
import type { SprintKpi } from "@/lib/initiatives";
import { useDt } from "@/components/roy/nav";
import { ProgressBar } from "./atoms";

// Шапка спринта: одна полоска и цифры, которые называют вещи своими именами.
//
// Показываем только ненулевое. Ряд из семи цифр, где шесть — нули, читается как «всё плохо
// везде понемногу»; ряд из двух говорит, куда смотреть. Отменённые стоят отдельно и вне
// процента (D010): закрытая отменой задача — не сделанная работа, и подмешивать её в
// «сделано» значит рисовать спринт лучше, чем он был.

function Chip(
  { label, value, tone = "soft" }: {
    label: string;
    value: number;
    tone?: "soft" | "risk" | "problem" | "done";
  },
) {
  if (value === 0) return null;
  const tones = {
    soft: "border-line bg-surface-2 text-ink-soft",
    done: "border-status-done/40 bg-status-done/10 text-status-done",
    risk: "border-pri-med/40 bg-pri-med/10 text-pri-med",
    problem: "border-pri-high/40 bg-pri-high/10 text-pri-high",
  };
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        tones[tone]
      }`}
    >
      {label} <span className="tabular-nums">{value}</span>
    </span>
  );
}

export function SprintKpiHeader(
  { kpi, showUnchecked = false }: { kpi: SprintKpi; showUnchecked?: boolean },
) {
  const dt = useDt();

  if (kpi.total === 0 && kpi.cancelled === 0 && kpi.removed === 0) {
    return (
      <p className="text-xs text-ink-soft">
        {dt("состав пуст", "no tasks yet")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex items-center gap-2">
        <ProgressBar percent={kpi.percent} className="w-28" />
        <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-ink">
          {kpi.done}/{kpi.total} · {kpi.percent}%
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip label={dt("риск", "at risk")} value={kpi.checkRisk} tone="risk" />
        <Chip
          label={dt("проблема", "problem")}
          value={kpi.checkProblem}
          tone="problem"
        />
        <Chip
          label={dt("по плану", "on track")}
          value={kpi.checkOk}
          tone="done"
        />
        {showUnchecked && (
          <Chip
            label={dt("не отмечено", "not checked")}
            value={kpi.unchecked}
          />
        )}
        <Chip label={dt("к переносу", "to carry")} value={kpi.toCarry} />
        <Chip label={dt("отменено", "cancelled")} value={kpi.cancelled} />
        <Chip
          label={dt("без исполнителя", "unassigned")}
          value={kpi.unassigned}
        />
        <Chip label={dt("удалённых", "deleted")} value={kpi.removed} />
      </div>
    </div>
  );
}
