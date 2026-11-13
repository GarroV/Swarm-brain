import type { CSSProperties } from "react";
import { BAR_STYLE, MOVE_STYLE } from "./timelineStyle";

function Item({ style, label }: { style: CSSProperties; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i
        className="block h-[9px] w-4 rounded-[3px] border"
        style={{ ...style, borderStyle: style.borderStyle ?? "solid" }}
      />
      {label}
    </span>
  );
}

/** Легенда статусов под лентой. */
export function TimelineLegend(
  { dt }: { dt: (ru: string, en: string) => string },
) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-1 text-ink-soft"
      style={{ fontSize: 12 }}
    >
      <Item style={BAR_STYLE.work} label={dt("в работе", "in progress")} />
      <Item style={BAR_STYLE.done} label={dt("готово", "done")} />
      <Item style={BAR_STYLE.risk} label={dt("риск", "risk")} />
      <Item style={BAR_STYLE.problem} label={dt("проблема", "problem")} />
      <Item style={BAR_STYLE.planned} label={dt("запланирована", "planned")} />
      <Item style={BAR_STYLE.extra} label={dt("сверх плана", "beyond plan")} />
      <Item
        style={MOVE_STYLE(false)}
        label={dt("перенос (причина на наведении)", "move (reason on hover)")}
      />
      <Item
        style={MOVE_STYLE(true)}
        label={dt("перенос без причины", "move without a reason")}
      />
      <span className="ml-auto text-ink-mute">
        {dt("блёклое — прошлые спринты", "faded — past sprints")}
      </span>
    </div>
  );
}
