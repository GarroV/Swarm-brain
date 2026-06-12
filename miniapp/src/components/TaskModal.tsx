"use client";
import { useState, useEffect } from "react";
import type { Task, User } from "@/types";
import { displayName } from "@/lib/utils";
import {
  type CreateTaskInput,
  createTask,
  updateTask,
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
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setDueDate(task?.due_date ?? "");
    setCountry(task?.country ?? "");
    setTaskRole(task?.task_role ?? NONE);
    setAssigneeId(task?.assignee_telegram_ids?.[0]?.toString() ?? NONE);
    setError(null);
    fetchUsers().then(setUsers).catch(() => {});
  }, [open, task]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Нужно название");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields: CreateTaskInput = {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        country: country.trim() || null,
        task_role: taskRole === NONE ? null : taskRole,
        assignee_telegram_id:
          assigneeId === NONE ? null : parseInt(assigneeId, 10),
      };
      if (isEdit && task) {
        await updateTask(task.id, fields);
      } else {
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
                <SelectValue placeholder="Выберите исполнителя" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Нет —</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.telegram_id} value={u.telegram_id.toString()}>
                    {displayName(u.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
