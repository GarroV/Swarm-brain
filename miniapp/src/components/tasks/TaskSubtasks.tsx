"use client";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { Task } from "@/types";
import { createTask, fetchTasks, updateTask } from "@/lib/api";
import { isDone } from "@/lib/smartLists";
import { subtaskCandidates, subtasksOf } from "@/lib/subtasks";
import { tomorrowLocalISO } from "@/lib/dateRange";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { CardSectionHeader, CardSectionMenu, MenuTitle } from "@/components/tasks/CardSectionMenu";

// Подзадачи в карточке задачи (#478, решение владельца 24.09.2026): уровни проект → инициатива →
// задача → подзадача; в спринте работают подзадачами. Вложенность — ОДИН уровень: у подзадачи
// своих подзадач нет, поэтому у неё блок показывает только родителя.
// API уже держит parent_id (создание, привязка, защита от цикла — swarm-api/index.ts).

// Пустой раздел не рисуется (решение владельца 01.10.2026): у задачи без подзадач и без родителя
// от него остаётся пиктограмма в строке CardIconBar, а ввод живёт в её меню — SubtaskForm.
// Данные — в хуке useTaskSubtasks: карточке нужно знать, пуст ли раздел, ещё до его отрисовки.

export type SubtasksState = ReturnType<typeof useTaskSubtasks>;

