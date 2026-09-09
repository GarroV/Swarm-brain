"use client";
import type { Task } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Канбан по статусам — ОБЩИЙ компонент доски проектов и экрана спринта. До 09.09.2026 колонки,
// DnD и карточка были вшиты в SprintBoard.tsx; спринту нужен тот же канбан, но с другим набором
// колонок (у доски 4 с «Бэклогом», у спринта 3 — решение владельца 2026-09-08), поэтому набор
// колонок — параметр. Состояние (что тащим, где открыт быстрый ввод) живёт СНАРУЖИ, в экране:
// перетаскивание идёт между колонками разных (под)проектов, то есть общий стейт на весь экран.

export type KanbanColumnDef = { status: string; label: string; bar: string };
export type KanbanDrag = { id: string } | null;
export type KanbanQuickAdd = { section: string; status: string; title: string } | null;

// Ручки экрана-хозяина. Одним объектом, а не семью пропсами: колонки рисуются из трёх мест
// (ряд проекта, общий бэклог группы, пространства подпроектов) — прокидывать пачку по одной
// на каждом вызове шумно и легко разъехаться.
export type KanbanHandlers = {
  drag: KanbanDrag;
  onDragChange: (drag: KanbanDrag) => void;
  /** Карточку бросили в колонку: сменить статус и (при переносе между секциями) проект. */
  onDropTask: (taskId: string, sectionId: string, status: string) => void;
  quickAdd: KanbanQuickAdd;
  onQuickAddChange: (quickAdd: KanbanQuickAdd) => void;
  onQuickAddSubmit: (sectionId: string, status: string, title: string) => void;
  onOpenTask: (task: Task) => void;
};

function fmtDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * Одна статус-колонка: заголовок + быстрый ввод + drop-зона + карточки. Клик по пустому полю
 * колонки создаёт карточку задачи В ЭТОЙ колонке (её статус). badgeFor — бейдж подпроекта.
 * sectionId — id (под)проекта или сентинел «без проекта»: на нём завязаны drop и быстрый ввод.
 */
export function KanbanColumn({ sectionId, column, tasks, badgeFor, kanban }: {
  sectionId: string;
  column: KanbanColumnDef;
  tasks: Task[];
  badgeFor?: (t: Task) => string | undefined;
  kanban: KanbanHandlers;
}) {
  const dt = useDt();
  const { drag, onDragChange, onDropTask, quickAdd, onQuickAddChange, onQuickAddSubmit, onOpenTask } = kanban;
  const adding = quickAdd?.section === sectionId && quickAdd?.status === column.status;
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (drag) { onDropTask(drag.id, sectionId, column.status); onDragChange(null); } }}
      className="w-64 shrink-0 flex flex-col rounded-xl bg-surface-2 border border-line p-2 dark:backdrop-blur-lg">
      {/* «+» в заголовке — надёжный способ добавить задачу независимо от заполненности колонки:
          клик по пустому полю ниже (title="Кликни по пустому полю…") требует, собственно, пустого
          поля — забитая карточками колонка его не оставляет (владелец: «нереально тыкнуть по
          пустому полю, значит и новую задачу не добавить»). Кнопка не заменяет клик по пустому
          месту, а страхует его. */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="size-2.5 rounded-full" style={{ background: column.bar }} />
        <span className="text-xs font-semibold text-ink">{column.label}</span>
        <span className="ml-auto text-xs text-ink-soft">{tasks.length}</span>
        <button
          type="button"
          onClick={() => { if (!adding) onQuickAddChange({ section: sectionId, status: column.status, title: "" }); }}
          className="rounded-full p-0.5 text-ink-soft hover:bg-surface-2 hover:text-ink"
          title={dt("Добавить задачу", "Add task")}
        >
          <RoyIcon name="plus" size={13} strokeWidth={2} />
        </button>
      </div>
      {adding && (
        <input autoFocus value={quickAdd?.title ?? ""}
          onChange={(e) => onQuickAddChange({ section: sectionId, status: column.status, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onQuickAddSubmit(sectionId, column.status, quickAdd?.title ?? ""); if (e.key === "Escape") onQuickAddChange(null); }}
          onBlur={() => onQuickAddSubmit(sectionId, column.status, quickAdd?.title ?? "")}
          placeholder="Новая задача, Enter"
          className="mx-1 mb-1 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary/50" />
      )}
      <div className="flex-1 overflow-y-auto space-y-2 pt-1 min-h-[56px] cursor-text"
        onClick={(e) => { if (e.target === e.currentTarget && !adding) onQuickAddChange({ section: sectionId, status: column.status, title: "" }); }}
        title="Кликни по пустому полю — добавить задачу">
        {tasks.map((t) => {
          const badge = badgeFor?.(t);
          return (
            <div key={t.id} draggable
              onDragStart={(e) => { onDragChange({ id: t.id }); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => onDragChange(null)}
              onClick={(e) => { e.stopPropagation(); onOpenTask(t); }}
              className="rounded-lg bg-card border border-line shadow-sm p-2.5 cursor-pointer hover:border-primary/40 active:cursor-grabbing dark:backdrop-blur-sm">
              {badge && <span className="inline-block mb-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft bg-surface-2 border border-line">{badge}</span>}
              <p className="text-sm font-medium leading-snug text-ink">{t.title}</p>
              <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-soft">
                {t.due_date && <span className="inline-flex items-center gap-1"><RoyIcon name="cal" size={11} /> {fmtDay(t.due_date)}</span>}
                {t.assignees.length > 0 && <span className="ml-auto font-bold">{initials(t.assignees)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Ряд колонок одной секции. tasksForColumn — правило «какие задачи в какой колонке»: по умолчанию
 * точное совпадение статуса, доска же собирает в первую колонку весь бэклог (любой статус вне
 * рабочих трёх).
 */
export function TaskKanban({ sectionId, columns, tasks, tasksForColumn, badgeFor, className, kanban }: {
  sectionId: string;
  columns: readonly KanbanColumnDef[];
  tasks: Task[];
  tasksForColumn?: (column: KanbanColumnDef, tasks: Task[]) => Task[];
  badgeFor?: (t: Task) => string | undefined;
  className?: string;
  kanban: KanbanHandlers;
}) {
  const pick = tasksForColumn ?? ((col, all) => all.filter((t) => t.status === col.status));
  return (
    <div className={className ?? "flex gap-3 p-3 overflow-x-auto"}>
      {columns.map((col) => (
        <KanbanColumn key={col.status} sectionId={sectionId} column={col}
          tasks={pick(col, tasks)} badgeFor={badgeFor} kanban={kanban} />
      ))}
    </div>
  );
}
