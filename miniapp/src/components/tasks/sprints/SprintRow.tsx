"use client";
import { useState } from "react";
import { cn, displayName } from "@/lib/utils";
import type { CheckStatus, SprintCycleItem, Task } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { AssigneeChip, CarryBadge, CarryFlag, CountChip } from "./atoms";
import { fmtDay, fmtDayShort, isOverdue } from "./format";
import type { SubtaskBlock } from "@/lib/sprintGrouping";
import { blockText } from "./groupingText";

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
  onCheck?: (
    item: SprintCycleItem,
    status: CheckStatus | null,
  ) => void | Promise<void>;
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
  /** Открыть живую задачу по id — подзадачу вне строк группы и родителя из подписи «из «…»». */
  onOpenTask?: (taskId: string) => void;
};

/** Строка в перетаскивании (группы спринта, 01.10.2026): ручка, цель и что покажет бросок. */
export type RowDnd = {
  /** data-атрибут цели и начало жеста — из useRowDrag. */
  bind: {
    "data-sg-task": string;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  };
  state:
    | null
    /** Эту строку тащат. */
    | { kind: "source" }
    /** Над строкой, бросок соберёт группу. */
    | { kind: "group"; join: string | null }
    /** Подержали над строкой: бросок сделает тащимую подзадачей (или объяснит, почему нет). */
    | { kind: "subtask"; title: string; block: SubtaskBlock | null };
  /** Запасной путь без жеста: окно «Сгруппировать с… / Сделать подзадачей…». */
  onMenu?: () => void;
};

