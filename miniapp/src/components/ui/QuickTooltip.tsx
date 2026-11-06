"use client";
import { cloneElement, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";

type Group = { active: string | null; setActive: Dispatch<SetStateAction<string | null>> };
const TooltipContext = createContext<Group | null>(null);
const DELAY_MS = 150;
const EDGE = 8;

/** At most one tooltip in the toolbar, even when focus and pointer differ. */
export function QuickTooltipGroup({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <TooltipContext.Provider value={{ active, setActive }}>{children}</TooltipContext.Provider>;
}

/** A short hint on pointer hover or keyboard focus, positioned outside clipping containers. */
export function QuickTooltip({ label, children, disabled }: {
  label: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
  disabled?: boolean;
}) {
  const id = useId();
  const group = useContext(TooltipContext);
  const [solo, setSolo] = useState(false);
  const open = group ? group.active === id : solo;
  const trigger = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const hovered = useRef(false);
  const pointerFocus = useRef(false);
  const [place, setPlace] = useState({ left: 0, top: 0 });

  const clear = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };
  const show = () => {
    clear();
    if (disabled) return;
    if (group) group.setActive(id);
    else setSolo(true);
  };
  const hide = () => {
    clear();
    if (group) group.setActive((current) => current === id ? null : current);
    else setSolo(false);
  };
  const leave = () => {
    hovered.current = false;
    pointerFocus.current = false;
    clear();
    if (!focused.current) hideTimer.current = setTimeout(hide, 100);
  };

  useEffect(() => {
    if (group?.active && group.active !== id) clear();
  }, [group?.active, id]);
  useEffect(() => () => clear(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = trigger.current?.getBoundingClientRect();
      const box = tip.current?.getBoundingClientRect();
      if (!button || !box) return;
      const left = Math.max(EDGE, Math.min(button.left + (button.width - box.width) / 2, innerWidth - box.width - EDGE));
      const top = button.bottom + EDGE + box.height <= innerHeight - EDGE
        ? button.bottom + EDGE
        : Math.max(EDGE, button.top - box.height - EDGE);
      setPlace({ left, top });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, label]);

  return (
    <span ref={trigger} className="inline-flex"
      onPointerEnter={(event) => {
        if (event.pointerType === "touch" || disabled) return;
        hovered.current = true;
        clear();
        showTimer.current = setTimeout(show, DELAY_MS);
      }}
      onPointerLeave={leave}
      onFocus={() => { focused.current = true; if (!pointerFocus.current) show(); }}
      onBlur={() => { focused.current = false; if (!hovered.current) hide(); }}
      onPointerDown={() => { pointerFocus.current = true; hide(); }}
      onClickCapture={() => { pointerFocus.current = false; hide(); }}
      onKeyDown={(event) => { if (event.key === "Escape") hide(); }}
    >
      {cloneElement(children, { "aria-describedby": open ? [children.props["aria-describedby"], id].filter(Boolean).join(" ") : children.props["aria-describedby"] })}
      {open && createPortal(
        <div ref={tip} id={id} role="tooltip"
          onPointerEnter={() => { hovered.current = true; clear(); }} onPointerLeave={leave}
          className="fixed z-[90] w-max rounded-[6px] border border-line-2 bg-[var(--popover)] px-2.5 py-1.5 text-ink shadow-lg"
          style={{ ...place, maxWidth: "min(280px, calc(100vw - 16px))", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.35 }}
        >{label}</div>, document.body,
      )}
    </span>
  );
}
