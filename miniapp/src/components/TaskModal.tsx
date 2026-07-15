"use client";
import { useState, useEffect } from "react";
import type { Task, User } from "@/types";
import { displayName } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
import {
  type CreateTaskInput,
  type UpdateTaskInput,
  createTask,
  updateTask,
  deleteTask,
  fetchUsers,
} from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { Segmented } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";

const TASK_ROLES = [
  { value: "marketing", label: "Marketing" },
  { value: "bd", label: "BD" },
  { value: "rnd", label: "R&D" },
];

const STATUSES = [
  { id: "open", label: "Открыто" },
  { id: "in_progress", label: "В работе" },
  { id: "done", label: "Готово" },
];
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Sentinel for the assignee/role selects — empty string is not a valid select value
const NONE = "__none__";

// Roy-стилизованные нативные контролы (без shadcn): стекло + линия + янтарный фокус.
const fieldCls =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute dark:backdrop-blur-sm";
const labelCls = "mb-1.5 block font-semibold text-ink-soft";

interface TaskModalProps {
  task?: Task;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskModal({ task, open, onClose, onSaved }: TaskModalProps) {
  const isEdit = !!task;
  const confirm = useConfirm();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("open");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [country, setCountry] = useState("");
  const [taskRole, setTaskRole] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  // Исходный исполнитель: чтобы при правке других полей не затирать его (PATCH шлём только при изменении).
  const [initialAssignee, setInitialAssignee] = useState(NONE);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setStatus(normStatus(task?.status));
    setDescription(task?.description ?? "");
    setDueDate(task?.due_date ?? "");
    setCountry(task?.country ?? "");
    setTaskRole(task?.task_role ?? NONE);
    const cur = task?.assignee_telegram_ids?.[0]?.toString() ?? NONE;
    setAssigneeId(cur);
    setInitialAssignee(cur);
    setError(null);
    fetchUsers().then(setUsers).catch(() => {});
  }, [open, task]);

  // Опции исполнителя = пользователи воркспейса + текущий исполнитель, если его нет в списке
  // (иначе select не показал бы его, а сохранение затёрло бы назначение).
  const assigneeOptions: { id: string; name: string }[] = [
    ...users.map((u) => ({ id: u.telegram_id.toString(), name: displayName(u.name) })),
  ];
  if (assigneeId !== NONE && !assigneeOptions.some((o) => o.id === assigneeId)) {
    const curName = task?.assignees?.[0];
    assigneeOptions.unshift({
      id: assigneeId,
      name: curName && !/^\d+$/.test(curName) ? curName : `#${assigneeId}`,
    });
  }

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Нужно название");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        country: country.trim() || null,
        task_role: taskRole === NONE ? null : taskRole,
      };
      const assigneeValue = assigneeId === NONE ? null : parseInt(assigneeId, 10);
      if (isEdit && task) {
        // Исполнителя шлём только если поменяли — иначе правка других полей затёрла бы
        // назначение, которое нельзя было префиллить (имя без telegram_id).
        const fields: UpdateTaskInput = { ...base, status };
        if (assigneeId !== initialAssignee) fields.assignee_telegram_id = assigneeValue;
        await updateTask(task.id, fields);
      } else {
        const fields: CreateTaskInput = { ...base, assignee_telegram_id: assigneeValue };
        await createTask(fields);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!(await confirm({ title: `Удалить «${task.title}»?`, description: "Задача будет удалена без возможности восстановления." }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const busy = saving || deleting;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 rounded-[20px] border border-line bg-[var(--popover)] p-0 sm:max-w-3xl dark:backdrop-blur-xl"
      >
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-bold text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {isEdit ? "Изменить задачу" : "Новая задача"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex items-center justify-center rounded-[10px] p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <RoyIcon name="x" size={18} />
          </button>
        </div>

        {/* Поля — две колонки: слева название + большое поле редактуры, справа настройки */}
        <div className="max-h-[74vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-[1.4fr_1fr]">
            {/* Левая колонка: название + редактура */}
            <div className="flex flex-col gap-3.5">
              <div>
                <label htmlFor="modal-title" className={labelCls} style={{ fontSize: 12.5 }}>Название *</label>
                <input
                  id="modal-title"
                  className={fieldCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название задачи"
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <label htmlFor="modal-desc" className={labelCls} style={{ fontSize: 12.5 }}>Описание</label>
                <textarea
                  id="modal-desc"
                  className={`${fieldCls} flex-1 resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Подробности, контекст, что именно сделать…"
                  style={{ minHeight: 280, lineHeight: 1.6 }}
                />
              </div>
            </div>

            {/* Правая колонка: настройки */}
            <div className="flex flex-col gap-3.5">
              {isEdit && (
                <div>
                  <span className={labelCls} style={{ fontSize: 12.5 }}>Статус</span>
                  <Segmented items={STATUSES} value={status} onChange={setStatus} />
                </div>
              )}

              <div>
                <label htmlFor="modal-due" className={labelCls} style={{ fontSize: 12.5 }}>Срок</label>
                <DatePicker value={dueDate} onChange={setDueDate} className={fieldCls} placeholder="Срок" />
              </div>

              <div>
                <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12.5 }}>Роль</label>
                <select id="modal-role" className={fieldCls} value={taskRole} onChange={(e) => setTaskRole(e.target.value)}>
                  <option value={NONE}>— Нет —</option>
                  {TASK_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="modal-country" className={labelCls} style={{ fontSize: 12.5 }}>Страна</label>
                <input id="modal-country" className={fieldCls} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="напр. KZ, PL" />
              </div>

              <div>
                <label htmlFor="modal-assignee" className={labelCls} style={{ fontSize: 12.5 }}>Исполнитель</label>
                <select id="modal-assignee" className={fieldCls} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value={NONE}>— Нет —</option>
                  {assigneeOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && <p className="mt-3 font-semibold" style={{ fontSize: 13, color: "var(--pri-high)" }}>{error}</p>}
        </div>

        {/* Действия */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          {isEdit ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-[12px] px-3 py-2 font-semibold transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14, color: "var(--pri-high)" }}
            >
              {deleting ? "Удаление…" : "Удалить"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-[12px] border border-line bg-surface px-4 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-[12px] bg-primary px-4 py-2 font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
