"use client";
import { useState } from "react";
import type { CheckStatus, SprintCycleItem } from "@/types";
import type { DirectionNode, InitiativeNode } from "@/lib/initiatives";
import { isBareDirection } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import {
  AssigneeChip,
  CountChip,
  CarryBadge,
  CarryFlag,
  CheckBadge,
  DueBadge,
  ProgressBar,
  ProgressText,
} from "./atoms";
import { fmtDay } from "./format";

// Список спринта — главный экран доски инициатив: направление → инициатива → задачи.
// Он же второй вид того же состава, что канбан (TaskKanban): одна задача, одна правда,
// разный способ смотреть. Канбан отвечает на «что в работе», список — на «где мы по
// инициативам», и на кросс-командном проекте спрашивают именно второе.

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
  cancelled: "bg-ink-soft/40",
};

/** Строка задачи. Клик открывает карточку — но только у живой: у упоминания и у чужой
 *  приватной открывать нечего, и «кнопка, которая ничего не делает» хуже её отсутствия. */
function TaskRow(
  {
    item,
    unchecked,
    soleAssignee = false,
    onOpen,
    onDone,
    onCarry,
    onCheck,
    onNote,
  }: {
    item: SprintCycleItem;
    unchecked: boolean;
    /** У всей инициативы один исполнитель — он подписан в её заголовке, из строк убран. */
    soleAssignee?: boolean;
    onOpen?: (item: SprintCycleItem) => void;
    /** Быстрые действия прямо в строке — как в исходном макете: «✓ выполнено» и
     *  «→ перенести». Открывать карточку ради ежедневного клика — лишняя работа. */
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
    /** Отметка хода работы («как идут дела») — переезд со своего экрана сверки в строку
     *  (владелец 19.09.2026). Ритуал остаётся, место ввода становится одно. */
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
  const openable = !!onOpen && !item.removed && !item.hidden && !!item.task_id;
  const actionable = !item.removed && !item.hidden && !!item.task_id;
  // Клик по кнопке не должен открывать карточку — иначе каждое быстрое действие
  // заканчивается всплывшей модалкой.
  const act =
    (fn?: (i: SprintCycleItem) => void | Promise<void>) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      fn?.(item);
    };

  return (
    <div
      onClick={openable ? () => onOpen!(item) : undefined}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 ${
        openable ? "cursor-pointer hover:bg-surface-2" : ""
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          STATUS_TONE[item.status] ?? "bg-status-open"
        }`}
        title={item.status}
      />
      {actionable && (onDone || onCarry) && (
        <span className="flex shrink-0 items-center gap-0.5">
          {onDone && (
            <button
              type="button"
              onClick={act(onDone)}
              title={closed
                ? dt("Вернуть в работу", "Reopen")
                : dt("Выполнено", "Done")}
              className={`rounded-md border px-1.5 py-0.5 text-[11px] leading-none transition-colors ${
                closed
                  ? "border-status-done/50 bg-status-done/15 text-status-done"
                  : "border-line text-ink-soft hover:bg-surface-2 hover:text-ink"
              }`}
            >
              ✓
            </button>
          )}
          {onCarry && !closed && (
            <button
              type="button"
              onClick={act(onCarry)}
              title={item.to_carry
                ? dt("Снять пометку переноса", "Remove the carry mark")
                : dt(
                  "Перенести в следующий спринт",
                  "Carry to the next sprint",
                )}
              className={`rounded-md border px-1.5 py-0.5 text-[11px] leading-none transition-colors ${
                item.to_carry
                  ? "border-pri-med/50 bg-pri-med/15 text-pri-med"
                  : "border-line text-ink-soft hover:bg-surface-2 hover:text-ink"
              }`}
            >
              →
            </button>
          )}
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          item.removed
            ? "text-ink-soft/60 line-through"
            : item.hidden
            ? "italic text-ink-soft/60"
            : closed
            ? "text-ink-soft"
            : "text-ink"
        }`}
      >
        {item.hidden ? dt("Приватная задача", "Private task") : item.title}
      </span>

      {item.removed && (
        <span className="whitespace-nowrap text-[10px] text-ink-soft/60">
          {dt("удалена", "deleted")}
          {item.removed_at ? ` ${fmtDay(item.removed_at)}` : ""}
        </span>
      )}
      {
        /* Правая колонка ФИКСИРОВАННОЙ ширины: без неё мета прижата к краю экрана, а название
          к левому, и между ними пустота в половину строки — на широком мониторе тем больше,
          чем шире окно. С фиксированной шириной строки выстраиваются столбцом и названия
          обрезаются по одной границе. */
      }
      {!item.removed && !item.hidden && (
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 sm:w-[190px]">
          {onCheck && !closed
            ? (
              <button
                type="button"
                onClick={act((i) =>
                  onCheck(i, NEXT_CHECK[i.check_status ?? "none"])
                )}
                title={dt(
                  "Как идут дела: по плану → риск → проблема",
                  "How it is going: on track → at risk → problem",
                )}
                className="shrink-0 rounded-md transition-opacity hover:opacity-80"
              >
                <CheckBadge
                  status={item.check_status}
                  note={item.check_note}
                  unchecked={unchecked}
                />
              </button>
            )
            : (
              <CheckBadge
                status={item.check_status}
                note={item.check_note}
                unchecked={unchecked && !closed}
              />
            )}
          {item.to_carry && <CarryFlag reason={item.carry_reason} />}
          <CarryBadge count={item.carry_count} reason={item.carry_reason} />
          <CountChip kind="comments" count={item.comment_count} />
          <CountChip kind="links" count={item.link_count} />
          {item.due_date && <DueBadge date={item.due_date} closed={closed} />}
          {
            /* Исполнителя не повторяем, когда он один на всю инициативу: его имя стоит в
              заголовке, а в строках это шум (владелец 19.09.2026 — строка слишком длинная). */
          }
          {!soleAssignee &&
            (item.assignees.length === 0
              ? <AssigneeChip name={null} />
              : item.assignees.map((a) => <AssigneeChip key={a} name={a} />))}
        </div>
      )}

      {
        /* Причину спрашиваем там же, где поставили отметку: «риск» без причины к следующей
          встрече уже никто не помнит. Поле необязательное — принуждение даёт «нет времени»
          вместо объяснения. */
      }
      {onNote && !closed && !item.removed && !item.hidden &&
        (needsNote || item.to_carry) && (
        <input
          value={noteValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const v = noteValue.trim();
            setNote(null);
            if (v === saved.trim()) return;
            onNote(item, { [noteField]: v || null });
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
          className="w-full basis-full rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-primary/50"
        />
      )}
    </div>
  );
}

