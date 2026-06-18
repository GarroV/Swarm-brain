"use client";
import { cn } from "@/lib/utils";
import type { Lens } from "@/lib/smartLists";

const ITEMS: { id: Lens; label: string }[] = [
  { id: "mine", label: "Мои" },
  { id: "team", label: "Команда" },
  { id: "all", label: "Все" },
];

// Переключатель линзы: мои задачи / все задачи команды.
export function LensToggle({ lens, onChange }: { lens: Lens; onChange: (l: Lens) => void }) {
  return (
    <div className="flex gap-[3px] rounded-[10px] border border-line bg-surface-2 p-[3px]">
      {ITEMS.map((it) => {
        const on = it.id === lens;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "rounded-[7px] px-3 py-1 font-semibold transition-colors",
              on ? "bg-surface text-ink shadow-[0_1px_4px_rgba(80,60,20,.1)]" : "text-ink-soft",
            )}
            style={{ fontSize: 12.5 }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
