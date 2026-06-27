"use client";
import { useState, useEffect } from "react";
import type { Task, User } from "@/types";
import { displayName } from "@/lib/utils";
import {
  type CreateTaskInput,
  type UpdateTaskInput,
  createTask,
  updateTask,
  deleteTask,
  fetchUsers,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TASK_ROLES = [
  { value: "marketing", label: "Marketing" },
  { value: "bd", label: "BD" },
  { value: "rnd", label: "R&D" },
];

const STATUSES = [
  { value: "open", label: "Открыто" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Готово" },
];
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Sentinel for shadcn Select — empty string is not a valid Select value
const NONE = "__none__";

interface TaskModalProps {
  task?: Task;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskModal({ task, open, onClose, onSaved }: TaskModalProps) {
  const isEdit = !!task;

  const [title, setTitle] = useState("");
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
  // (иначе Select не показал бы его, а сохранение затёрло бы назначение).
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
        const fields: UpdateTaskInput = { ...base };
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
    if (typeof window !== "undefined" && !window.confirm(`Удалить «${task.title}»?`)) return;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Изменить задачу" : "Новая задача"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="modal-title">Название *</Label>
            <Input
              id="modal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название задачи"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="modal-desc">Описание</Label>
            <Textarea
              id="modal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Необязательное описание"
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="modal-due">Срок</Label>
            <Input
              id="modal-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Роль</Label>
            <Select value={taskRole} onValueChange={(v) => setTaskRole(v ?? NONE)}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите роль" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Нет —</SelectItem>
                {TASK_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="modal-country">Страна</Label>
            <Input
              id="modal-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="напр. KZ, PL"
            />
          </div>

          <div className="space-y-1">
            <Label>Исполнитель</Label>
            <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
              <SelectTrigger>
                {/* подпись рисуем сами: список юзеров грузится асинхронно, и Radix SelectValue
                    показывал сырое value (id / _none_), не обновляясь после подгрузки */}
                <span className="truncate text-left">
                  {assigneeId === NONE
                    ? "— Нет —"
                    : (assigneeOptions.find((o) => o.id === assigneeId)?.name ?? `#${assigneeId}`)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Нет —</SelectItem>
                {assigneeOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={saving || deleting}
              className="text-destructive hover:text-destructive"
            >
              {deleting ? "Удаление…" : "Удалить"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
