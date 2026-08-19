"use client";
import { cn } from "@/lib/utils";
import type { Lens } from "@/lib/smartLists";

const SCOPE_ITEMS: { id: Lens; label: string }[] = [
  { id: "mine", label: "Мои" },
  { id: "team", label: "Команда" },
  { id: "all", label: "Все" },
];

// Переключатель вида: 3-позиционный охват (Мои/Команда/Все, взаимоисключающий) + два независимых
// тумблера-модификатора («По рынкам», «Все сотрудники» — только админу). Тумблеры группируют
// ТЕКУЩИЙ охват, а не подменяют его (владелец 2026-08-19: «тумблер сортировки "по рынкам" не
// должен зависеть от того, в каком разделе сейчас юзер» — раньше «По рынкам» был 4-й позицией
// в том же взаимоисключающем ряду и всегда показывал задачи ВСЕХ владельцев). Когда включён
// «Все сотрудники», охват Мои/Команда/Все визуально гасится — он всё равно переопределён на
// «все» (см. effLens в useReminderTasks), не даём это выглядеть как рабочий выбор.
export function LensToggle({
  lens, onChangeLens,
  byMarket, onToggleMarket,
  allStaff, onToggleAllStaff, showAllStaff,
}: {
  lens: Lens; onChangeLens: (l: Lens) => void;
  byMarket: boolean; onToggleMarket: () => void;
  allStaff: boolean; onToggleAllStaff: () => void; showAllStaff: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className={cn("inline-flex shrink-0 gap-[3px] rounded-[10px] border border-line bg-surface-2 p-[3px] transition-opacity", allStaff && "pointer-events-none opacity-40")}>
        {SCOPE_ITEMS.map((it) => {
          const on = it.id === lens;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChangeLens(it.id)}
              disabled={allStaff}
              className={cn(
                "whitespace-nowrap rounded-[7px] px-3 py-1 font-semibold transition-colors",
                on ? "bg-surface text-ink shadow-[0_1px_4px_rgba(80,60,20,.1)]" : "text-ink-soft",
              )}
              style={{ fontSize: 12.5 }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      <ToggleChip on={byMarket} onClick={onToggleMarket} label="По рынкам" />
      {showAllStaff && <ToggleChip on={allStaff} onClick={onToggleAllStaff} label="Все сотрудники" />}
    </div>
  );
}

function ToggleChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-[10px] border px-3 py-[7px] font-semibold transition-colors",
        on ? "border-accent-ink bg-accent-soft text-accent-ink" : "border-line bg-surface-2 text-ink-soft hover:bg-surface",
      )}
      style={{ fontSize: 12.5 }}
    >
      {label}
    </button>
  );
}
