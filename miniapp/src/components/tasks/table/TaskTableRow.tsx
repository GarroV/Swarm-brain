"use client";
import type { MouseEvent } from "react";
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

// Строка таблицы задач нового вида (стенд: screens-tasks.js → taskRow). Порядок колонок —
// по тому, чем в строке ПОЛЬЗУЮТСЯ (владелец 22.09.2026): срок и быстрые действия у названия,
// дальше рынок, потом проект, исполнитель и списки — их читают глазами.

// Колонки таблицы задач. Уже 1100px (узкая десктопная раскладка) «Проект» и «Списки» прячутся —
// как на стенде, где набор колонок зависит от ширины: иначе на окне 720–1100px строка шире
// экрана. Классы статичные, чтобы Tailwind их увидел; ячейки этих колонок — с NARROW_HIDDEN.
export const TASK_GRID =
  "grid-cols-[minmax(200px,1fr)_88px_168px_64px_minmax(110px,24%)] min-[1100px]:grid-cols-[minmax(260px,1fr)_88px_168px_64px_minmax(110px,18%)_minmax(110px,15%)_minmax(90px,14%)]";
export const NARROW_HIDDEN = "max-[1099px]:hidden";

const fmtDue = (iso: string, en: boolean) =>
  new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).replace(".", "");

export function TaskTableRow({ task, now, users, markets, labels, projectName, onOpen, onToggle, onPatch, onChanged, depth = 0, progress }: {
  task: Task;
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
    .filter(Boolean)
    .join(", ");
  const stop = (e: MouseEvent) => e.stopPropagation();
  const commit = (fields: UpdateTaskInput, patch: Partial<Task>) => saveTaskPatch(task.id, fields, patch, onPatch, onChanged);

  // Выбор прямо в ячейке (стенд: cpick) — рынок, исполнитель, списки. Правила те же, что у
  // быстрых действий: рынки воркспейса, список делает задачу личной.
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

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={cn("group grid cursor-pointer items-center border-b border-line bg-surface transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TASK_GRID)}
      style={{ minHeight: 34, fontSize: 13 }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3" style={depth ? { paddingLeft: 38 } : undefined}>
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
        <span className={cn("min-w-0 truncate", done ? "text-ink-mute line-through" : "text-ink")}>{task.title}</span>
        {progress && (
          <span
            title={dt("Подзадачи: закрыто из всех", "Subtasks: done of total")}
            className="shrink-0 rounded-[5px] border border-line px-1.5 font-mono text-ink-mute"
            style={{ fontSize: 11, lineHeight: "17px" }}
          >
            {progress.done}/{progress.total}
          </span>
        )}
        {task.is_private && (
          <span title={dt("Личная", "Private")} className="shrink-0 text-ink-mute">
            <RoyIcon name="lock" size={12} />
          </span>
        )}
      </div>
      <div className={cn("px-2 font-mono", late ? "font-semibold text-pri-high" : "text-ink-soft")} style={{ fontSize: 12 }}>
        {task.due_date ? fmtDue(task.due_date, dt("ru", "en") === "en") : <span className="text-ink-mute">—</span>}
      </div>
      {/* Быстрые действия — тихими иконками без рамок, как на стенде (визуальный шаг В3). Правило
          бьёт только по кнопкам-триггерам: всплывающие окна пикеров рисуются порталом вне строки,
          а в карточке задачи те же пикеры остаются в рамках. */}
      <div
        onClick={stop}
        className="flex items-center gap-0.5 px-1 text-ink-mute opacity-70 transition-opacity group-hover:opacity-100 [&_button]:border-transparent [&_button]:bg-transparent [&_button]:text-ink-mute [&_button:hover]:bg-surface-2 [&_button:hover]:text-ink [&_svg]:text-current"
      >
        <TaskQuickActions task={task} users={users} markets={markets} labels={labels} onPatch={onPatch} onChanged={onChanged} />
      </div>
      <CellPick title={task.country ? `${dt("Рынок", "Market")}: ${countryName(task.country)}` : dt("Рынок не указан", "No market")} items={marketItems}>
        <span className="font-mono text-ink-soft" style={{ fontSize: 12 }}>{task.country ?? <span className="text-ink-mute">—</span>}</span>
      </CellPick>
      <div className={cn("min-w-0 truncate px-2 text-ink-soft", NARROW_HIDDEN)}>{projectName ?? <span className="text-ink-mute">—</span>}</div>
      <CellPick title={whoName ? `${dt("Исполнитель", "Assignee")}: ${whoName}` : dt("Исполнитель не назначен", "Unassigned")} items={whoItems}>
        <span className="truncate text-ink-soft">{whoName || <span className="text-ink-mute">—</span>}</span>
      </CellPick>
      <div className={cn("min-w-0", NARROW_HIDDEN)}>
        {labels.length > 0 ? (
          <CellPick title={dt("Списки — личные: задача станет личной", "Lists are personal: the task becomes private")} items={labelItems}>
            <span className="truncate text-ink-mute" style={{ fontSize: 12.5 }}>{labelNames || "—"}</span>
          </CellPick>
        ) : <div className="min-w-0 truncate px-2 text-ink-mute" style={{ fontSize: 12.5 }}>—</div>}
      </div>
    </div>
  );
}

// Ячейка с выбором: вся ячейка — кнопка, клик не открывает карточку строки.
function CellPick({ title, items, children }: { title: string; items: MenuItem[]; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
