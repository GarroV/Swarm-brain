import type { CSSProperties } from "react";

// Иконографика из design_handoff_roy (mobile-proto-ui.jsx, объект P): viewBox 20×20,
// обводка 1.7–2.2, без заливки, круглые концы. Портировано 1:1 для пиксельного
// соответствия дизайну Claude Design.
export const ROY_ICON_PATHS = {
  search: "M11 11l4 4M7 12a5 5 0 100-10 5 5 0 000 10z",
  spark: "M10 2.5l1.7 4.3 4.3 1.7-4.3 1.7L10 14.5l-1.7-4.3L4 8.5l4.3-1.7z",
  task: "M5 4.5h2M5 10h2M5 15.5h2M10 4.5h6M10 10h6M10 15.5h6",
  tag: "M4 4h6l6 6-6 6-6-6V4z M6.5 6.5h.01",
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
  team: "M7.5 8.5a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM3.2 15.5c0-2.4 1.9-4 4.3-4s4.3 1.6 4.3 4M13 8.2a2 2 0 100-4M14 11.7c1.7.3 3 1.6 3 3.8",
  dots: "M5 10h.01M10 10h.01M15 10h.01",
  arrow: "M4 10h12M11 5l5 5-5 5",
  x: "M5 5l10 10M15 5L5 15",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  home: "M3.5 8.5L10 3l6.5 5.5M5 7.5V16h10V7.5",
  pdf: "M5.5 2.5h6l3.5 3.5v11h-9.5zM11.5 2.5v4h4M7 11h1.2a1 1 0 010 2H7v-2zm0 2v2",
  pencil: "M4 16l.9-3.3L13 4.6a1.3 1.3 0 011.8 0l.6.6a1.3 1.3 0 010 1.8L7.3 15.1 4 16z",
  trash: "M5 6h10M8.5 6V4.5a1 1 0 011-1h1a1 1 0 011 1V6M6.5 6v9a1 1 0 001 1h5a1 1 0 001-1V6M8.5 9v4M11.5 9v4",
  // Предупреждение (треугольник + восклицательный знак) — для деструктивных подтверждений.
  warn: "M10 3.4 2.8 16.4h14.4zM10 8v3.4M10 14h.01",
  // Виды задач (лайн-арт «консоли»): таймлайн = ось + ступенчатые гантт-бары,
  // доска = колонки, граф = три узла-кружка с рёбрами. Выверено визуально (chrome preview).
  timeline: "M3.5 4.5v11M6.5 7h6M5.5 10h8M8 13h4.5",
  board: "M3.5 4.5h13v11h-13zM8 4.5v11M12.5 4.5v11",
  graph: "M6.6 7.2 13.4 7.2M6.1 8.6 8.9 13M13.9 8.6 11.1 13M3.3 7a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0 -3.4 0M13.3 7a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0 -3.4 0M8.3 14.5a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0 -3.4 0",
  // Замок — маркер приватной («личной») записи/встречи.
  lock: "M6.5 9V6.8a3.5 3.5 0 017 0V9M4.8 9h10.4v7.4H4.8zM10 12v2",
  // Глаз/перечёркнутый глаз — видимость (публично/скрыто из общего пула). Лепестки-дуги (A) в
  // стиле остальных круглых деталей набора (team/mic/lock), не bezier — 1:1 с их построением.
  eye: "M2.5 10A9 5.5 0 0117.5 10A9 5.5 0 012.5 10Z M10 12.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z",
  eyeOff: "M2.5 10A9 5.5 0 0117.5 10A9 5.5 0 012.5 10Z M10 12.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z M3 4l14 12",
  // Знак вопроса (лайн-арт) — кнопка фидбека.
  help: "M7.5 7.4a2.5 2.5 0 1 1 4.2 1.9c-.9.8-1.7 1.2-1.7 2.4M10 15.2h.01",
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
