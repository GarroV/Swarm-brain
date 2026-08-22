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
  // Тап определяет БРАУЗЕР (событие click), а не мы по pointerup. Причина: при вертикальном
  // скролле списка браузер забирает жест себе (touch-action: pan-y) и присылает pointercancel —
  // часто ДО первого pointermove, поэтому «не горизонтально» ≠ «тап». Раньше onUp считал тапом
  // любой не-горизонтальный жест, и каждый скролл по строке открывал задачу. Браузер после
  // скролла click не шлёт — значит ложных открытий нет. Остаётся погасить click после
  // ГОРИЗОНТАЛЬНОГО свайпа (скролла не было → click придёт).
  const swallowClick = useRef(false);

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, decided: false, horizontal: false };
    // Новый жест — снимаем возможный «недоеденный» флаг (свайп, после которого click не пришёл:
    // палец ушёл за пределы строки, жест отменён). Иначе он съел бы следующий честный тап.
    swallowClick.current = false;
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
  // Конец жеста. Горизонтальный — доводим шторку до края и гасим следующий click
  // (он придёт, т.к. скролла не было). Вертикальный/нулевой — ничего: тап обработает onClick.
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.horizontal) return;
    swallowClick.current = true;
    const shouldOpen = dx < -width / 2;
    setOpen(shouldOpen);
    setDx(shouldOpen ? -width : 0);
  };

  const onClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // Шторка открыта — тап по строке её закрывает (как в Telegram), а не открывает карточку.
    if (open) {
      setOpen(false);
      setDx(0);
      return;
    }
    onTap?.();
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
        onClick={onClick}
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
