"use client";
import { cn } from "@/lib/utils";
import { useDt } from "@/components/roy/nav";
import { Toggle } from "@/components/ui/Toggle";
import { STATUS_FILTERS, type StatusFilter, type StatusSet } from "@/lib/smartLists";
import { STATUS_META } from "@/components/roy/ui";

// Ось «статус» (issue #216): переключатели «Открыто / В работе / Готово» ПОВЕРХ оси времени
// (Сегодня/Ближайшие/Все). Владелец 03.09.2026: «фильтры не исключают друг друга, т.е. мы
// можем "все" задачи отсортировать по статусам» и «все статусы сделаем как триггеры
// (визуально), чтобы вживую было видно что включено» → тумблер-switch на каждый статус,
// включённых может быть сколько угодно.
//
// Цвет включённого тумблера — цвет самого статуса (тот же токен, что у точки статуса в строке
// задачи), поэтому включённое состояние читается не только формой, но и цветом.

// Русские подписи и цвета берём из STATUS_META (единый источник со строкой задачи), здесь
// только английские варианты.
const EN: Record<StatusFilter, string> = { open: "Open", in_progress: "In progress", done: "Done" };

type StatusFiltersProps = {
  variant: "rail" | "chips";
  active: StatusSet;
  counts?: Record<StatusFilter, number>;
  onToggle: (id: StatusFilter) => void;
};

export function StatusFilters({ variant, active, counts, onToggle }: StatusFiltersProps) {
  const dt = useDt();
  const rail = variant === "rail";

  return (
    <div
      className={cn(
        rail
          ? "flex flex-col"
          : "flex items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      role="group"
      aria-label={dt("Фильтр по статусу", "Filter by status")}
    >
      {STATUS_FILTERS.map((id) => {
        const meta = STATUS_META[id];
        const on = active.has(id);
        const count = counts?.[id];
        const label = dt(meta.label, EN[id]);
        return (
          // Кликабельна ВСЯ строка, а не только сам тумблер: попасть в переключатель 30×18
          // мышью и пальцем одинаково неудобно, а строка целиком — цель нормального размера.
          <button
            key={id}
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => onToggle(id)}
            className={cn(
              "flex shrink-0 items-center gap-2 transition-colors",
              rail ? "rounded-[10px] px-2.5 py-1.5 text-left hover:bg-surface" : "",
            )}
            style={{ fontSize: rail ? 12.5 : 12, minHeight: rail ? undefined : 36 }}
          >
            <span className={cn("font-semibold transition-colors", on ? "text-ink" : "text-ink-mute", rail && "flex-1")}>
              {label}
            </span>
            {count != null && count > 0 && (
              <span className={cn("font-mono", on ? "text-ink-soft" : "text-ink-mute")} style={{ fontSize: 11 }}>
                {count}
              </span>
            )}
            <Toggle on={on} asVisual color={meta.color} size="sm" />
          </button>
        );
      })}
    </div>
  );
}