/** Инициатива: сворачивается, потому что на кросс-командном проекте их десятки, и
 *  развёрнутые все разом они превращают экран в ленту без структуры. */
/** Строка «+ задача» внутри инициативы. Открывает СТАНДАРТНУЮ карточку задачи с уже
 *  проставленной инициативой (решение владельца 19.09.2026: «при добавлении давай вызывать
 *  нашу стандартную менюшку добавления задачи»). Своё поле ввода здесь было короче, но
 *  заводило второй, урезанный способ создания задачи — с ним расходятся поля и правила. */
function AddTaskRow(
  { projectId, onAdd }: {
    projectId: string | null;
    onAdd: (projectId: string | null) => void;
  },
) {
  const dt = useDt();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAdd(projectId);
      }}
      className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-ink-soft/70 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {dt("+ задача", "+ task")}
    </button>
  );
}

function Initiative(
  {
    node,
    collapsed,
    onToggle,
    unchecked,
    ownerName,
    onOpen,
    onAdd,
    onDone,
    onCarry,
    onCheck,
    onNote,
  }: {
    node: InitiativeNode;
    onAdd?: (projectId: string | null) => void;
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
    onCheck?: (
      item: SprintCycleItem,
      status: CheckStatus | null,
    ) => void | Promise<void>;
    onNote?: (
      item: SprintCycleItem,
      patch: { check_note?: string | null; carry_reason?: string | null },
    ) => void | Promise<void>;
    collapsed: boolean;
    onToggle: () => void;
    unchecked: boolean;
    ownerName: (id: number) => string;
    onOpen?: (item: SprintCycleItem) => void;
  },
) {
  const dt = useDt();
  const project = node.project;
  const owner = project?.owner_telegram_id
    ? ownerName(project.owner_telegram_id)
    : null;
  // Один исполнитель на всю инициативу — частый случай: тогда имя показывается один раз в
  // заголовке, а строки освобождаются. Задачи без исполнителя в расчёт не идут — иначе
  // одна «ничья» строка вернула бы имена во все остальные.
  const named = node.items.filter((i) => !i.removed && !i.hidden).flatMap((i) =>
    i.assignees
  );
  const sole = named.length > 0 && new Set(named).size === 1 &&
      node.items.every((i) => i.removed || i.hidden || i.assignees.length === 1)
    ? named[0]
    : null;

  return (
    <div className="rounded-xl border border-line bg-surface/40 dark:backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-left"
      >
        <RoyIcon
          name={collapsed ? "cright" : "arrow"}
          size={12}
          className="shrink-0 text-ink-soft"
        />
        {project?.emoji && <span className="text-sm">{project.emoji}</span>}
        <span className="min-w-0 truncate text-sm font-semibold text-ink">
          {project?.name ?? dt("Общее", "General")}
        </span>
        {owner && (
          <span className="whitespace-nowrap text-[11px] text-ink-soft">
            · {owner}
          </span>
        )}
        {sole && (
          <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-ink-soft">
            · <AssigneeChip name={sole} />
            {sole}
          </span>
        )}
        {project?.end_date && (
          <span className="whitespace-nowrap text-[11px] text-ink-soft">
            · {dt("до", "due")} {fmtDay(project.end_date)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ProgressBar percent={node.progress.percent} className="w-20" />
          <ProgressText progress={node.progress} />
        </div>
      </button>
      {!collapsed && (
        <div className="border-t border-line/60 px-1 py-1">
          {node.items.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              unchecked={unchecked}
              soleAssignee={sole !== null}
              onOpen={onOpen}
              onDone={onDone}
              onCarry={onCarry}
              onCheck={onCheck}
              onNote={onNote}
            />
          ))}
          {onAdd && (
            <AddTaskRow projectId={node.project?.id ?? null} onAdd={onAdd} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Доска: направления сверху, внутри инициативы, внутри задачи.
 *
 * `unchecked` приходит снаружи, а не считается здесь: «с дня сверки» знает экран спринта,
 * а строка задачи не должна знать про календарь ритуала.
 */
export function InitiativeList(
  {
    board,
    unchecked = false,
    users = [],
    noneLabel,
    onOpen,
    onAdd,
    onDone,
    onCarry,
    onCheck,
    onNote,
  }: {
    board: DirectionNode[];
    /** Подпись группы-остатка. По умолчанию «Без направления»; при группировке по людям —
     *  «Без исполнителя»: остаток называется по тому, чего в нём нет. */
    noneLabel?: string;
    unchecked?: boolean;
    users?: { telegram_id: number; name: string }[];
    onOpen?: (item: SprintCycleItem) => void;
    /** Есть — внутри каждой инициативы появляется строка «+ задача». Нет — доска только читается
     *  (принятый спринт, чужое пространство). */
    onAdd?: (projectId: string | null) => void;
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
    onCheck?: (
      item: SprintCycleItem,
      status: CheckStatus | null,
    ) => void | Promise<void>;
    onNote?: (
      item: SprintCycleItem,
      patch: { check_note?: string | null; carry_reason?: string | null },
    ) => void | Promise<void>;
  },
) {
  const dt = useDt();
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // Ответственный инициативы хранится telegram_id — показываем человека, а не число.
  const ownerName = (id: number) =>
    users.find((u) => u.telegram_id === id)?.name ?? String(id);

  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      {board.map((dir) => (
        <section key={dir.project?.id ?? "__none__"} className="space-y-1.5">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
            {dir.project?.emoji && (
              <span className="text-sm">{dir.project.emoji}</span>
            )}
            <h3 className="min-w-0 truncate text-sm font-bold text-ink">
              {dir.project?.name ?? noneLabel ??
                dt("Без направления", "No direction")}
            </h3>
            <div className="ml-auto flex items-center gap-2">
              <ProgressBar percent={dir.progress.percent} className="w-24" />
              <ProgressText progress={dir.progress} />
            </div>
          </header>
          <div className="space-y-1.5">
            {
              /* Направление, у которого инициатив нет вовсе, показывает задачи напрямую.
                Обёртка «Общее» с теми же цифрами, что у направления, — строка, которая
                ничего не добавляет и прячет задачи за лишний клик (видно на живом экране). */
            }
            {isBareDirection(dir)
              ? (
                <div className="rounded-xl border border-line bg-surface/40 px-1 py-1 dark:backdrop-blur-sm">
                  {dir.initiatives[0].items.map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      unchecked={unchecked}
                      onOpen={onOpen}
                      onDone={onDone}
                      onCarry={onCarry}
                      onCheck={onCheck}
                      onNote={onNote}
                    />
                  ))}
                </div>
              )
              : dir.initiatives.map((ini) => {
                const key = `${dir.project?.id ?? ""}/${ini.project?.id ?? ""}`;
                return (
                  <Initiative
                    key={key}
                    node={ini}
                    collapsed={closed.has(key)}
                    onToggle={() => toggle(key)}
                    unchecked={unchecked}
                    ownerName={ownerName}
                    onOpen={onOpen}
                    onAdd={onAdd}
                    onDone={onDone}
                    onCarry={onCarry}
                    onCheck={onCheck}
                    onNote={onNote}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Скелет загрузки: пустой экран и «задач нет» обязаны выглядеть по-разному. */
export function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border border-line bg-surface/40"
        />
      ))}
    </div>
  );
}
