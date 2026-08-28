"use client";
import type { Task } from "@/types";
import { TaskRow } from "@/components/tasks/TaskRow";
import { SwipeRow } from "./SwipeRow";
import { useDt, useRoyNav } from "./nav";

// Строка задачи в мобильных списках: единый жест во всём приложении — тап открывает карточку,
// свайп влево открывает «Изменить»/«Удалить». Вынесена из RoyTasksScreen, чтобы экран проекта
// не заводил свою копию поведения (иначе жесты разъезжаются между списками — ровно та болезнь,
// что была у встреч с постоянными кнопками в строке).
export function MobileTaskRow({
  task,
  now,
  showAssignee,
  onToggle,
  onSetStatus,
  onRemove,
}: {
  task: Task;
  now?: Date;
  showAssignee?: boolean;
  onToggle: () => void;
  onSetStatus?: (status: string) => void;
  onRemove: () => void;
}) {
  const { push, openTask } = useRoyNav();
  const dt = useDt();
  return (
    <SwipeRow
      onTap={() => openTask(task)}
      actions={[
        { icon: "pencil", label: dt("Изменить", "Edit"), color: "var(--accent-ink)", onClick: () => push({ view: "newTask", params: { id: task.id } }) },
        { icon: "trash", label: dt("Удалить", "Delete"), color: "var(--pri-high)", onClick: onRemove },
      ]}
    >
      <div className="bg-background px-3">
        <TaskRow task={task} now={now} showAssignee={showAssignee} onToggle={onToggle} onSetStatus={onSetStatus} />
      </div>
    </SwipeRow>
  );
}
