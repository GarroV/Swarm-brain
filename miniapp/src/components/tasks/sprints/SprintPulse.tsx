"use client";
import type { SprintKpi } from "@/lib/initiatives";
import { cn } from "@/lib/utils";
import { useDt } from "@/components/roy/nav";

// Пульс спринта (стенд: screens-work.js → sprintPulse): одна полоса «сколько сделано» и одна
// строка «что требует внимания». Заменил ряд чипов в шапке — цифры те же (sprintKpi), место
// теперь своё, и полоса читается с порога.
//
// Показываем только ненулевое. Ряд из семи цифр, где шесть — нули, читается как «всё плохо
// везде понемногу»; ряд из двух говорит, куда смотреть. Отменённые стоят отдельно и вне
// процента (D010): закрытая отменой задача — не сделанная работа.

type Tone = "bad" | "warn" | "soft";

function Mark({ label, value, tone = "soft" }: { label: string; value: number; tone?: Tone }) {
  if (value <= 0) return null;
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 text-ink-soft"
      style={{ fontSize: 12 }}
    >
      <b
        className={cn(
          "font-mono font-semibold",
          tone === "bad" ? "text-pri-high" : tone === "warn" ? "text-pri-med" : "text-ink",
        )}
      >
        {value}
      </b>
      {label}
    </span>
  );
}

export function SprintPulse({ kpi, showUnchecked, extra }: {
  kpi: SprintKpi;
  /** «Не отмечено» — только с дня сверки (D013). */
  showUnchecked: boolean;
  /** Взято после старта — «сверх плана». */
  extra: number;
}) {
  const dt = useDt();
  const work = Math.max(kpi.total - kpi.done, 0);
  const donePct = kpi.total ? (kpi.done / kpi.total) * 100 : 0;
  const marks = [
    <Mark key="p" label={dt("проблема", "problem")} value={kpi.checkProblem} tone="bad" />,
    <Mark key="r" label={dt("риск", "at risk")} value={kpi.checkRisk} tone="warn" />,
    showUnchecked ? <Mark key="u" label={dt("не отмечено", "not checked")} value={kpi.unchecked} /> : null,
    <Mark key="n" label={dt("без исполнителя", "unassigned")} value={kpi.unassigned} />,
    <Mark key="c" label={dt("к переносу", "to carry")} value={kpi.toCarry} />,
    <Mark key="e" label={dt("сверх плана", "extra")} value={extra} />,
    <Mark key="x" label={dt("отменено", "cancelled")} value={kpi.cancelled} />,
    <Mark key="d" label={dt("удалённых", "deleted")} value={kpi.removed} />,
  ];
  const anyMark = kpi.checkProblem + kpi.checkRisk + (showUnchecked ? kpi.unchecked : 0) +
      kpi.unassigned + kpi.toCarry + extra + kpi.cancelled + kpi.removed > 0;

  return (
    <div className="shrink-0 border-b border-line bg-surface-2 px-4 py-2.5 lg:px-5">
      <div className="flex items-center gap-2.5 text-ink-soft" style={{ fontSize: 12.5 }}>
        <b className="whitespace-nowrap font-mono font-semibold text-ink" style={{ fontSize: 14 }}>
          {dt(`${kpi.done} из ${kpi.total}`, `${kpi.done} of ${kpi.total}`)}
        </b>
        <span className="whitespace-nowrap text-ink-mute">
          {dt(`сделано · ${kpi.percent}%`, `done · ${kpi.percent}%`)}
        </span>
        <div className="flex h-[5px] min-w-[80px] flex-1 overflow-hidden rounded-full bg-line">
          <i className="block h-full bg-status-done transition-[width]" style={{ width: `${donePct}%` }} />
          <i className="block h-full bg-accent-line" style={{ width: `${100 - donePct}%` }} />
        </div>
        <span className="hidden whitespace-nowrap text-ink-mute sm:inline">
          {dt(`${work} в работе`, `${work} in progress`)}
          {kpi.checkOk > 0 && dt(` · по плану ${kpi.checkOk}`, ` · on track ${kpi.checkOk}`)}
        </span>
      </div>
      {anyMark && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-ink-mute" style={{ fontSize: 12 }}>
            {dt("требуют внимания:", "need attention:")}
          </span>
          {marks}
        </div>
      )}
    </div>
  );
}