/** Подзадачи строки (#478): шеврон разворота и «X/Y». */
export type RowKids = {
  done: number;
  total: number;
  open: boolean;
  onToggle: () => void;
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
        status
          ? CHECK_TONE[status]
          : "border-transparent text-ink-mute group-hover:border-line",
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
export function SprintRow(
  { item, unchecked, showExtra, h, depth = 0, kids, parent, dnd }: {
    item: SprintCycleItem;
    dnd?: RowDnd;
    depth?: 0 | 1;
    kids?: RowKids;
    /** Родитель вне этой группы — подпись «из «…»», кликом открывает родителя. */
    parent?: { id: string; title: string };
    unchecked: boolean;
    /** Спринт начат: взятое после старта помечаем «сверх плана». */
    showExtra: boolean;
    h: RowHandlers;
  },
) {
  const dt = useDt();
  const closed = CLOSED.has(item.status);
  const needsNote = item.check_status === "risk" ||
    item.check_status === "problem";
  const noteField: "check_note" | "carry_reason" = needsNote
    ? "check_note"
    : "carry_reason";
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
  const act =
    (fn?: (i: SprintCycleItem) => void | Promise<void>) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      fn?.(item);
    };
  const quiet =
    "rounded-[6px] border px-1.5 py-0.5 leading-none transition-colors";

  const drag = dnd?.state ?? null;

  return (
    <div
      role="row"
      {...dnd?.bind}
      onClick={openable ? () => h.onOpen!(item) : undefined}
      className={cn(
        "group relative grid items-center border-t border-line first:border-t-0 transition-colors",
        openable && "cursor-pointer hover:bg-surface-2",
        // Долгое нажатие на таче не должно выделять текст и звать системное меню.
        dnd && "select-none [-webkit-touch-callout:none]",
        drag?.kind === "source" && "opacity-45",
        drag?.kind === "group" &&
          "bg-primary/8 outline outline-2 -outline-offset-2 outline-primary/70",
      )}
      style={{
        gridTemplateColumns: SPRINT_COLS,
        minHeight: 38,
        fontSize: 13.5,
      }}
    >
      {drag?.kind === "group" && (
        <span
          className="pointer-events-none absolute right-2 top-1/2 z-[1] -translate-y-1/2 rounded-[6px] bg-primary px-2 py-0.5 font-semibold text-primary-foreground shadow"
          style={{ fontSize: 11.5 }}
        >
          {drag.join === null
            ? dt("Сгруппировать", "Group")
            : dt(`В группу «${drag.join}»`, `Into group “${drag.join}”`)}
          <span className="ml-1.5 font-normal opacity-80">
            · {dt("задержите — станет подзадачей", "hold to make it a subtask")}
          </span>
        </span>
      )}
      <div
        className="flex min-w-0 items-center gap-2 px-3"
        style={depth ? { paddingLeft: 34 } : undefined}
      >
        {kids && (
          // Шеврон — в левом поле строки, чтобы колонка названий не съезжала у строк без подзадач.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              kids.onToggle();
            }}
            aria-expanded={kids.open}
            aria-label={kids.open
              ? dt("Свернуть подзадачи", "Collapse subtasks")
              : dt("Показать подзадачи", "Show subtasks")}
            className="absolute left-0 top-0 flex h-[38px] w-3 items-center justify-center text-ink-mute hover:text-ink"
          >
            <RoyIcon
              name="cright"
              size={9}
              strokeWidth={2.6}
              className={cn("transition-transform", kids.open && "rotate-90")}
            />
          </button>
        )}
        <span
          className={cn(
            "size-[7px] shrink-0 rounded-full",
            STATUS_TONE[item.status] ?? "bg-status-open",
          )}
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
        {kids && (
          <span
            className={cn(
              "shrink-0 font-mono",
              kids.done === kids.total ? "text-status-done" : "text-ink-mute",
            )}
            style={{ fontSize: 11.5 }}
            title={dt("подзадачи: готово / всего", "subtasks: done / total")}
          >
            {kids.done}/{kids.total}
          </span>
        )}
        {parent && (
          h.onOpenTask
            ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  h.onOpenTask!(parent.id);
                }}
                className="min-w-0 max-w-[40%] shrink truncate text-ink-mute underline-offset-2 hover:text-ink hover:underline"
                style={{ fontSize: 11.5 }}
              >
                ↳ {dt("из", "of")} «{parent.title}»
              </button>
            )
            : (
              <span
                className="min-w-0 max-w-[40%] shrink truncate text-ink-mute"
                style={{ fontSize: 11.5 }}
              >
                ↳ {dt("из", "of")} «{parent.title}»
              </span>
            )
        )}
        {item.removed && (
          <span
            className="shrink-0 whitespace-nowrap text-ink-mute"
            style={{ fontSize: 11 }}
          >
            {dt("удалена", "deleted")}
            {item.removed_at ? ` ${fmtDay(item.removed_at)}` : ""}
          </span>
        )}
        {live && (
          <span className="flex shrink-0 items-center gap-1.5">
            {showExtra && !item.in_plan && (
              <span
                title={dt(
                  "добавлено после старта спринта",
                  "added after the sprint started",
                )}
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

      <div
        className={cn(
          "px-2 font-mono",
          late ? "font-semibold text-pri-high" : "text-ink-soft",
        )}
        style={{ fontSize: 12 }}
      >
        {item.due_date
          ? fmtDayShort(item.due_date)
          : <span className="text-ink-mute">—</span>}
      </div>

      <div className="px-2 font-mono text-ink-soft" style={{ fontSize: 12 }}>
        {market ?? <span className="text-ink-mute">—</span>}
      </div>

      <div className="min-w-0 px-2">
        {live && h.onCheck && !closed
          ? (
            <button
              type="button"
              onClick={act((i) =>
                h.onCheck!(i, NEXT_CHECK[i.check_status ?? "none"])
              )}
              title={dt(
                "Как идут дела: по плану → риск → проблема",
                "How it is going: on track → at risk → problem",
              )}
              className="max-w-full rounded-[6px] transition-opacity hover:opacity-80"
            >
              <CheckChip
                status={item.check_status}
                note={item.check_note}
                unchecked={unchecked}
              />
            </button>
          )
          : live
          ? (
            <CheckChip
              status={item.check_status}
              note={item.check_note}
              unchecked={unchecked && !closed}
            />
          )
          : null}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 px-2 text-ink-soft">
        {live && (
          <>
            {who ? <AssigneeChip name={who} /> : null}
            <span className="min-w-0 truncate">
              {who
                ? displayName(who)
                : <span className="text-ink-mute">—</span>}
            </span>
            {item.assignees.length > 1 && (
              <span
                className="shrink-0 font-mono text-ink-mute"
                style={{ fontSize: 11 }}
                title={item.assignees.join(", ")}
              >
                +{item.assignees.length - 1}
              </span>
            )}
          </>
        )}
      </div>

      {/* Хвост строки: быстрые действия. На компьютере — по наведению, на телефоне видны всегда. */}
      <div
        className="flex items-center justify-end gap-1 pr-3 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100"
        style={{ fontSize: 11 }}
      >
        {live && h.onDone && (
          <button
            type="button"
            onClick={act(h.onDone)}
            title={closed
              ? dt("Вернуть в работу", "Reopen")
              : dt("Выполнено", "Done")}
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
        {live && dnd?.onMenu && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              dnd.onMenu!();
            }}
            title={dt(
              "Сгруппировать с… / Сделать подзадачей…",
              "Group with… / Make a subtask of…",
            )}
            aria-label={dt(
              "Сгруппировать или сделать подзадачей",
              "Group or make a subtask",
            )}
            className={cn(
              quiet,
              "border-line bg-surface text-ink-soft hover:text-ink",
            )}
          >
            ⋯
          </button>
        )}
      </div>

      {
        /* Причину спрашиваем там же, где поставили отметку: «риск» без причины к следующей
          встрече уже никто не помнит. Поле необязательное — принуждение даёт «нет времени»
          вместо объяснения. */
      }
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
              ? dt(
                "что именно мешает (необязательно)",
                "what exactly is blocking (optional)",
              )
              : dt(
                "почему переносится (необязательно)",
                "why it is carried over (optional)",
              )}
            className="w-full rounded-[6px] border border-line bg-surface px-2 py-1 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12 }}
          />
        </div>
      )}
      {
        /* Силуэт будущей подзадачи (дополнение владельца 01.10.2026: «может отобразить какой-то
          типа силуэт будущей задачи»): строка с отступом прямо под целью — видно, куда встанет. */
      }
      {drag?.kind === "subtask" && (
        <div className="col-span-full px-2 pb-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-[6px] border border-dashed px-3 py-1.5",
              drag.block
                ? "border-ink-mute/50 text-ink-mute"
                : "border-primary/70 bg-primary/8 text-ink",
            )}
            style={{ paddingLeft: 34, fontSize: 12.5 }}
          >
            <span className="min-w-0 truncate opacity-70">↳ {drag.title}</span>
            <span
              className={cn(
                "ml-auto shrink-0 font-semibold",
                drag.block ? "text-ink-mute" : "text-primary",
              )}
              style={{ fontSize: 11.5 }}
            >
              {drag.block ? blockText(dt, drag.block, item.title) : dt(
                `Станет подзадачей «${item.title}»`,
                `Becomes a subtask of “${item.title}”`,
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Подзадача под развёрнутой строкой, которой нет среди строк этой группы: либо не в составе
 *  спринта, либо в составе, но в другой группе. Только смотреть и открыть — действия спринта
 *  живут на её собственной строке. */
export function SubtaskLiteRow({ task, inSprint, onOpen }: {
  task: Task;
  inSprint: boolean;
  onOpen?: (taskId: string) => void;
}) {
  const dt = useDt();
  const closed = CLOSED.has(task.status);
  const who = task.assignees?.[0] ?? null;
  return (
    <div
      role="row"
      onClick={onOpen ? () => onOpen(task.id) : undefined}
      className={cn(
        "grid items-center border-t border-line transition-colors",
        onOpen && "cursor-pointer hover:bg-surface-2",
        !inSprint && "opacity-70",
      )}
      style={{ gridTemplateColumns: SPRINT_COLS, minHeight: 34, fontSize: 13 }}
    >
      <div
        className="flex min-w-0 items-center gap-2 px-3"
        style={{ paddingLeft: 34 }}
      >
        <span
          className={cn(
            "size-[6px] shrink-0 rounded-full",
            STATUS_TONE[task.status] ?? "bg-status-open",
          )}
          title={task.status}
        />
        <span
          className={cn(
            "min-w-0 truncate",
            closed ? "text-ink-mute line-through" : "text-ink-soft",
          )}
        >
          {task.title}
        </span>
        <span
          className="shrink-0 rounded-full border border-dashed border-line px-1.5 py-0.5 text-ink-mute"
          style={{ fontSize: 10.5 }}
        >
          {inSprint
            ? dt("в спринте", "in sprint")
            : dt("не в спринте", "not in sprint")}
        </span>
      </div>
      <div className="px-2 font-mono text-ink-mute" style={{ fontSize: 12 }}>
        {task.due_date ? fmtDayShort(task.due_date) : "—"}
      </div>
      <div className="px-2 font-mono text-ink-mute" style={{ fontSize: 12 }}>
        {task.country ?? "—"}
      </div>
      <div />
      <div className="min-w-0 truncate px-2 text-ink-mute">
        {who ? displayName(who) : "—"}
      </div>
      <div />
    </div>
  );
}
