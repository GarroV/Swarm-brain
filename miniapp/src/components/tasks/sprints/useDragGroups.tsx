"use client";
import { useCallback, useState } from "react";
import type { Project, Task } from "@/types";
import {
  createProject,
  dissolveSprintGroup,
  updateProject,
  updateTask,
} from "@/lib/api";
import {
  type DropTarget,
  type HoverMode,
  resolveDrop,
} from "@/lib/sprintGrouping";
import { useDt } from "@/components/roy/nav";
import type { RowInfo } from "./useRowDrag";
import { GroupNameDialog } from "./GroupNameDialog";
import { PickTargetDialog } from "./PickTargetDialog";

// Группы спринта на экране спринта (решение 01.10.2026): что делать с броском строки, окно
// названия, кнопки заголовка группы («Переименовать», «В проекты», «Распустить») и запасное окно
// выбора цели для клавиатуры. Вынесено из SprintsScreen — тот и так за 1100 строк.

/** То, что получает список: обработчики броска и кнопок заголовка группы. */
export type GroupingProps = {
  projects: Project[];
  busy: boolean;
  onDrop: (dragged: RowInfo, target: DropTarget, mode: HoverMode) => void;
  /** Запасной путь без перетаскивания: «Сгруппировать с…» / «Сделать подзадачей…». */
  onMenu: (row: RowInfo, rows: RowInfo[]) => void;
  onRename: (group: Project) => void;
  onPromote: (group: Project) => void;
  onDissolve: (group: Project) => void;
};

type Naming =
  | { kind: "create"; dragged: RowInfo; targetTaskId: string; parentId: string | null }
  | { kind: "rename"; group: Project };

export function useDragGroups(
  { projects, tasks, space, reload, onError }: {
    projects: Project[];
    tasks: Task[];
    /** Пространство экрана: группа без проекта встаёт в него, иначе её не видно в спринте. */
    space: string | null;
    reload: () => Promise<void>;
    onError: (message: string | null) => void;
  },
) {
  const dt = useDt();
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [picking, setPicking] = useState<{ row: RowInfo; rows: RowInfo[] } | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      onError(null);
      return true;
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : dt("Не удалось сохранить группу", "Could not save the group"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [dt, onError, reload]);

  // Подзадачи едут за родителем: подзадача живёт в проекте родителя (#478), и группа, забравшая
  // родителя без детей, разорвала бы это правило молча.
  const moveWithKids = useCallback(async (row: RowInfo, projectId: string | null) => {
    // Подзадачу, унесённую в другой проект, отвязываем: в чужом проекте её родителя нет.
    await updateTask(row.taskId, {
      project_id: projectId,
      ...(row.parentId ? { parent_id: null } : {}),
    });
    for (const kid of tasks.filter((t) => t.parent_id === row.taskId)) {
      await updateTask(kid.id, { project_id: projectId });
    }
  }, [tasks]);

  const onDrop = useCallback(
    (dragged: RowInfo, target: DropTarget, mode: HoverMode) => {
      if (busy) return;
      const action = resolveDrop(dragged, target, mode, projects);
      if (action.kind === "none") return;
      if (action.kind === "create") {
        setNaming({
          kind: "create",
          dragged,
          targetTaskId: action.targetTaskId,
          parentId: action.parentId,
        });
        return;
      }
      if (action.kind === "move") {
        void run(() => moveWithKids(dragged, action.projectId));
        return;
      }
      void run(() =>
        updateTask(dragged.taskId, {
          parent_id: action.parentTaskId,
          project_id: action.projectId,
        })
      );
    },
    [busy, moveWithKids, projects, run],
  );

  const submitName = async (name: string) => {
    if (!naming) return;
    if (naming.kind === "rename") {
      if (await run(() => updateProject(naming.group.id, { name }))) setNaming(null);
      return;
    }
    const { dragged, targetTaskId, parentId } = naming;
    const ok = await run(async () => {
      const group = await createProject({
        name,
        parent_id: parentId,
        sprint_group: true,
        ...(parentId ? {} : { sprint_id: space }),
      });
      const target = tasks.find((t) => t.id === targetTaskId);
      await moveWithKids(
        {
          taskId: targetTaskId,
          projectId: target?.project_id ?? null,
          parentId: null,
          hasKids: false,
          title: target?.title ?? "",
          isSubtask: false,
        },
        group.id,
      );
      await moveWithKids(dragged, group.id);
    });
    if (ok) setNaming(null);
  };

  const grouping: GroupingProps = {
    projects,
    busy,
    onDrop,
    onMenu: (row, rows) => setPicking({ row, rows }),
    onRename: (group) => setNaming({ kind: "rename", group }),
    onPromote: (group) => void run(() => updateProject(group.id, { sprint_group: false })),
    onDissolve: (group) => void run(() => dissolveSprintGroup(group.id)),
  };

  const dialogs = (
    <>
      <GroupNameDialog
        open={naming !== null}
        rename={naming?.kind === "rename"}
        initial={naming?.kind === "rename" ? naming.group.name : ""}
        busy={busy}
        onCancel={() => setNaming(null)}
        onSubmit={(name) => void submitName(name)}
      />
      <PickTargetDialog
        open={picking !== null}
        row={picking?.row ?? null}
        rows={picking?.rows ?? []}
        onCancel={() => setPicking(null)}
        onPick={(target, mode) => {
          const row = picking?.row;
          setPicking(null);
          if (row) onDrop(row, target, mode);
        }}
      />
    </>
  );

  return { grouping, dialogs };
}
