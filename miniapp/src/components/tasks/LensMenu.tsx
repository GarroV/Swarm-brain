"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import type { Lens } from "@/lib/smartLists";

// Мобильный вариант `LensToggle`: то же состояние (охват + «По рынкам» + «Все сотрудники»),
// но одним чипом вместо трёх ярусов. До 2026-08-22 управление занимало 199px до первой строки
// списка на экране 844px — почти четверть экрана под контролы, которые трогают редко.
// Десктопный `LensToggle` не тронут: там ширина есть, ряд читается целиком.
const SCOPE: { id: Lens; ru: string; en: string }[] = [
  { id: "mine", ru: "Мои", en: "Mine" },
  { id: "team", ru: "Команда", en: "Team" },
  { id: "all", ru: "Все", en: "All" },
];

const W = 232;

export function LensMenu({
  lens, onChangeLens,
  byMarket, onToggleMarket,
  allStaff, onToggleAllStaff, showAllStaff,
}: {
  lens: Lens; onChangeLens: (l: Lens) => void;
  byMarket: boolean; onToggleMarket: () => void;
  allStaff: boolean; onToggleAllStaff: () => void; showAllStaff: boolean;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)), top: r.bottom + 6 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Подпись чипа = что реально показывается. «Все сотрудники» перебивает охват (effLens="staff"
  // в useReminderTasks), поэтому в подписи он старший — иначе чип врал бы «Мои».
  const scope = SCOPE.find((s) => s.id === lens) ?? SCOPE[0];
  const title = allStaff ? dt("Все сотрудники", "All staff") : dt(scope.ru, scope.en);
  const sub = byMarket ? dt("по рынкам", "by market") : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={dt("Чьи задачи и группировка", "Scope and grouping")}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 font-semibold transition-colors",
          byMarket || allStaff ? "border-accent-ink bg-accent-soft text-accent-ink" : "border-line bg-surface-2 text-ink",
        )}
        style={{ fontSize: 12.5, minHeight: 44 }}
      >
        <span className="whitespace-nowrap">{title}</span>
        {sub && <span className="whitespace-nowrap opacity-70">· {sub}</span>}
        <RoyIcon name="cright" size={12} strokeWidth={2.2} className="rotate-90" />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="menu"
          className="fixed z-[60] overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_16px_44px_rgba(0,0,0,.28)] dark:backdrop-blur-lg"
          style={{ left: pos.left, top: pos.top, width: W }}
        >
          <Label>{dt("Чьи задачи", "Whose tasks")}</Label>
          {SCOPE.map((s) => (
            <Row
              key={s.id}
              label={dt(s.ru, s.en)}
              on={!allStaff && lens === s.id}
              muted={allStaff}
              onClick={() => { onChangeLens(s.id); setOpen(false); }}
            />
          ))}
          <Label>{dt("Группировка", "Grouping")}</Label>
          <Row label={dt("По рынкам", "By market")} on={byMarket} onClick={onToggleMarket} />
          {showAllStaff && (
            <>
              <Label>{dt("Админ", "Admin")}</Label>
              <Row label={dt("Все сотрудники", "All staff")} on={allStaff} onClick={onToggleAllStaff} />
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3.5 pt-2.5 pb-1 font-bold uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.07em" }}>
      {children}
    </div>
  );
}

function Row({ label, on, muted, onClick }: { label: string; on: boolean; muted?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 px-3.5 text-left transition-colors active:bg-surface-2",
        muted && "opacity-45",
      )}
      style={{ minHeight: 44, fontSize: 14 }}
    >
      <span className={cn("truncate", on ? "font-semibold text-ink" : "text-ink-soft")}>{label}</span>
      {on && <RoyIcon name="check" size={15} strokeWidth={2.4} className="shrink-0 text-accent-ink" />}
    </button>
  );
}
