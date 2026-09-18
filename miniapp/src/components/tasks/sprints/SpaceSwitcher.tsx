"use client";
import type { Sprint } from "@/types";
import { useDt } from "@/components/roy/nav";

// Пространство — вкладка доски со своей чередой спринтов. Переключатель отдельным рядом
// над спринтами, потому что порядок вопросов у человека такой: сперва «какой проект», потом
// «какой спринт». Обратный порядок заставляет искать свой спринт среди чужих.
//
// ⚠️ `Sprint` здесь — ВКЛАДКА доски (таблица `sprints`, имя историческое), а не период
// работы: период — `SprintCycle`.

/** null — «Без пространства»: спринты, заведённые до пространств, и они не должны пропасть. */
export const NO_SPACE = null;

export function SpaceSwitcher(
  { spaces, value, onChange, counts, showOrphans = false }: {
    spaces: Sprint[];
    value: string | null;
    onChange: (id: string | null) => void;
    counts?: Map<string | null, number>;
    showOrphans?: boolean;
  },
) {
  const dt = useDt();
  if (spaces.length === 0 && !showOrphans) return null;

  const chip = (id: string | null, label: string) => {
    const active = value === id;
    const n = counts?.get(id);
    return (
      <button
        key={id ?? "__none__"}
        type="button"
        onClick={() => onChange(id)}
        className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
          active
            ? "bg-ink text-background"
            : "border border-line bg-surface text-ink-soft hover:bg-surface-2 dark:backdrop-blur-sm"
        }`}
      >
        {label}
        {
          /* Отделено точкой: «Sprint 24» и счётчик 3 без разделителя читаются как «Sprint 243» —
            проверено на живом экране, имя пространства превращалось в другое имя. */
        }
        {n ? <span className="ml-1 tabular-nums opacity-60">· {n}</span> : null}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
        {dt("Пространство", "Space")}
      </span>
      {spaces.map((s) => chip(s.id, s.name))}
      {showOrphans && chip(NO_SPACE, dt("Без пространства", "No space"))}
    </div>
  );
}
