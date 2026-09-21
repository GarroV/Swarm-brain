"use client";
import { useCallback, useState } from "react";
import { dropSide } from "@/lib/projectOrder";
import type { DropTarget } from "@/lib/projectOrder";
import type { Project } from "@/types";

// Перетаскивание проектов на доске (issue #433): перестановка строк по порядку и перенос
// подпроекта в другой проект (#30, поведение сохранено). Нативный HTML5-DnD — тот же приём, что
// у карточек задач в TaskKanban; отдельной библиотеки ради двух списков в проекте нет.
//
// Логика вынесена из SprintBoard.tsx: тот уже 600+ строк при пределе 800 (issue #265), а здесь
// одно связное состояние (что тащим, куда встанет, какой контейнер подсвечен) и три биндера
// пропсов. Сами запросы к API остаются в доске — хук только говорит, ЧТО произошло.

/** Ось, вдоль которой выстроен список: плитки идут в ряд, секции и подпроекты — сверху вниз. */
export type DndAxis = "x" | "y";

type Handlers = {
  /** Строка `movedId` встаёт до/после строки `target.id`. */
  reorder: (movedId: string, target: DropTarget) => void;
  /** Подпроект переносится в другой проект верхнего уровня (в конец его списка). */
  moveInto: (kidId: string, parentId: string) => void;
};

type DragProps = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

type DropProps = {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
};

export function useProjectDnd(projects: Project[], handlers: Handlers) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropTarget | null>(null);
  const [overProject, setOverProject] = useState<string | null>(null);

  const isTop = useCallback(
    (id: string) => !projects.find((p) => p.id === id)?.parent_id,
    [projects],
  );
  const reset = useCallback(() => {
    setDragId(null);
    setHint(null);
    setOverProject(null);
  }, []);

  /** Ручка перетаскивания: вешается на заголовок проекта или подпроекта. */
  const dragProps = useCallback((id: string, enabled = true): DragProps => ({
    draggable: enabled,
    onDragStart: (e) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      // Некоторые браузеры не начинают перетаскивание без полезной нагрузки.
      e.dataTransfer.setData("text/plain", id);
      e.stopPropagation();
    },
    onDragEnd: reset,
  }), [reset]);

  /**
   * Строка как цель: перестановка внутри своего уровня, а для проекта верхнего уровня — ещё и
   * приём подпроекта внутрь (перенос). Уровни не смешиваются: проект не кладётся в подпроекты,
   * подпроект встаёт в верхний уровень только через перенос в конкретный проект.
   */
  const dropProps = useCallback(
    (target: Project, axis: DndAxis): DropProps => ({
      onDragOver: (e) => {
        if (!dragId || dragId === target.id) return;
        const sameLevel = isTop(dragId) === !target.parent_id;
        const acceptsChild = !isTop(dragId) && !target.parent_id;
        if (!sameLevel && !acceptsChild) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (sameLevel) {
          const r = e.currentTarget.getBoundingClientRect();
          const place = axis === "x"
            ? dropSide(r.left, r.width, e.clientX)
            : dropSide(r.top, r.height, e.clientY);
          setHint({ id: target.id, place });
          setOverProject(null);
        } else {
          setOverProject(target.id);
          setHint(null);
        }
      },
      onDragLeave: () => {
        setHint((h) => (h?.id === target.id ? null : h));
        setOverProject((p) => (p === target.id ? null : p));
      },
      onDrop: (e) => {
        if (!dragId) return;
        e.preventDefault();
        e.stopPropagation();
        const moved = dragId;
        if (isTop(moved) === !target.parent_id) {
          const r = e.currentTarget.getBoundingClientRect();
          const place = axis === "x"
            ? dropSide(r.left, r.width, e.clientX)
            : dropSide(r.top, r.height, e.clientY);
          handlers.reorder(moved, { id: target.id, place });
        } else if (!target.parent_id) {
          handlers.moveInto(moved, target.id);
        }
        reset();
      },
    }),
    [dragId, isTop, handlers, reset],
  );

  /** Подсветка места вставки: полоса у той грани строки, к которой она встанет. */
  const hintShadow = useCallback(
    (id: string, axis: DndAxis): string | undefined => {
      if (hint?.id !== id) return undefined;
      const offset = hint.place === "before" ? 3 : -3;
      return axis === "x"
        ? `inset ${offset}px 0 0 0 var(--primary)`
        : `inset 0 ${offset}px 0 0 var(--primary)`;
    },
    [hint],
  );

  return {
    /** Что тащим прямо сейчас (null — ничего). */
    dragId,
    /** Проект, подсвеченный как приёмник подпроекта. */
    overProject,
    dragProps,
    dropProps,
    hintShadow,
  };
}
