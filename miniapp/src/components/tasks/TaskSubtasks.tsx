"use client";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Task } from "@/types";
import { createTask, fetchTasks, updateTask } from "@/lib/api";
import { isDone } from "@/lib/smartLists";
import { subtaskCandidates, subtasksOf } from "@/lib/subtasks";
import { tomorrowLocalISO } from "@/lib/dateRange";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Подзадачи в карточке задачи (#478, решение владельца 24.09.2026): уровни проект → инициатива →
// задача → подзадача; в спринте работают подзадачами. Вложенность — ОДИН уровень: у подзадачи
// своих подзадач нет, поэтому у неё блок показывает только родителя.
// API уже держит parent_id (создание, привязка, защита от цикла — swarm-api/index.ts).

export function TaskSubtasks({ task, onChanged }: { task: Task; onChanged?: () => void }) {
  const dt = useDt();
  const [all, setAll] = useState<Task[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    fetchTasks().then(setAll).catch(() => setAll([]));
  }, []);
  useEffect(load, [load]);

  const kids = useMemo(() => (all ? subtasksOf(all, task.id) : []), [all, task.id]);
  const parent = useMemo(() => all?.find((t) => t.id === task.parent_id) ?? null, [all, task.parent_id]);
  const candidates = useMemo(() => (all ? subtaskCandidates(all, task) : []), [all, task]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : dt("Не получилось", "Failed"));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !draft.trim() || busy) return;
    const title = draft.trim();
    setDraft("");
    // Срок обязателен (#440): подзадача наследует срок родителя, без него — «завтра».
    run(() => createTask({
      title,
      parent_id: task.id,
      project_id: task.project_id,
      due_date: task.due_date ?? tomorrowLocalISO(),
      assignee_telegram_id: task.assignee_telegram_ids?.[0] ?? null,
      is_private: task.is_private,
    }));
  };

  if (task.parent_id) {
    return (
      <div className="flex items-center gap-2 text-ink-soft" style={{ fontSize: 13 }}>
        <RoyIcon name="arrow" size={13} className="shrink-0 -scale-x-100" />
        <span className="min-w-0 truncate">
          {dt("Подзадача задачи", "Subtask of")} «{parent?.title ?? "…"}»
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => updateTask(task.id, { parent_id: null }))}
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
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-semibold text-ink" style={{ fontSize: 13 }}>{dt("Подзадачи", "Subtasks")}</span>
        {kids.length > 0 && (
          <span className="font-mono text-ink-mute" style={{ fontSize: 11.5 }}>
            {doneCount} {dt("из", "of")} {kids.length}
          </span>
        )}
      </div>
      {kids.map((k) => {
        const done = isDone(k);
        return (
          <div key={k.id} className="group flex items-center gap-2 border-b border-line py-1.5" style={{ fontSize: 13.5 }}>
            <button
              type="button"
              disabled={busy}
              aria-label={done ? dt("Вернуть в работу", "Reopen") : dt("Готово", "Done")}
              onClick={() => run(() => updateTask(k.id, { status: done ? "open" : "done" }))}
              className={cn(
                "flex size-[16px] shrink-0 items-center justify-center rounded-full border-[1.6px]",
                done ? "border-status-done bg-status-done text-white" : "border-ink-mute hover:border-primary",
              )}
            >
              {done && <RoyIcon name="check" size={10} strokeWidth={2.6} />}
            </button>
            <span className={cn("min-w-0 flex-1 truncate", done ? "text-ink-mute line-through" : "text-ink")}>{k.title}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => updateTask(k.id, { parent_id: null }))}
              className="shrink-0 text-ink-mute opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              style={{ fontSize: 12 }}
            >
              {dt("Отвязать", "Detach")}
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 py-1.5">
        <RoyIcon name="plus" size={14} className="shrink-0 text-ink-mute" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={add}
          disabled={busy}
          placeholder={dt("Новая подзадача — Enter", "New subtask — Enter")}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
          style={{ fontSize: 13.5 }}
        />
        {candidates.length > 0 && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="shrink-0 text-accent-ink hover:underline"
            style={{ fontSize: 12.5 }}
          >
            {dt("Привязать существующую", "Link existing")}
          </button>
        )}
      </div>
      {picking && (
        <select
          autoFocus
          defaultValue=""
          disabled={busy}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            setPicking(false);
            run(() => updateTask(id, { parent_id: task.id }));
          }}
          className="mt-1 w-full rounded-[7px] border border-line bg-surface px-2 py-1.5 text-ink"
          style={{ fontSize: 13 }}
        >
          <option value="">{dt("Выберите задачу этого проекта…", "Pick a task from this project…")}</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
      {error && <p className="mt-1 text-pri-high" style={{ fontSize: 12.5 }}>{error}</p>}
    </div>
  );
}
