"use client";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CheckStatus, SprintCycle, SprintCycleItem } from "@/types";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { isClosedStatus } from "./boardModel";

// Меню «⋯» одной задачи на доске спринтов (спека, «Меню "⋯"»): одно на всё — сверка, перенос,
// взять в спринт, убрать, открыть карточку. Кнопка видна всегда (владелец: действия без
// наведения), меню — порталом в body: колонка доски прокручивается и обрезает всё, что в ней.
//
// «Спринты задачи…» и «Ход задачи» — этап 4 плана; пункты заведены, но скрыты флагом.
export const TASK_SPANS_ENABLED = false;

export type TaskMenuActions = {
  open: () => void;
  /** Сверка: статус или null — снять отметку. */
  check: (status: CheckStatus | null) => void;
  /** Перенести из идущего спринта в запланированный — с причиной (открывает окно). */
  move: (target: SprintCycle) => void;
  /** Переставить между запланированными — без причины, это планирование, а не срыв. */
  shift: (target: SprintCycle) => void;
  /** Взять из мастер-плана в спринт. */
  take: (target: SprintCycle) => void;
  remove: () => void;
};

type Entry =
  | {
    kind: "item";
    key: string;
    label: ReactNode;
    onPick: () => void;
    on?: boolean;
    danger?: boolean;
  }
  | { kind: "heading"; key: string; label: string }
  | { kind: "sep"; key: string };

const POP_W = 244;
const EDGE = 8;

export function TaskMenu(
  { title, taskStatus, item, cycle, cycles, taskCycleIds, actions }: {
    /** Название задачи — в подписи кнопки для экранного диктора. */
    title: string;
    /** Закрытую задачу не переносят и не берут в спринт. */
    taskStatus: string;
    /** Строка в спринте, если меню открыли на карточке спринта; у задачи мастер-плана её нет. */
    item?: SprintCycleItem;
    /** Спринт, в котором лежит строка. */
    cycle?: SprintCycle;
    /** Все спринты пространства. */
    cycles: readonly SprintCycle[];
    /** Спринты, где задача уже живёт: туда её «брать» не нужно. */
    taskCycleIds: readonly string[];
    actions: TaskMenuActions;
  },
) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<
    { left: number; top: number; maxH: number } | null
  >(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const t = btn.current?.getBoundingClientRect();
    const p = pop.current?.getBoundingClientRect();
    if (!t || !p) return;
    const below = innerHeight - t.bottom - EDGE;
    const above = t.top - EDGE;
    const up = p.height > below && above > below;
    const maxH = Math.max(160, up ? above : below);
    const height = Math.min(p.height, maxH);
    setPos({
      left: Math.max(
        EDGE,
        Math.min(t.right - POP_W, innerWidth - POP_W - EDGE),
      ),
      top: up ? t.top - height - 4 : t.bottom + 4,
      maxH,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!pop.current?.contains(n) && !btn.current?.contains(n)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    globalThis.addEventListener("keydown", onKey);
    globalThis.addEventListener("resize", close);
    globalThis.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("resize", close);
      globalThis.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const live = !!item && !item.moved && !item.removed;
  const status = cycle?.status;
  const closed = isClosedStatus(taskStatus);
  const planned = cycles.filter((c) => c.status === "draft").sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );
  const entries: Entry[] = [];
  const add = (e: Entry) => entries.push(e);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  if (TASK_SPANS_ENABLED) {
    add({
      kind: "item",
      key: "spans",
      label: dt("Спринты задачи…", "Sprints of the task…"),
      onPick: pick(() => {}),
    });
    add({
      kind: "item",
      key: "course",
      label: dt("Ход задачи по спринтам", "Task progress by sprint"),
      onPick: pick(() => {}),
    });
    add({ kind: "sep", key: "s0" });
  }

  if (live && (status === "active" || status === "draft")) {
    add({ kind: "heading", key: "h-check", label: dt("Сверка", "Check-in") });
    const marks: [CheckStatus, string][] = [
      ["ok", dt("По плану", "On track")],
      ["risk", dt("Риск", "At risk")],
      ["problem", dt("Проблема", "Problem")],
    ];
    for (const [s, label] of marks) {
      add({
        kind: "item",
        key: `c-${s}`,
        label,
        on: item!.check_status === s,
        onPick: pick(() => actions.check(s)),
      });
    }
    if (item!.check_status) {
      add({
        kind: "item",
        key: "c-none",
        label: dt("Снять отметку", "Clear the mark"),
        onPick: pick(() => actions.check(null)),
      });
    }
    add({ kind: "sep", key: "s1" });
  }

  if (live && status === "active" && !closed) {
    for (const c of planned) {
      add({
        kind: "item",
        key: `m-${c.id}`,
        label: dt(`Перенести в ${c.name}…`, `Move to ${c.name}…`),
        onPick: pick(() => actions.move(c)),
      });
    }
  }
  if (live && status === "draft") {
    for (const c of planned.filter((x) => x.id !== cycle?.id)) {
      add({
        kind: "item",
        key: `s-${c.id}`,
        label: dt(`Переставить в ${c.name}`, `Shift to ${c.name}`),
        onPick: pick(() => actions.shift(c)),
      });
    }
  }
  if (!item && !closed) {
    const targets = cycles.filter((c) =>
      c.status !== "accepted" && !taskCycleIds.includes(c.id)
    );
    for (const c of targets) {
      add({
        kind: "item",
        key: `t-${c.id}`,
        label: dt(`Взять в ${c.name}`, `Take into ${c.name}`),
        onPick: pick(() => actions.take(c)),
      });
    }
  }
  if (live && (status === "active" || status === "draft")) {
    add({
      kind: "item",
      key: "rm",
      danger: true,
      label: dt("Убрать из спринта", "Remove from the sprint"),
      onPick: pick(actions.remove),
    });
  }
  if (entries.length > 0 && entries.at(-1)!.kind !== "sep") {
    add({ kind: "sep", key: "s2" });
  }
  add({
    kind: "item",
    key: "open",
    label: dt("Открыть карточку", "Open the card"),
    onPick: pick(actions.open),
  });

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${dt("Действия", "Actions")}: ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[15px] leading-none text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-lg:h-8 max-lg:w-8",
          open && "bg-surface-2 text-ink",
        )}
      >
        ⋯
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={pop}
          role="menu"
          className={cn(
            "fixed z-[90] flex flex-col overflow-y-auto rounded-[10px] border border-line bg-[var(--popover)] p-1 shadow-[0_14px_36px_-12px_rgba(0,0,0,.35)]",
            !pos && "invisible",
          )}
          style={{
            width: POP_W,
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            maxHeight: pos?.maxH,
          }}
        >
          {entries.map((e) =>
            e.kind === "sep"
              ? <div key={e.key} className="my-1 h-px bg-line" />
              : e.kind === "heading"
              ? (
                <div
                  key={e.key}
                  className="px-2.5 pb-0.5 pt-1.5 font-semibold uppercase tracking-[0.05em] text-ink-mute"
                  style={{ fontSize: 10.5 }}
                >
                  {e.label}
                </div>
              )
              : (
                <button
                  key={e.key}
                  type="button"
                  role="menuitem"
                  onClick={e.onPick}
                  className={cn(
                    "rounded-[6px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 max-lg:py-2.5",
                    e.on
                      ? "font-semibold text-accent-ink"
                      : e.danger
                      ? "text-pri-high"
                      : "text-ink",
                  )}
                  style={{ fontSize: 13 }}
                >
                  {e.on ? "✓ " : ""}
                  {e.label}
                </button>
              )
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
