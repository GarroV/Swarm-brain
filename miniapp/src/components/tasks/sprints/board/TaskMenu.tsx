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

// Меню «⋯» одной задачи на доске спринтов и в «Списке» (спека, «Меню "⋯"»; владелец 22.10.2026:
// «сделай его нормальным, но не надо вот это вот рисовать»). Короткое и одинаковое везде: ни
// одного пункта на каждый спринт — выбор спринта делает компактное окно, а не меню. Показывается
// только применимое. Кнопка видна всегда (действия без наведения), меню — порталом в body: колонка
// доски прокручивается и обрезает всё, что в ней.

export type TaskMenuActions = {
  open: () => void;
  /** Сверка: статус или null — снять отметку. */
  check: (status: CheckStatus | null) => void;
  /** «Перенести…» из идущего спринта — окно с выбором спринта и обязательной причиной. */
  move: () => void;
  /** «Взять в спринт…» (из мастер-плана) и «Переставить…» (между запланированными) — без причины. */
  place: (kind: "take" | "shift") => void;
  /** «Спринты задачи…» — план работы на несколько спринтов. */
  span: () => void;
  /** «Ход задачи» — путь задачи по спринтам. */
  journey: () => void;
  remove: () => void;
  /** «Сгруппировать с… / Сделать подзадачей…» — есть там, где работает группировка. */
  group?: () => void;
  /** «Отвязать от «…»» — только у подзадачи. */
  unlink?: { parentTitle: string; run: () => void };
};

type Entry =
  | {
    kind: "item";
    key: string;
    label: ReactNode;
    onPick: () => void;
    danger?: boolean;
  }
  | { kind: "check"; key: string }
  | { kind: "sep"; key: string };

const POP_W = 244;
const CHECK_MARKS: [CheckStatus, string, string][] = [
  ["ok", "По плану", "On track"],
  ["risk", "Риск", "Risk"],
  ["problem", "Проблема", "Problem"],
];
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
  const inOpenCycle = cycles.some((c) =>
    c.status !== "accepted" && taskCycleIds.includes(c.id)
  );
  const otherDrafts =
    cycles.filter((c) => c.status === "draft" && c.id !== cycle?.id).length;
  const entries: Entry[] = [];
  const add = (e: Entry) => entries.push(e);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const row = (key: string, label: ReactNode, fn: () => void, danger = false) =>
    add({ kind: "item", key, label, onPick: pick(fn), danger });

  if (live && status === "active" && !closed) {
    row("move", dt("Перенести…", "Move…"), actions.move);
  }
  if (!item && !closed && !inOpenCycle) {
    row(
      "take",
      dt("Взять в спринт…", "Take into a sprint…"),
      () => actions.place("take"),
    );
  }
  if (live && status === "draft" && !closed && otherDrafts > 0) {
    row("shift", dt("Переставить…", "Shift…"), () => actions.place("shift"));
  }
  if (!closed) {
    row("span", dt("Спринты задачи…", "Sprints of the task…"), actions.span);
  }
  row("journey", dt("Ход задачи", "Task journey"), actions.journey);
  if (live && status === "active") add({ kind: "check", key: "check" });

  const tail: Entry[] = [];
  const tailRow = (key: string, label: ReactNode, fn: () => void) =>
    tail.push({ kind: "item", key, label, onPick: pick(fn) });
  if (actions.group) {
    tailRow(
      "group",
      dt("Группа или подзадача…", "Group or subtask…"),
      actions.group,
    );
  }
  if (actions.unlink) {
    tailRow(
      "unlink",
      dt(
        `Отвязать от «${actions.unlink.parentTitle}»`,
        `Unlink from “${actions.unlink.parentTitle}”`,
      ),
      actions.unlink.run,
    );
  }
  tailRow("open", dt("Открыть карточку", "Open the card"), actions.open);
  add({ kind: "sep", key: "s-tail" });
  for (const e of tail) add(e);
  if (live && (status === "active" || status === "draft")) {
    row(
      "rm",
      dt("Убрать из спринта", "Remove from the sprint"),
      actions.remove,
      true,
    );
  }

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
              : e.kind === "check"
              ? (
                <div
                  key={e.key}
                  role="group"
                  aria-label={dt("Сверка", "Check-in")}
                  className="m-1 grid grid-cols-3 gap-0.5 rounded-[7px] bg-surface-2 p-0.5"
                >
                  {CHECK_MARKS.map(([s, ru, en]) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={item?.check_status === s}
                      onClick={pick(() =>
                        actions.check(item?.check_status === s ? null : s)
                      )}
                      className={cn(
                        "whitespace-nowrap rounded-[5px] px-1 py-1 text-center transition-colors max-lg:py-2",
                        item?.check_status === s
                          ? s === "problem"
                            ? "bg-pri-high/15 font-semibold text-pri-high"
                            : s === "risk"
                            ? "bg-pri-med/15 font-semibold text-pri-med"
                            : "bg-status-done/15 font-semibold text-status-done"
                          : "text-ink-soft hover:bg-surface hover:text-ink",
                      )}
                      style={{ fontSize: 12 }}
                    >
                      {dt(ru, en)}
                    </button>
                  ))}
                </div>
              )
              : (
                <button
                  key={e.key}
                  type="button"
                  role="menuitem"
                  onClick={e.onPick}
                  className={cn(
                    "truncate whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 max-lg:py-2.5",
                    e.danger ? "text-pri-high" : "text-ink",
                  )}
                  style={{ fontSize: 13 }}
                >
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
