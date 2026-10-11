"use client";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { cn, displayName } from "@/lib/utils";
import type { Task, User } from "@/types";
import type { TaskLabel } from "@/lib/api";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { isDone, isOverdue } from "@/lib/smartLists";
import { saveTaskPatch, TaskQuickActions, toggleLabelPatch } from "@/components/tasks/TaskQuickActions";
import { COUNTRY_NAMES, countryName } from "@/lib/countries";
import type { UpdateTaskInput } from "@/lib/api";
import { Menu, type MenuItem } from "./Menu";
import type { SubtaskProgress } from "@/lib/subtasks";
import type { MovableColumn } from "@/lib/taskColumns";

// Строка таблицы задач нового вида (стенд: screens-tasks.js → taskRow). Порядок колонок по
// умолчанию — по тому, чем в строке ПОЛЬЗУЮТСЯ (владелец 22.09.2026): срок и быстрые действия у
// названия, дальше рынок, потом проект, исполнитель и списки. С 28.09.2026 человек переставляет
// колонки и тянет их ширину сам (lib/taskColumns.ts), «Задача» всегда первая.

// Уже 1100px (узкая десктопная раскладка) «Проект» и «Списки» прячутся — иначе на окне
// 720–1100px строка шире экрана. Сами шаблоны сетки считает lib/taskColumns.ts под текущий
// порядок и ширины и кладёт в CSS-переменные контейнера таблицы; классы статичные, чтобы
// Tailwind их увидел.
export const TASK_GRID = "grid-cols-[var(--g-narrow)] min-[1100px]:grid-cols-[var(--g-wide)]";
export const TASK_GRID_MIN_W = "min-w-[var(--w-narrow)] min-[1100px]:min-w-[var(--w-wide)]";
export const NARROW_HIDDEN = "max-[1099px]:hidden";

const fmtDue = (iso: string, en: boolean) =>
  new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).replace(".", "");

