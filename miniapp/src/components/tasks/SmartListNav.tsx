"use client";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";
import { SMART_LISTS, type SmartListId } from "@/lib/smartLists";

type SmartListNavProps = {
  variant: "rail" | "chips";
  active: SmartListId;
  counts: Record<SmartListId, number>;
  onSelect: (id: SmartListId) => void;
  /** Только rail: локальный поиск по заголовку. */
  query?: string;
  onQuery?: (q: string) => void;
};

// Навигация по смарт-спискам: вертикальный рельс (десктоп) или горизонтальные чипы (мобайл).
export function SmartListNav({ variant, active, counts, onSelect, query, onQuery }: SmartListNavProps) {
  if (variant === "chips") {
    return (
      <div className="flex gap-1.5 overflow-x-auto px-5 pb-3">
        {SMART_LISTS.map(({ id, label, icon }) => {
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold transition-colors",
                on ? "bg-primary text-white" : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
              )}
              style={{ fontSize: 12.5 }}
            >
              <RoyIcon name={icon} size={13} strokeWidth={2} />
              {label}
              {counts[id] > 0 && (
                <span className={on ? "text-white/80" : "text-ink-mute"} style={{ fontSize: 11 }}>
                  {counts[id]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-line px-3 py-4">
      {onQuery && (
        <label className="mb-2 flex items-center gap-2 rounded-[10px] border border-line-2 bg-surface px-2.5 py-1.5 text-ink-soft">
          <RoyIcon name="search" size={14} />
          <input
            value={query ?? ""}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск"
            className="w-full bg-transparent outline-none placeholder:text-ink-mute"
            style={{ fontSize: 13 }}
          />
        </label>
      )}
      {SMART_LISTS.map(({ id, label, icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors",
              on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface",
            )}
            style={{ fontSize: 13.5 }}
          >
            <RoyIcon name={icon} size={16} strokeWidth={on ? 2.1 : 1.8} />
            <span className="flex-1 text-left">{label}</span>
            {counts[id] > 0 && (
              <span className={on ? "text-accent-ink" : "text-ink-mute"} style={{ fontSize: 11.5 }}>
                {counts[id]}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}
