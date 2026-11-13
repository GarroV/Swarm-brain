import type { CSSProperties } from "react";
import type { BarState, ColKind } from "@/lib/sprintTimeline";

// Цвета ленты — только токены продукта (globals.css): `--chart-*` в обеих темах уже подобраны под
// фон, а `color-mix` даёт подложку и рамку нужной плотности без захардкоженных оттенков.
const tone = (c: string, fill: number, edge: number): CSSProperties => ({
  background: `color-mix(in srgb, ${c} ${fill}%, var(--surface))`,
  borderColor: `color-mix(in srgb, ${c} ${edge}%, transparent)`,
});

export const BAR_STYLE: Record<BarState, CSSProperties> = {
  work: tone("var(--chart-1)", 16, 60),
  done: tone("var(--chart-3)", 18, 60),
  risk: tone("var(--chart-4)", 20, 65),
  problem: tone("var(--chart-5)", 20, 65),
  planned: {
    background: "var(--surface-2)",
    borderColor: "var(--line-2)",
    borderStyle: "dashed",
  },
  extra: { ...tone("var(--chart-1)", 9, 70), borderStyle: "dashed" },
  cancelled: {
    background: "var(--surface-2)",
    borderColor: "var(--line-2)",
    color: "var(--ink-mute)",
  },
};

/** Перенос: штриховка янтарём; без причины — красным (просьба вписать её). */
export const MOVE_STYLE = (noReason: boolean): CSSProperties => {
  const c = noReason ? "var(--chart-5)" : "var(--chart-4)";
  return {
    backgroundImage:
      `repeating-linear-gradient(135deg, color-mix(in srgb, ${c} 22%, transparent) 0 5px, color-mix(in srgb, ${c} 10%, transparent) 5px 10px)`,
    borderColor: `color-mix(in srgb, ${c} 70%, transparent)`,
    color: c,
  };
};

/** Подложка столбца: прошлые тусклее, идущий подсвечен, будущие в штриховку. */
export const COL_STYLE: Record<ColKind, CSSProperties> = {
  past: { background: "color-mix(in srgb, var(--ink) 4%, transparent)" },
  current: { background: "color-mix(in srgb, var(--chart-1) 6%, transparent)" },
  future: {
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0 9px, color-mix(in srgb, var(--ink-mute) 9%, transparent) 9px 10px)",
  },
};

export const STATE_DOT: Record<BarState, string> = {
  work: "var(--chart-1)",
  done: "var(--chart-3)",
  risk: "var(--chart-4)",
  problem: "var(--chart-5)",
  planned: "var(--line-2)",
  extra: "var(--chart-1)",
  cancelled: "var(--ink-mute)",
};
