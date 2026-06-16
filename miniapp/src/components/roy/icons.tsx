import type { CSSProperties } from "react";

// Иконографика из design_handoff_roy (mobile-proto-ui.jsx, объект P): viewBox 20×20,
// обводка 1.7–2.2, без заливки, круглые концы. Портировано 1:1 для пиксельного
// соответствия дизайну Claude Design.
export const ROY_ICON_PATHS = {
  search: "M11 11l4 4M7 12a5 5 0 100-10 5 5 0 000 10z",
  spark: "M10 2.5l1.7 4.3 4.3 1.7-4.3 1.7L10 14.5l-1.7-4.3L4 8.5l4.3-1.7z",
  task: "M5 4.5h2M5 10h2M5 15.5h2M10 4.5h6M10 10h6M10 15.5h6",
  book: "M3 4h6a2 2 0 012 2v10a2 2 0 00-2-2H3zM17 4h-6a2 2 0 00-2 2v10a2 2 0 012-2h6z",
  cal: "M3.5 5.5h13v11h-13zM3.5 8.7h13M7 3.2v3M13 3.2v3",
  plus: "M10 4.5v11M4.5 10h11",
  cleft: "M12.5 5l-5 5 5 5",
  cright: "M8 5l5 5-5 5",
  filter: "M3 5h14l-5.5 6.5V16l-3 1.5v-7z",
  globe: "M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM2.5 10h15M10 2.5c2.4 2 2.4 13 0 15M10 2.5c-2.4 2-2.4 13 0 15",
  clock: "M10 4.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM10 7.2v3l2 1.4",
  link: "M8.3 11.7a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M11.7 8.3a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8",
  flag: "M5 3.2v14M5 4h9l-2 3 2 3H5",
  mic: "M10 3a2 2 0 012 2v4a2 2 0 01-4 0V5a2 2 0 012-2zM5.5 9a4.5 4.5 0 009 0M10 13.5v3M7.5 16.5h5",
  doc: "M5.5 2.5h6l3.5 3.5v11h-9.5zM11.5 2.5v4h4",
  note: "M4.5 3.5h11v9l-3 4h-8zM12.5 16.5v-4h4",
  meet: "M3.5 5.5h13v11h-13zM3.5 8.7h13M7 3.2v3M13 3.2v3M6.5 12h3M6.5 14h5",
  dots: "M5 10h.01M10 10h.01M15 10h.01",
  arrow: "M4 10h12M11 5l5 5-5 5",
  x: "M5 5l10 10M15 5L5 15",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  home: "M3.5 8.5L10 3l6.5 5.5M5 7.5V16h10V7.5",
  pdf: "M5.5 2.5h6l3.5 3.5v11h-9.5zM11.5 2.5v4h4M7 11h1.2a1 1 0 010 2H7v-2zm0 2v2",
  pencil: "M4 16l.9-3.3L13 4.6a1.3 1.3 0 011.8 0l.6.6a1.3 1.3 0 010 1.8L7.3 15.1 4 16z",
  trash: "M5 6h10M8.5 6V4.5a1 1 0 011-1h1a1 1 0 011 1V6M6.5 6v9a1 1 0 001 1h5a1 1 0 001-1V6M8.5 9v4M11.5 9v4",
} as const;

export type RoyIconName = keyof typeof ROY_ICON_PATHS;

type RoyIconProps = {
  name: RoyIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

export function RoyIcon({ name, size = 20, strokeWidth = 1.7, className, style }: RoyIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d={ROY_ICON_PATHS[name]} />
    </svg>
  );
}