export function useTaskSubtasks(task: Task | null, onChanged?: () => void) {
  const dt = useDt();
  const [all, setAll] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskId = task?.id ?? null;

  const load = useCallback(() => {
    if (!taskId) return;
    fetchTasks().then(setAll).catch(() => setAll([]));
  }, [taskId]);
  useEffect(load, [load]);

  const kids = useMemo(() => (all && task ? subtasksOf(all, task.id) : []), [all, task]);
  const parent = useMemo(() => all?.find((t) => t.id === task?.parent_id) ?? null, [all, task]);
  const candidates = useMemo(() => (all && task ? subtaskCandidates(all, task) : []), [all, task]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : dt("Не получилось", "Failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Срок обязателен (#440): подзадача наследует срок родителя, без него — «завтра».
  const add = (title: string) =>
    task
      ? run(() =>
        createTask({
          title,
          parent_id: task.id,
          project_id: task.project_id,
          due_date: task.due_date ?? tomorrowLocalISO(),
          assignee_telegram_id: task.assignee_telegram_ids?.[0] ?? null,
        })
      )
      : Promise.resolve(false);
  const attach = (id: string) => (task ? run(() => updateTask(id, { parent_id: task.id })) : Promise.resolve(false));
  const detach = (id: string) => run(() => updateTask(id, { parent_id: null }));
  const toggle = (k: Task) => run(() => updateTask(k.id, { status: isDone(k) ? "open" : "done" }));

  return {
    loaded: all !== null,
    // Пуст — нет ни подзадач, ни родителя: у подзадачи раздел показывает родителя, а своих
    // подзадач у неё быть не может (вложенность в один уровень).
    empty: all !== null && !!task && !task.parent_id && kids.length === 0,
    kids,
    parent,
    candidates,
    busy,
    error,
    add,
    attach,
    detach,
    toggle,
  };
}

/** Меню добавления подзадачи: «Новая подзадача — Enter» и «Привязать существующую». */
export function SubtaskForm({ s, onAdded, onAttached }: {
  s: SubtasksState;
  onAdded?: () => void;
  onAttached?: () => void;
}) {
  const dt = useDt();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);

  // Меню после Enter не закрывается: подзадачи обычно заводят пачкой, по одной на строку.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const title = draft.trim();
    if (!title || s.busy) return;
    setDraft("");
    s.add(title).then((ok) => {
      if (ok) onAdded?.();
      else setDraft(title);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <MenuTitle>{dt("Подзадача", "Subtask")}</MenuTitle>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 focus-within:border-primary/50">
        <RoyIcon name="plus" size={14} className="shrink-0 text-ink-mute" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          aria-label={dt("Название подзадачи", "Subtask title")}
          placeholder={dt("Новая подзадача — Enter", "New subtask — Enter")}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
          style={{ fontSize: 13 }}
        />
      </div>
      {s.candidates.length > 0 && !picking && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="self-start rounded-full px-1 py-0.5 text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 12.5 }}
        >
          {dt("Привязать существующую", "Link existing")}
        </button>
      )}
      {picking && (
        <select
          autoFocus
          defaultValue=""
          disabled={s.busy}
          aria-label={dt("Привязать существующую задачу", "Link an existing task")}
          onChange={async (e) => {
            const id = e.target.value;
            if (!id) return;
            setPicking(false);
            if (await s.attach(id)) onAttached?.();
          }}
          className="w-full rounded-[7px] border border-line bg-surface px-2 py-1.5 text-ink"
          style={{ fontSize: 13 }}
        >
          <option value="">{dt("Выберите задачу этого проекта…", "Pick a task from this project…")}</option>
          {s.candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
      {s.error && <p className="text-pri-high" style={{ fontSize: 12 }}>{s.error}</p>}
    </div>
  );
}

// onOpenTask — переход к связанной задаче (родителю или подзадаче) в той же карточке.
// action — «+» у заголовка, открывает то же меню, что пиктограмма пустого раздела.
export function TaskSubtasks({ task, s, onOpenTask, action }: {
  task: Task;
  s: SubtasksState;
  onOpenTask?: (t: Task) => void;
  action?: ReactNode;
}) {
  const dt = useDt();
  const { kids, parent, busy } = s;
  if (!s.loaded || s.empty) return null;

  if (task.parent_id) {
    return (
      <div className="flex items-center gap-2 text-ink-soft" style={{ fontSize: 13 }}>
        <RoyIcon name="arrow" size={13} className="shrink-0 -scale-x-100" />
        <span className="min-w-0 truncate">
          {dt("Подзадача задачи", "Subtask of")}{" "}
          {parent && onOpenTask ? (
            <button
              type="button"
              onClick={() => onOpenTask(parent)}
              className="font-medium text-accent-ink underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              «{parent.title}»
            </button>
          ) : (
            <>«{parent?.title ?? "…"}»</>
          )}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => s.detach(task.id)}
          className="ml-auto shrink-0 text-ink-mute underline-offset-2 hover:text-ink hover:underline"
          style={{ fontSize: 12.5 }}
        >
          {dt("Отвязать", "Detach")}
        </button>
      </div>
    );
  }

  const doneCount = kids.filter(isDone).length;

  return (
    <div>
      <CardSectionHeader
        title={dt("Подзадачи", "Subtasks")}
        count={`${doneCount} ${dt("из", "of")} ${kids.length}`}
        action={action}
      />
      {kids.map((k) => {
        const done = isDone(k);
        return (
          <div key={k.id} className="group flex items-center gap-2 border-b border-line py-1.5" style={{ fontSize: 13.5 }}>
            <button
              type="button"
              disabled={busy}
              aria-label={done ? dt("Вернуть в работу", "Reopen") : dt("Готово", "Done")}
              onClick={() => s.toggle(k)}
              className={cn(
                "flex size-[16px] shrink-0 items-center justify-center rounded-full border-[1.6px]",
                done ? "border-status-done bg-status-done text-white" : "border-ink-mute hover:border-primary",
              )}
            >
              {done && <RoyIcon name="check" size={10} strokeWidth={2.6} />}
            </button>
            {onOpenTask ? (
              <button
                type="button"
                onClick={() => onOpenTask(k)}
                className={cn(
                  "min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none",
                  done ? "text-ink-mute line-through" : "text-ink hover:text-accent-ink",
                )}
              >
                {k.title}
              </button>
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", done ? "text-ink-mute line-through" : "text-ink")}>{k.title}</span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => s.detach(k.id)}
              className="shrink-0 text-ink-mute opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
              style={{ fontSize: 12 }}
            >
              {dt("Отвязать", "Detach")}
            </button>
          </div>
        );
      })}
      {s.error && <p className="mt-1 text-pri-high" style={{ fontSize: 12.5 }}>{s.error}</p>}
    </div>
  );
}

/** Меню подзадачи — для строки пустых разделов (variant "icon") и для «+» у заголовка. */
export function SubtasksMenu({ s, variant = "icon", triggerRef, onDone }: {
  s: SubtasksState;
  variant?: "icon" | "plus";
  triggerRef?: Ref<HTMLButtonElement>;
  /** Подзадача заведена или привязана. */
  onDone?: () => void;
}) {
  const dt = useDt();
  return (
    <CardSectionMenu icon="subtask" variant={variant} label={dt("Добавить подзадачу", "Add a subtask")} triggerRef={triggerRef}>
      {(close) => (
        <SubtaskForm
          s={s}
          onAdded={onDone}
          onAttached={() => {
            close();
            onDone?.();
          }}
        />
      )}
    </CardSectionMenu>
  );
}
