"use client";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { RoyIcon, type RoyIconName } from "./icons";

export type SwipeAction = { icon: RoyIconName; label: string; color: string; onClick: () => void };

const ACTION_W = 64; // ширина одной кнопки-действия

// Свайп-строка как в Telegram: тянешь влево — справа открываются действия (карандаш/ведро).
// Тап (без перетаскивания) → onTap. Горизонталь распознаётся, вертикаль отдаётся скроллу.
export function SwipeRow({ children, actions, onTap }: { children: ReactNode; actions: SwipeAction[]; onTap?: () => void }) {
  const width = actions.length * ACTION_W;
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; decided: boolean; horizontal: boolean } | null>(null);

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, decided: false, horizontal: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dX = e.clientX - d.x;
    const dY = e.clientY - d.y;
    if (!d.decided) {
      if (Math.abs(dX) < 6 && Math.abs(dY) < 6) return;
      d.decided = true;
      d.horizontal = Math.abs(dX) > Math.abs(dY);
    }
    if (!d.horizontal) return;
    let next = (open ? -width : 0) + dX;
    next = Math.max(-width, Math.min(0, next));
    setDx(next);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.horizontal) {
      // тап: если открыто — закрыть, иначе действие строки
      if (open) {
        setOpen(false);
        setDx(0);
      } else {
        onTap?.();
      }
      return;
    }
    const shouldOpen = dx < -width / 2;
    setOpen(shouldOpen);
    setDx(shouldOpen ? -width : 0);
  };

  const dragging = drag.current?.horizontal ?? false;

  return (
    <div className="relative overflow-hidden rounded-[18px]">
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-label={a.label}
            onClick={() => {
              setOpen(false);
              setDx(0);
              a.onClick();
            }}
            className="flex items-center justify-center text-white transition-transform active:scale-[0.94]"
            style={{ width: ACTION_W, background: a.color }}
          >
            <RoyIcon name={a.icon} size={22} strokeWidth={1.9} />
          </button>
        ))}
      </div>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform .22s cubic-bezier(.22,1,.36,1)",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
