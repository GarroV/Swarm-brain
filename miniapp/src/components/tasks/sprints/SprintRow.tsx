"use client";
import { useState } from "react";
import { cn, displayName } from "@/lib/utils";
import type { CheckStatus, SprintCycleItem } from "@/types";
import { useDt } from "@/components/roy/nav";
import { AssigneeChip, CarryBadge, CarryFlag, CountChip } from "./atoms";
import { fmtDay, fmtDayShort, isOverdue } from "./format";

// Строка состава спринта — таблицей, в колонках стенда (screens-work.js → sprintTaskRow):
// задача · срок · рынок · сверка · исполнитель. Быстрые действия («✓ выполнено», «→ перенести»)
// живут в хвосте строки и проявляются при наведении: строка спокойная, а ежедневный клик
// по-прежнему один (#407).

/** Колонки — одни на шапку и строки, иначе вертикаль рвётся между группами. */
export const SPRINT_COLS = "minmax(0,1fr) 64px 56px 128px 168px 64px";

const CLOSED = new Set(["done", "cancelled"]);

// Один элемент вместо трёх кнопок: строка и так длинная (#411). Порядок повторяет разговор на
// сверке — сперва «идёт по плану», потом сомнение, потом проблема; четвёртое нажатие снимает.
const NEXT_CHECK: Record<string, CheckStatus | null> = {
  none: "ok",
  ok: "risk",
  risk: "problem",
  problem: null,
};

const STATUS_TONE: Record<string, string> = {
  done: "bg-status-done",
  in_progress: "bg-status-prog",
  cancelled: "bg-ink-mute",
};

const CHECK_TONE: Record<CheckStatus, string> = {
  ok: "border-status-done/40 text-status-done",
  risk: "border-pri-med/50 bg-pri-med/10 text-pri-med",
  problem: "border-pri-high/50 bg-pri-high/10 text-pri-high",
};

export type RowHandlers = {
  onOpen?: (item: SprintCycleItem) => void;
  onDone?: (item: SprintCycleItem) => void | Promise<void>;
  onCarry?: (item: SprintCycleItem) => void | Promise<void>;
  onCheck?: (item: SprintCycleItem, status: CheckStatus | null) => void | Promise<void>;
  /** Причина — отдельным обработчиком: у риска и проблемы это `check_note`, у переноса
   *  `carry_reason`, и строка не должна знать, какое поле куда класть. */
  onNote?: (
    item: SprintCycleItem,
    patch: { check_note?: string | null; carry_reason?: string | null },
  ) => void | Promise<void>;
  /** Рынок живой задачи: в строке состава его нет, он берётся из самой задачи. */
  marketOf?: (item: SprintCycleItem) => string | null;
  /** Родительская задача строки (#478): подзадача встаёт под родителя, если он тоже в составе. */
  parentOf?: (item: SprintCycleItem) => string | null;
};

/**
 * Отметка сверки текстовым чипом. «Не отмечено» — только с дня сверки (D013): до него
 * молчание — норма, и чип стоит тихим прочерком, но нажимается так же.
 */
function CheckChip({ status, note, unchecked }: {
  status: CheckStatus | null;
  note?: string | null;
  unchecked: boolean;
}) {
  const dt = useDt();
  const label = status === "ok"
    ? dt("по плану", "on track")
    : status === "risk"
    ? dt("риск", "at risk")
    : status === "problem"
    ? dt("проблема", "problem")
    : unchecked
    ? dt("не отмечено", "not checked")
    : "—";
  return (
    <span
      title={note ?? undefined}
      className={cn(
        "inline-flex h-[22px] max-w-full items-center gap-1.5 truncate rounded-[6px] border px-2 font-medium",
        status ? CHECK_TONE[status] : "border-transparent text-ink-mute group-hover:border-line",
      )}
      style={{ fontSize: 12 }}
    >
      <span
        className={cn(
          "size-[6px] shrink-0 rounded-full",
          status ? "bg-current" : "border border-dashed border-ink-mute",
        )}
      />
      {label}
      {note ? " ·" : ""}
    </span>
  );
}

/** Строка задачи. Клик открывает карточку — но только у живой: у упоминания и у чужой
 *  приватной открывать нечего, и «кнопка, которая ничего не делает» хуже её отсутствия. */
