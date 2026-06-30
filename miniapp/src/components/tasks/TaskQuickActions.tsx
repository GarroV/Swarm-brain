"use client";
// Быстрые действия в строке задачи: задать СРОК / ИСПОЛНИТЕЛЯ / СТРАНУ без открытия карточки.
// Срок — кастомный DatePicker (compact), исполнитель/страна — QuickPickPopover. Каждый выбор
// сразу шлёт PATCH (updateTask) и просит родителя перезагрузить список (onChanged = r.reload).
import { DatePicker } from "@/components/ui/DatePicker";
import { QuickPickPopover, type PickOption } from "@/components/tasks/QuickPickPopover";
import { COUNTRY_NAMES } from "@/lib/countries";
import { updateTask, type UpdateTaskInput } from "@/lib/api";
import { displayName } from "@/lib/utils";
import type { Task, User } from "@/types";

// Страны — статический список из COUNTRY_NAMES (in-bundle): «Сербия» + код «RS» как подпись.
const COUNTRY_OPTS: PickOption[] = Object.entries(COUNTRY_NAMES).map(([id, label]) => ({ id, label, sub: id }));

const TRIGGER = "flex h-[26px] w-[26px] items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function TaskQuickActions({ task, users, onChanged }: { task: Task; users: User[]; onChanged: () => void }) {
  const commit = async (fields: UpdateTaskInput) => {
    try { await updateTask(task.id, fields); } finally { onChanged(); }
  };

  return (
    <>
      <DatePicker
        compact
        value={task.due_date ?? ""}
        onChange={(iso) => commit({ due_date: iso || null })}
        className={TRIGGER}
        // compact-триггер фиксированного размера, как соседние иконки-кнопки
        placeholder=""
      />
      <QuickPickPopover
        icon="team"
        ariaLabel="Исполнитель"
        clearable
        value={task.assignee_telegram_ids?.[0] != null ? String(task.assignee_telegram_ids[0]) : ""}
        options={users.map((u) => ({ id: String(u.telegram_id), label: displayName(u.name) }))}
        onPick={(id) => commit({ assignee_telegram_id: id ? Number(id) : null })}
      />
      <QuickPickPopover
        icon="globe"
        ariaLabel="Страна"
        filter
        clearable
        value={task.country ?? ""}
        options={COUNTRY_OPTS}
        onPick={(code) => commit({ country: code || null })}
      />
    </>
  );
}
