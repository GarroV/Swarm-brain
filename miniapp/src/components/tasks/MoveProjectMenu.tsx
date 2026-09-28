"use client";

import { useEffect, useRef, useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import type { Sprint } from "@/types";

/**
 * Перенос проекта в другое пространство доски (issue #426, просьба владельца 21.09.2026).
 *
 * Отдельным файлом, а не строчкой в SprintBoard: доска и так под 630 строк, а сюда ещё придёт
 * журнал проекта. Компонент ничего не знает про API — он только спрашивает «куда» и отдаёт id
 * наверх; перенос подпроектов вслед за родителем делает сервер.
 */
export function MoveProjectMenu({ spaces, currentId, onMove, disabled }: {
  spaces: Sprint[];
  currentId: string | null;
  onMove: (spaceId: string | null) => void;
  disabled?: boolean;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Клик мимо закрывает меню. Без этого оно остаётся висеть поверх доски, и человек второй раз
  // жмёт «перенести» уже по невидимому списку.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const others = spaces.filter((s) => s.id !== currentId);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="rounded-full p-1 text-ink-soft hover:bg-surface-2 disabled:opacity-40"
        title={dt("Перенести в другое пространство", "Move to another space")}
      >
        <RoyIcon name="arrow" size={13} />
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-30 min-w-44 rounded-xl border border-line bg-card p-1 shadow-lg">
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-ink-soft">
            {dt("Перенести в", "Move to")}
          </div>
          {others.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-ink-soft">
              {dt("Других пространств нет", "No other spaces")}
            </div>
          )}
          {others.map((s) => (
            <button
              key={s.id}
              onClick={() => { setOpen(false); onMove(s.id); }}
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-2"
            >
              {s.name}
            </button>
          ))}
          {currentId !== null && (
            <button
              onClick={() => { setOpen(false); onMove(null); }}
              className="mt-0.5 block w-full rounded-lg border-t border-line px-2 py-1.5 text-left text-xs text-ink-soft hover:bg-surface-2"
            >
              {dt("Без пространства", "No space")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
