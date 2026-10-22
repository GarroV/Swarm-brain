"use client";
import type { DragEvent, ReactNode } from "react";
import type { CheckStatus } from "@/types";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { AssigneeChip } from "../atoms";
import { fmtDayShort, isOverdue } from "../format";
import type { CardDnd } from "./boardCtx";

// Карточка задачи на доске спринтов (макет v3.1): слева кружок «готово», название ЦЕЛИКОМ (с
// переносом строк — владелец путает обрезанные названия), справа «⋯»; под названием — срок,
// метки и исполнитель. Кружок и «⋯» видны всегда, без наведения.

const STRIPE: Record<CheckStatus, string> = {
  ok: "",
  risk: "shadow-[inset_3px_0_0_var(--pri-med)]",
  problem: "shadow-[inset_3px_0_0_var(--pri-high)]",
};

export type CardDrag = {
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
};

export function BoardCard({
  title,
  closed,
  mark,
  due,
  tags,
  assignee,
  moreAssignees = 0,
  onToggleDone,
  onOpen,
  menu,
  drag,
  nested = false,
  dnd,
  parentNote,
  subtasks,
  plan,
}: {
  title: string;
  closed: boolean;
  /** Отметка сверки: риск и проблема красят полоску слева. */
  mark?: CheckStatus | null;
  /** Срок, `YYYY-MM-DD`; красный, если просрочен у незакрытой. `flag` — спринт срока (🏁). */
  due?: { date: string; flag?: boolean } | null;
  tags?: ReactNode;
  /** Первый исполнитель; без него кружка нет (без исполнителя карточка не занимает лишней строки). */
  assignee?: string | null;
  moreAssignees?: number;
  onToggleDone?: () => void;
  onOpen?: () => void;
  menu?: ReactNode;
  drag?: CardDrag;
  /** Подзадача: ступенью правее. */
  nested?: boolean;
  /** Карточка как цель броска: рамка и силуэт будущей подзадачи. */
  dnd?: CardDnd;
  /** Подзадача, чей родитель не в этой колонке: «↳ из «Родитель»», клик открывает родителя. */
  parentNote?: { title: string; onOpen: () => void };
  /** «подзадачи N из M»: сделано из всех. */
  subtasks?: { done: number; total: number };
  /** Мастер-план: строка «С4 → С6 · 🏁 01.12» вместо полоски (решение 22.10.2026, п.14). */
  plan?: ReactNode;
}) {
  const dt = useDt();
  const late = !!due && !closed && isOverdue(due.date);
  return (
    <div {...dnd?.handlers}>
      <div
        draggable={!!drag}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
        className={cn(
          "relative grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-1.5 gap-y-1 rounded-[9px] border border-line bg-surface px-2 py-2",
          drag && "lg:cursor-grab",
          drag?.dragging && "opacity-40",
          mark && STRIPE[mark],
          nested && "ml-4",
          dnd?.state === "group" && "ring-2 ring-primary/50",
          dnd?.state === "sub" && "ring-2 ring-status-done",
          dnd?.state === "block" && "ring-2 ring-pri-high",
        )}
      >
        {onToggleDone
          ? (
            <button
              type="button"
              onClick={onToggleDone}
              aria-label={closed
                ? dt("Вернуть в работу", "Reopen")
                : dt("Выполнено", "Mark done")}
              aria-pressed={closed}
              className="grid h-[22px] w-[22px] place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span
                className={cn(
                  "grid h-4 w-4 place-items-center rounded-full border-[1.6px] text-[10px] leading-none text-white transition-colors",
                  closed
                    ? "border-status-done bg-status-done"
                    : "border-line-2 bg-surface hover:border-status-done",
                )}
              >
                {closed ? "✓" : ""}
              </span>
            </button>
          )
          : <span />}
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className={cn(
            "min-w-0 whitespace-normal break-words pt-px text-left leading-snug text-ink enabled:hover:underline enabled:hover:decoration-line-2 enabled:hover:underline-offset-2",
            closed && "text-ink-mute line-through",
          )}
          style={{ fontSize: 13.5 }}
        >
          {title}
        </button>
        <span className="flex items-center">{menu}</span>
        {parentNote && (
          <button
            type="button"
            onClick={parentNote.onOpen}
            className="col-span-2 col-start-2 -mt-0.5 truncate text-left text-ink-mute hover:text-ink hover:underline"
            style={{ fontSize: 11.5 }}
            title={parentNote.title}
          >
            ↳ {dt("из", "from")} «{parentNote.title}»
          </button>
        )}
        {plan}
        <div
          className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-mute empty:hidden"
          style={{ fontSize: 11.5 }}
        >
          {due && (
            <span
              className={cn(
                "whitespace-nowrap tabular-nums",
                late && "font-semibold text-pri-high",
              )}
            >
              {due.flag ? "🏁 " : ""}
              {late ? dt("срок", "due") + " " : ""}
              {fmtDayShort(due.date)}
            </span>
          )}
          {subtasks && subtasks.total > 0 && (
            <span className="whitespace-nowrap">
              {dt(
                `подзадачи ${subtasks.done} из ${subtasks.total}`,
                `subtasks ${subtasks.done} of ${subtasks.total}`,
              )}
            </span>
          )}
          {tags}
          {assignee && (
            <span className="ml-auto flex items-center gap-1">
              <AssigneeChip name={assignee} size={20} />
              {moreAssignees > 0 && (
                <span className="font-mono text-[10.5px]">
                  +{moreAssignees}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {dnd?.state === "sub" && dnd.silhouette && (
        <div
          className="ml-4 mt-1.5 truncate rounded-[9px] border border-dashed border-status-done/70 bg-status-done/10 px-2 py-1.5 text-ink-soft"
          style={{ fontSize: 12.5 }}
          aria-hidden="true"
        >
          ↳ {dnd.silhouette}
        </div>
      )}
    </div>
  );
}

/** Метка карточки: нейтральная, «внимание» (жёлтая) или «беда» (красная), «ведём» (акцентная). */
export function Tag({ children, tone = "neutral", title }: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "bad" | "span";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "whitespace-nowrap rounded-[5px] border px-1.5",
        tone === "neutral" && "border-line bg-surface-2 text-ink-soft",
        tone === "warn" && "border-pri-med/40 bg-pri-med/10 text-pri-med",
        tone === "bad" && "border-pri-high/40 bg-pri-high/10 text-pri-high",
        tone === "span" &&
          "border-accent-line bg-accent-soft font-semibold text-accent-ink",
      )}
    >
      {children}
    </span>
  );
}