export function SprintRow({ item, unchecked, showExtra, h, depth = 0 }: {
  item: SprintCycleItem;
  depth?: 0 | 1;
  unchecked: boolean;
  /** Спринт начат: взятое после старта помечаем «сверх плана». */
  showExtra: boolean;
  h: RowHandlers;
}) {
  const dt = useDt();
  const closed = CLOSED.has(item.status);
  const needsNote = item.check_status === "risk" || item.check_status === "problem";
  const noteField: "check_note" | "carry_reason" = needsNote ? "check_note" : "carry_reason";
  const saved = (needsNote ? item.check_note : item.carry_reason) ?? "";
  const [note, setNote] = useState<string | null>(null);
  const noteValue = note ?? saved;
  const live = !item.removed && !item.hidden && !!item.task_id;
  const openable = !!h.onOpen && live;
  const late = !!item.due_date && !closed && isOverdue(item.due_date);
  const market = live ? h.marketOf?.(item) ?? null : null;
  const who = item.assignees[0] ?? null;
  // Клик по кнопке не должен открывать карточку — иначе каждое быстрое действие
  // заканчивается всплывшей модалкой.
  const act = (fn?: (i: SprintCycleItem) => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.(item);
  };
  const quiet = "rounded-[6px] border px-1.5 py-0.5 leading-none transition-colors";

  return (
    <div
      role="row"
      onClick={openable ? () => h.onOpen!(item) : undefined}
      className={cn(
        "group grid items-center border-t border-line first:border-t-0 transition-colors",
        openable && "cursor-pointer hover:bg-surface-2",
      )}
      style={{ gridTemplateColumns: SPRINT_COLS, minHeight: 38, fontSize: 13.5 }}
    >
      <div className="flex min-w-0 items-center gap-2 px-3" style={depth ? { paddingLeft: 34 } : undefined}>
        <span
          className={cn("size-[7px] shrink-0 rounded-full", STATUS_TONE[item.status] ?? "bg-status-open")}
          title={item.status}
        />
        <span
          className={cn(
            "min-w-0 truncate",
            item.removed
              ? "text-ink-mute line-through"
              : item.hidden
              ? "italic text-ink-mute"
              : closed
              ? "text-ink-mute line-through"
              : "text-ink",
          )}
        >
          {item.hidden ? dt("Приватная задача", "Private task") : item.title}
        </span>
        {item.removed && (
          <span className="shrink-0 whitespace-nowrap text-ink-mute" style={{ fontSize: 11 }}>
            {dt("удалена", "deleted")}
            {item.removed_at ? ` ${fmtDay(item.removed_at)}` : ""}
          </span>
        )}
        {live && (
          <span className="flex shrink-0 items-center gap-1.5">
            {showExtra && !item.in_plan && (
              <span
                title={dt("добавлено после старта спринта", "added after the sprint started")}
                className="rounded-[5px] border border-line px-1.5 py-0.5 text-ink-mute"
                style={{ fontSize: 10.5 }}
              >
                {dt("сверх плана", "extra")}
              </span>
            )}
            {item.to_carry && <CarryFlag reason={item.carry_reason} />}
            <CarryBadge count={item.carry_count} reason={item.carry_reason} />
            <CountChip kind="comments" count={item.comment_count} />
            <CountChip kind="links" count={item.link_count} />
          </span>
        )}
      </div>

      <div className={cn("px-2 font-mono", late ? "font-semibold text-pri-high" : "text-ink-soft")} style={{ fontSize: 12 }}>
        {item.due_date ? fmtDayShort(item.due_date) : <span className="text-ink-mute">—</span>}
      </div>

      <div className="px-2 font-mono text-ink-soft" style={{ fontSize: 12 }}>
        {market ?? <span className="text-ink-mute">—</span>}
      </div>

      <div className="min-w-0 px-2">
        {live && h.onCheck && !closed
          ? (
            <button
              type="button"
              onClick={act((i) => h.onCheck!(i, NEXT_CHECK[i.check_status ?? "none"]))}
              title={dt(
                "Как идут дела: по плану → риск → проблема",
                "How it is going: on track → at risk → problem",
              )}
              className="max-w-full rounded-[6px] transition-opacity hover:opacity-80"
            >
              <CheckChip status={item.check_status} note={item.check_note} unchecked={unchecked} />
            </button>
          )
          : live
          ? <CheckChip status={item.check_status} note={item.check_note} unchecked={unchecked && !closed} />
          : null}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 px-2 text-ink-soft">
        {live && (
          <>
            {who ? <AssigneeChip name={who} /> : null}
            <span className="min-w-0 truncate">
              {who ? displayName(who) : <span className="text-ink-mute">—</span>}
            </span>
            {item.assignees.length > 1 && (
              <span className="shrink-0 font-mono text-ink-mute" style={{ fontSize: 11 }} title={item.assignees.join(", ")}>
                +{item.assignees.length - 1}
              </span>
            )}
          </>
        )}
      </div>

      {/* Хвост строки: быстрые действия. На компьютере — по наведению, на телефоне видны всегда. */}
      <div className="flex items-center justify-end gap-1 pr-3 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100" style={{ fontSize: 11 }}>
        {live && h.onDone && (
          <button
            type="button"
            onClick={act(h.onDone)}
            title={closed ? dt("Вернуть в работу", "Reopen") : dt("Выполнено", "Done")}
            className={cn(
              quiet,
              closed
                ? "border-status-done/50 bg-status-done/15 text-status-done"
                : "border-line bg-surface text-ink-soft hover:text-ink",
            )}
          >
            ✓
          </button>
        )}
        {live && h.onCarry && !closed && (
          <button
            type="button"
            onClick={act(h.onCarry)}
            title={item.to_carry
              ? dt("Снять пометку переноса", "Remove the carry mark")
              : dt("Перенести в следующий спринт", "Carry to the next sprint")}
            className={cn(
              quiet,
              item.to_carry
                ? "border-pri-med/50 bg-pri-med/15 text-pri-med"
                : "border-line bg-surface text-ink-soft hover:text-ink",
            )}
          >
            →
          </button>
        )}
      </div>

      {/* Причину спрашиваем там же, где поставили отметку: «риск» без причины к следующей
          встрече уже никто не помнит. Поле необязательное — принуждение даёт «нет времени»
          вместо объяснения. */}
      {h.onNote && !closed && live && (needsNote || item.to_carry) && (
        <div className="col-span-full px-3 pb-2 pl-[27px]">
          <input
            value={noteValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              const v = noteValue.trim();
              setNote(null);
              if (v === saved.trim()) return;
              h.onNote!(item, { [noteField]: v || null });
            }}
            placeholder={needsNote
              ? dt("что именно мешает (необязательно)", "what exactly is blocking (optional)")
              : dt("почему переносится (необязательно)", "why it is carried over (optional)")}
            className="w-full rounded-[6px] border border-line bg-surface px-2 py-1 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}
