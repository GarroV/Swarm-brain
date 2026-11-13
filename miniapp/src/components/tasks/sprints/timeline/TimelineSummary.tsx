"use client";
import type { Summary } from "@/lib/sprintTimeline";
import { fmtDay } from "../format";

type Dt = (ru: string, en: string) => string;

function Cell(
  { label, children }: { label: string; children: React.ReactNode },
) {
  return (
    <div className="flex h-9 shrink-0 flex-col justify-center border-r border-line px-4 last:border-r-0">
      <small className="leading-tight text-ink-mute" style={{ fontSize: 11.5 }}>
        {label}
      </small>
      <b
        className="font-semibold leading-tight text-ink"
        style={{ fontSize: 15 }}
      >
        {children}
      </b>
    </div>
  );
}

/** Полоса над лентой: спринт, готово X/Y, до конца, сверка, горит, итог прошлого спринта. */
export function TimelineSummary({ s, dt, attentionOnly, onToggleAttention }: {
  s: Summary;
  dt: Dt;
  attentionOnly: boolean;
  onToggleAttention: () => void;
}) {
  const cur = s.current?.cycle;
  const check = s.daysToCheck === null
    ? dt("не назначена", "not set")
    : s.daysToCheck > 0
    ? dt(`через ${s.daysToCheck} дн`, `in ${s.daysToCheck} d`)
    : s.daysToCheck === 0
    ? dt("сегодня", "today")
    : dt("прошла", "done");
  return (
    <div
      className="flex items-center overflow-x-auto rounded-xl border border-line bg-surface py-2"
      style={{ minHeight: 54 }}
    >
      <Cell label={dt("Идёт", "Active")}>
        {cur ? cur.name : dt("нет идущего спринта", "no active sprint")}
      </Cell>
      {cur && (
        <>
          <Cell label={dt("Готово", "Done")}>
            <span className="font-mono">
              {s.done}
              <span className="text-ink-mute">/ {s.total}</span>
            </span>
          </Cell>
          <Cell label={dt("До конца", "Left")}>
            <span className="font-mono">
              {s.daysToEnd !== null && s.daysToEnd >= 0
                ? dt(`${s.daysToEnd} дн`, `${s.daysToEnd} d`)
                : dt("срок вышел", "overdue")}
            </span>
          </Cell>
          <Cell label={dt("Сверка", "Check-in")}>
            <span className="font-mono">
              {cur.check_date ? fmtDay(cur.check_date) : "—"}
              <span
                className="font-normal text-ink-mute"
                style={{ fontSize: 12 }}
              >
                · {check}
              </span>
            </span>
          </Cell>
        </>
      )}
      <Cell label={dt("Горит", "Needs attention")}>
        <button
          type="button"
          onClick={onToggleAttention}
          aria-pressed={attentionOnly}
          className="font-mono hover:underline"
          style={{ color: s.burning > 0 ? "var(--chart-4)" : undefined }}
        >
          {s.burning}
          <span
            className="ml-1.5 border-b border-dashed font-sans font-medium"
            style={{ fontSize: 12.5 }}
          >
            {attentionOnly
              ? dt("показать все ›", "show all ›")
              : dt("показать ›", "show ›")}
          </span>
        </button>
      </Cell>
      {s.lastAccepted && (
        <div className="ml-auto flex h-9 shrink-0 flex-col justify-center px-4">
          <small
            className="leading-tight text-ink-mute"
            style={{ fontSize: 11.5 }}
          >
            {dt(
              `Прошлый: ${s.lastAccepted.name} · принят`,
              `Last: ${s.lastAccepted.name} · accepted`,
            )}
          </small>
          <b
            className="font-mono font-semibold leading-tight text-ink"
            style={{ fontSize: 13.5 }}
          >
            {dt(
              `${s.lastAccepted.planDone} из ${s.lastAccepted.plan}`,
              `${s.lastAccepted.planDone} of ${s.lastAccepted.plan}`,
            )}
            <span className="font-sans font-normal text-ink-mute">
              {" · "}
              {dt(
                `перенесено ${s.lastAccepted.carried}`,
                `carried ${s.lastAccepted.carried}`,
              )}
            </span>
          </b>
        </div>
      )}
    </div>
  );
}