export function TaskTableRow({ task, order, now, users, markets, labels, projectName, onOpen, onToggle, onPatch, onChanged, depth = 0, progress }: {
  task: Task;
  // Порядок колонок после «Задачи» — тот же, что в шапке (TaskTableHead).
  order: readonly MovableColumn[];
  now: Date;
  users: User[];
  markets: string[];
  labels: TaskLabel[];
  projectName: string | null;
  onOpen: () => void;
  onToggle: () => void;
  onPatch: (patch: Partial<Task>) => void;
  onChanged: () => void;
  // Подзадача под родителем (#478) — отступ; у родителя — «X из Y» по подзадачам.
  depth?: 0 | 1;
  progress?: SubtaskProgress;
}) {
  const dt = useDt();
  const done = isDone(task);
  const late = isOverdue(task, now);
  const inProgress = task.status === "in_progress";
  const who = task.assignee_telegram_ids?.[0];
  const whoName = who != null
    ? displayName(users.find((u) => u.telegram_id === who)?.name ?? task.assignees?.[0] ?? "")
    : "";
  const labelNames = (task.label_ids ?? [])
    .map((id) => labels.find((l) => l.id === id)?.name)
    .filter((n): n is string => !!n);
  // В ячейке — первый список и «· +N» за остальные (макет 28.09.2026), полный перечень — в подсказке.
  const labelsShort = labelNames.length > 1 ? `${labelNames[0]} · +${labelNames.length - 1}` : (labelNames[0] ?? "");
  const stop = (e: MouseEvent) => e.stopPropagation();
  const commit = (fields: UpdateTaskInput, patch: Partial<Task>) => saveTaskPatch(task.id, fields, patch, onPatch, onChanged);

  // Выбор прямо в ячейке (стенд: cpick) — рынок, исполнитель, списки. Правила те же, что у
  // быстрых действий: рынки воркспейса, списки — только метки.
  const codes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  if (task.country && !codes.includes(task.country)) codes.push(task.country);
  const marketItems: MenuItem[] = [
    { key: "", label: dt("— без рынка", "— no market"), on: !task.country, action: true, onPick: () => commit({ country: null }, { country: null }) },
    ...codes.map((c) => ({
      key: c, label: <><span className="mr-1.5 font-mono text-ink-mute">{c}</span>{countryName(c)}</>, on: task.country === c, action: true,
      onPick: () => commit({ country: c }, { country: c }),
    })),
  ];
  const whoItems: MenuItem[] = [
    { key: "", label: dt("— не назначен", "— unassigned"), on: who == null, action: true,
      onPick: () => commit({ assignee_telegram_id: null }, { assignee_telegram_ids: [] }) },
    ...users.map((u) => ({
      key: String(u.telegram_id), label: displayName(u.name), on: who === u.telegram_id, action: true,
      onPick: () => commit({ assignee_telegram_id: u.telegram_id }, { assignee_telegram_ids: [u.telegram_id] }),
    })),
  ];
  const labelItems: MenuItem[] = labels.map((l) => ({
    key: l.id, label: l.name, on: (task.label_ids ?? []).includes(l.id),
    onPick: () => { const { fields, patch } = toggleLabelPatch(task, l.id); commit(fields, patch); },
  }));

  // Ячейки по колонкам: строка рисует их в порядке шапки (человек переставляет колонки сам).
  const cells: Record<MovableColumn, ReactNode> = {
    due: (
      <div data-col="due" className={cn("px-2 font-mono", late ? "font-semibold text-pri-high" : "text-ink-soft")} style={{ fontSize: 12 }}>
        {task.due_date ? fmtDue(task.due_date, dt("ru", "en") === "en") : <span className="text-ink-mute">—</span>}
      </div>
    ),
    // Быстрые действия — тихими иконками без рамок, как на стенде (визуальный шаг В3). Правило
    // бьёт только по кнопкам-триггерам: всплывающие окна пикеров рисуются порталом вне строки,
    // а в карточке задачи те же пикеры остаются в рамках. Колонка переезжает целиком.
    actions: (
      <div
        data-col="actions"
        onClick={stop}
        className="flex items-center gap-0.5 px-1 text-ink-mute opacity-70 transition-opacity group-hover:opacity-100 [&_button]:border-transparent [&_button]:bg-transparent [&_button]:text-ink-mute [&_button:hover]:bg-surface-2 [&_button:hover]:text-ink [&_svg]:text-current"
      >
        <TaskQuickActions task={task} users={users} markets={markets} labels={labels} onPatch={onPatch} onChanged={onChanged} />
      </div>
    ),
    market: (
      <CellPick col="market" title={task.country ? `${dt("Рынок", "Market")}: ${countryName(task.country)}` : dt("Рынок не указан", "No market")} items={marketItems}>
        <span className="font-mono text-ink-soft" style={{ fontSize: 12 }}>{task.country ?? <span className="text-ink-mute">—</span>}</span>
      </CellPick>
    ),
    project: (
      <div data-col="project" title={projectName ?? undefined} className={cn("min-w-0 truncate px-2 text-ink-soft", NARROW_HIDDEN)}>{projectName ?? <span className="text-ink-mute">—</span>}</div>
    ),
    assignee: (
      <CellPick col="assignee" title={whoName ? `${dt("Исполнитель", "Assignee")}: ${whoName}` : dt("Исполнитель не назначен", "Unassigned")} items={whoItems}>
        <span className="truncate text-ink-soft">{whoName || <span className="text-ink-mute">—</span>}</span>
      </CellPick>
    ),
    lists: (
      <div data-col="lists" className={cn("min-w-0", NARROW_HIDDEN)}>
        {labels.length > 0 ? (
          <CellPick
            title={labelNames.length
              ? labelNames.join(", ")
              : dt("Списки", "Lists")}
            items={labelItems}
          >
            <span className="truncate text-ink-mute" style={{ fontSize: 12.5 }}>{labelsShort || "—"}</span>
          </CellPick>
        ) : <div className="min-w-0 truncate px-2 text-ink-mute" style={{ fontSize: 12.5 }}>—</div>}
      </div>
    ),
  };

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={cn("group grid cursor-pointer items-center border-b border-line bg-surface transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TASK_GRID)}
      style={{ minHeight: 34, fontSize: 13 }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-1" style={depth ? { paddingLeft: 38 } : undefined}>
        <button
          type="button"
          onClick={(e) => { stop(e); onToggle(); }}
          aria-label={done ? dt("Вернуть в работу", "Reopen") : dt("Готово", "Done")}
          className="flex size-[17px] shrink-0 items-center justify-center"
        >
          {/* Стенд: в покое — точка статуса; галочка-кружок проявляется при наведении и фокусе,
              чтобы закрытие задачи оставалось в один клик (визуальный шаг В2). */}
          {done ? (
            <span className="flex size-[17px] items-center justify-center rounded-full bg-status-done text-white">
              <RoyIcon name="check" size={11} strokeWidth={2.6} />
            </span>
          ) : (
            <>
              <span
                className={cn(
                  "size-[7px] rounded-full group-hover:hidden group-focus-within:hidden",
                  inProgress ? "bg-status-prog" : "bg-status-open",
                )}
              />
              <span className="hidden size-[17px] rounded-full border-[1.6px] border-ink-mute transition-colors hover:border-primary group-hover:block group-focus-within:block" />
            </>
          )}
        </button>
        {/* Название — до двух строк, дальше многоточие; целиком — в подсказке (макет 28.09.2026). */}
        <span
          title={task.title}
          className={cn("line-clamp-2 min-w-0 break-words", done ? "text-ink-mute line-through" : "text-ink")}
          style={{ lineHeight: 1.35 }}
        >
          {task.title}
        </span>
        {progress && (
          <span
            title={dt("Подзадачи: закрыто из всех", "Subtasks: done of total")}
            className="shrink-0 rounded-[5px] border border-line px-1.5 font-mono text-ink-mute"
            style={{ fontSize: 11, lineHeight: "17px" }}
          >
            {progress.done}/{progress.total}
          </span>
        )}
      </div>
      {order.map((c) => <Fragment key={c}>{cells[c]}</Fragment>)}
    </div>
  );
}

// Ячейка с выбором: вся ячейка — кнопка, клик не открывает карточку строки.
function CellPick({ col, title, items, children }: { col?: MovableColumn; title: string; items: MenuItem[]; children: ReactNode }) {
  return (
    <div data-col={col} className="min-w-0 px-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Menu label={null} items={items} title={title} trigger={({ open, toggle }) => (
        <button type="button" title={title} aria-haspopup="menu" aria-expanded={open} onClick={toggle}
          className={cn(
            "flex h-[26px] w-full min-w-0 items-center rounded-[6px] px-1 text-left transition-colors hover:bg-surface",
            open && "bg-surface ring-1 ring-line-2",
          )}>
          {children}
        </button>
      )} />
    </div>
  );
}
