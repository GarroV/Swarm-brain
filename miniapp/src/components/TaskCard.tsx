"use client";
import type { Task } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { displayName } from "@/lib/utils";
import { Mic, Bot, PenLine, Smartphone, User, Calendar, Globe, type LucideIcon } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  marketing: "Маркетинг",
  bd: "BD",
  rnd: "R&D",
};

const SOURCE_META: Record<string, { Icon: LucideIcon; label: string }> = {
  transcript: { Icon: Mic, label: "Транскрипт" },
  claude: { Icon: Bot, label: "Claude" },
  manual: { Icon: PenLine, label: "Вручную" },
  mini_app: { Icon: Smartphone, label: "Mini App" },
};

const STATUS_ACTIONS: Record<
  string,
  Array<{ label: string; next: string; variant?: "outline" | "ghost" }>
> = {
  open: [{ label: "В работу", next: "in_progress", variant: "outline" }],
  in_progress: [
    { label: "В ожидание", next: "open", variant: "ghost" },
    { label: "Готово", next: "done", variant: "outline" },
  ],
  done: [{ label: "Вернуть", next: "in_progress", variant: "ghost" }],
};

interface TaskCardProps {
  task: Task;
  onEdit: () => void;
  onStatusChange: (newStatus: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function TaskCard({ task, onEdit, onStatusChange, onDelete }: TaskCardProps) {
  const actions = STATUS_ACTIONS[task.status] ?? [];
  const src = SOURCE_META[task.source];

  let createdAt: string | null = null;
  if (task.created_at) {
    const d = new Date(task.created_at);
    if (!isNaN(d.getTime())) createdAt = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  const handleDelete = async () => {
    if (window.confirm(`Удалить «${task.title}»?`)) {
      await onDelete();
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-sm leading-snug">{task.title}</h3>
          {task.task_role && (
            <Badge variant="outline" className="shrink-0 text-xs">
              {ROLE_LABELS[task.task_role] ?? task.task_role}
            </Badge>
          )}
        </div>

        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
        )}

        {(src || task.created_by_name || createdAt) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {src && <src.Icon className="w-3.5 h-3.5 shrink-0" />}
            <span>{[src?.label, task.created_by_name, createdAt].filter(Boolean).join(" · ")}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.assignees.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> {task.assignees.map(displayName).join(", ")}
            </span>
          )}
          {task.due_date && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> {task.due_date}
            </span>
          )}
          {task.country && (
            <span className="inline-flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> {task.country}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map(({ label, next, variant }) => (
            <Button
              key={next}
              size="sm"
              variant={variant ?? "outline"}
              className="text-xs h-7"
              onClick={() => onStatusChange(next)}
            >
              {label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={onEdit}>
            Изменить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            Удалить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
