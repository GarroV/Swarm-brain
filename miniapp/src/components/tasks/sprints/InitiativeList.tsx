"use client";
import { useState } from "react";
import type { SprintCycleItem } from "@/types";
import type { DirectionNode, InitiativeNode } from "@/lib/initiatives";
import { isBareDirection } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import {
  AssigneeChip,
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

const STATUS_TONE: Record<string, string> = {
  done: "bg-status-done",
  in_progress: "bg-status-prog",
  cancelled: "bg-ink-soft/40",
};

/** Строка задачи. Клик открывает карточку — но только у живой: у упоминания и у чужой
 *  приватной открывать нечего, и «кнопка, которая ничего не делает» хуже её отсутствия. */
function TaskRow(
  { item, unchecked, onOpen, onDone, onCarry }: {
    item: SprintCycleItem;
    unchecked: boolean;
    onOpen?: (item: SprintCycleItem) => void;
    /** Быстрые действия прямо в строке — как в исходном макете: «✓ выполнено» и
     *  «→ перенести». Открывать карточку ради ежедневного клика — лишняя работа. */
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
  },
) {
  const dt = useDt();
  const closed = CLOSED.has(item.status);
  const openable = !!onOpen && !item.removed && !item.hidden && !!item.task_id;
  const actionable = !item.removed && !item.hidden && !!item.task_id;
  // Клик по кнопке не должен открывать карточку — иначе каждое быстрое действие
  // заканчивается всплывшей модалкой.
  const act =
    (fn?: (i: SprintCycleItem) => void | Promise<void>) => (e: React.MouseEvent) => {
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
                : dt("Перенести в следующий спринт", "Carry to the next sprint")}
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
      {!item.removed && !item.hidden && (
        <>
          {item.assignees.length === 0
            ? <AssigneeChip name={null} />
            : item.assignees.map((a) => <AssigneeChip key={a} name={a} />)}
          {item.due_date && <DueBadge date={item.due_date} closed={closed} />}
          <CheckBadge
            status={item.check_status}
            note={item.check_note}
            unchecked={unchecked && !closed}
          />
          {item.to_carry && <CarryFlag reason={item.carry_reason} />}
          <CarryBadge count={item.carry_count} reason={item.carry_reason} />
        </>
      )}
    </div>
  );
}

/** Инициатива: сворачивается, потому что на кросс-командном проекте их десятки, и
 *  развёрнутые все разом они превращают экран в ленту без структуры. */
/** Строка «+ задача» внутри инициативы. Задача рождается здесь же, в этой инициативе и в
 *  этом спринте, — а не заводится отдельно и потом набирается галочками из пула (#407).
 *  Исполнитель — тот, кто создаёт (решение владельца 19.09.2026): у инициативы владелец
 *  может быть один, а пишут в неё разные люди, и подстановка чужого имени в свою задачу
 *  читается как назначение работы другому. */
function AddTaskRow(
  { projectId, onAdd }: {
    projectId: string | null;
    onAdd: (projectId: string | null, title: string) => Promise<void>;
  },
) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(projectId, title.trim());
      setTitle("");
      // Не закрываем: подряд заводят несколько задач, и закрытие после каждой заставляет
      // целиться в кнопку снова.
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-ink-soft/70 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {dt("+ задача", "+ task")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <input
        autoFocus
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder={dt("Название задачи", "Task name")}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink outline-none focus:border-[var(--accent-ink)]"
      />
      <button
        type="button"
        onClick={() => {
          setTitle("");
          setOpen(false);
        }}
        className="shrink-0 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-surface-2"
      >
        {dt("готово", "done")}
      </button>
    </div>
  );
}

function Initiative(
  { node, collapsed, onToggle, unchecked, ownerName, onOpen, onAdd, onDone, onCarry }: {
    node: InitiativeNode;
    onAdd?: (projectId: string | null, title: string) => Promise<void>;
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
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
              onOpen={onOpen}
              onDone={onDone}
              onCarry={onCarry}
            />
          ))}
          {onAdd && <AddTaskRow projectId={node.project?.id ?? null} onAdd={onAdd} />}
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
  { board, unchecked = false, users = [], onOpen, onAdd, onDone, onCarry }: {
    board: DirectionNode[];
    unchecked?: boolean;
    users?: { telegram_id: number; name: string }[];
    onOpen?: (item: SprintCycleItem) => void;
    /** Есть — внутри каждой инициативы появляется строка «+ задача». Нет — доска только читается
     *  (принятый спринт, чужое пространство). */
    onAdd?: (projectId: string | null, title: string) => Promise<void>;
    onDone?: (item: SprintCycleItem) => void | Promise<void>;
    onCarry?: (item: SprintCycleItem) => void | Promise<void>;
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
              {dir.project?.name ?? dt("Без направления", "No direction")}
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
