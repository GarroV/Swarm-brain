"use client";
import type { Task } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ROLE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  bd: "BD",
  rnd: "R&D",
};

const STATUS_ACTIONS: Record<
  string,
  Array<{ label: string; next: string; variant?: "outline" | "ghost" }>
> = {
  open: [{ label: "→ In Progress", next: "in_progress", variant: "outline" }],
  in_progress: [
    { label: "→ Done", next: "done", variant: "outline" },
    { label: "← Open", next: "open", variant: "ghost" },
  ],
  done: [{ label: "← Reopen", next: "in_progress", variant: "ghost" }],
};

interface TaskCardProps {
  task: Task;
  onEdit: () => void;
  onStatusChange: (newStatus: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function TaskCard({ task, onEdit, onStatusChange, onDelete }: TaskCardProps) {
  const actions = STATUS_ACTIONS[task.status] ?? [];

  const handleDelete = async () => {
    if (window.confirm(`Delete "${task.title}"?`)) {
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
          <p className="text-xs text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.assignees.length > 0 && (
            <span>👤 {task.assignees.join(", ")}</span>
          )}
          {task.due_date && <span>📅 {task.due_date}</span>}
          {task.country && <span>🌍 {task.country}</span>}
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
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
