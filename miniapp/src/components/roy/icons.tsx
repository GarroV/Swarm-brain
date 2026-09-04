import type { CSSProperties } from "react";
import { ROY_ICON_PATHS, type RoyIconName } from "@/lib/royIcons";

// Иконографика из design_handoff_roy (mobile-proto-ui.jsx, объект P): viewBox 20×20,
// обводка 1.7–2.2, без заливки, круглые концы. Сами пути живут в lib/royIcons.ts
// (данные отдельно от рендера — чтобы их могла типизировать чистая логика).
// Ре-экспорт оставлен: полтора десятка файлов импортируют имя иконки отсюда.
export { ROY_ICON_PATHS };
export type { RoyIconName };

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
