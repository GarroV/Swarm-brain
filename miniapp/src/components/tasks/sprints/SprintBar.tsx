"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Sprint, SprintCycle, SprintCycleDetail } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import {
  Menu,
  type MenuItem,
  ToolbarButton,
} from "@/components/tasks/table/Menu";
import { daysLeft, fmtDay, fmtRange } from "./format";
import type { SprintView } from "./ViewToggle";

// Полоса спринта — ОДНА строка (стенд: screens-work.js → sprintBar): пространство, спринт,
// даты, вид, набор состава, правка; справа действие по состоянию. Кнопки и меню — общие с
// таблицей задач (table/Menu.tsx), чтобы два экрана не разъезжались в мелочах.

const SPACE_NONE = "__no_space__"; // «Без пространства» — законное значение, а не пустота

export type SprintBarProps = {
  /** Меню пространств (SpaceSwitcher) — первым: сперва «какой проект», потом «какой спринт». */
  spaceMenu: ReactNode;
  live: SprintCycle[];
  archive: SprintCycle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  detail: SprintCycleDetail | null;
  /** Вкладка «Спринт»: на «Аналитике» и «Журнале» вид, состав и приёмка не нужны. */
  sprintTab: boolean;
  view: SprintView;
  onView: (v: SprintView) => void;
  kanbanDisabled: boolean;
  poolCount: number;
  onPool?: () => void;
  editMode: boolean;
  onEditMode: () => void;
  busy: boolean;
  onNewSprint?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  /** Перенос спринта в другое пространство (#397) — только в режиме правки. */
  move?: { spaces: Sprint[]; onMove: (tabId: string | null) => void };
  onStart: () => void;
  onAccept: () => void;
  reportOpen: boolean;
  onReport: () => void;
  /** Поле переименования, когда оно открыто: встаёт на место имени. */
  renameField?: ReactNode;
};

export function SprintBar(p: SprintBarProps) {
  const dt = useDt();
  const d = p.detail;
  const accepted = d?.status === "accepted";
  const stLabel = (c: SprintCycle) =>
    c.status === "active"
      ? dt("идёт", "running")
      : c.status === "draft"
      ? dt("черновик", "draft")
      : dt("принят", "accepted");

  // Живые — сверху, принятые — архивом с датами (их со временем станет много).
  const items: MenuItem[] = [
    ...p.live.map((c) => ({
      key: c.id,
      label: (
        <>
          {c.name} <span className="text-ink-mute">· {stLabel(c)}</span>
        </>
      ),
      on: c.id === p.selectedId,
      action: true,
      onPick: () => p.onSelect(c.id),
    })),
    ...[...p.archive].sort((a, b) => b.start_date.localeCompare(a.start_date))
      .map((c) => ({
        key: c.id,
        label: (
          <>
            {c.name}{" "}
            <span className="text-ink-mute">
              · {fmtRange(c.start_date, c.end_date)}
            </span>
          </>
        ),
        on: c.id === p.selectedId,
        action: true,
        onPick: () => p.onSelect(c.id),
      })),
    ...(p.onNewSprint
      ? [{
        key: "__new__",
        label: (
          <span className="text-accent-ink">
            {dt("＋ Новый спринт", "＋ New sprint")}
          </span>
        ),
        action: true,
        onPick: p.onNewSprint,
      }]
      : []),
    ...(p.onRename
      ? [{
        key: "__rename__",
        label: dt("Переименовать", "Rename"),
        action: true,
        onPick: p.onRename,
      }]
      : []),
    ...(p.onDelete
      ? [{
        key: "__del__",
        label: (
          <span className="text-pri-high">
            {dt("Удалить спринт", "Delete sprint")}
          </span>
        ),
        action: true,
        onPick: p.onDelete,
      }]
      : []),
  ];

  const left = d ? daysLeft(d.end_date) : 0;
  // «Принять» — действие раз в две недели и необратимое: пока спринт идёт, кнопка тихая и
  // разгорается, когда срок вышел (стенд: `over`).
  const over = d?.status === "active" && left < 1;

  const moveItems: MenuItem[] = p.move
    ? [
      ...p.move.spaces.map((sp) => ({
        key: sp.id,
        label: sp.name,
        on: d?.tab_id === sp.id,
        action: true,
        onPick: () => p.move!.onMove(sp.id),
      })),
      {
        key: SPACE_NONE,
        label: dt("Без пространства", "No space"),
        on: !d?.tab_id,
        action: true,
        onPick: () => p.move!.onMove(null),
      },
    ]
    : [];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2 lg:px-5">
      {p.spaceMenu}
      {p.renameField ?? (items.length > 0 && (
        <Menu
          label={d
            ? (
              <span className="text-ink">
                {d.name} <span className="text-ink-mute">· {stLabel(d)}</span>
              </span>
            )
            : dt("Спринт", "Sprint")}
          items={items}
        />
      ))}
      {p.move && moveItems.length > 0 && (
        <Menu label={dt("Перенести в…", "Move to…")} items={moveItems} />
      )}
      {d && (
        <span
          className="mx-1 whitespace-nowrap font-mono text-ink-soft"
          style={{ fontSize: 12 }}
          title={d.status === "active" && left >= 0
            ? dt(`осталось ${left} дн.`, `${left} day(s) left`)
            : undefined}
        >
          {fmtRange(d.start_date, d.end_date)}
          {d.check_date && !accepted && (
            <span className="text-ink-mute">
              · {dt("сверка", "check")} {fmtDay(d.check_date)}
            </span>
          )}
          {
            /* Сколько осталось — в подсказке: полоса одна строка, а в строку это не влезало.
              Просрочка — вслух: это сигнал, а не справка. */
          }
          {d.status === "active" && left < 0 && (
            <span className="text-pri-high">
              {" · "}
              {dt(`просрочен на ${-left} дн.`, `${-left} day(s) overdue`)}
            </span>
          )}
          {accepted && d.accepted_at && (
            <span className="text-ink-mute">
              · {dt("принят", "accepted")} {fmtDay(d.accepted_at)}
            </span>
          )}
        </span>
      )}

      {p.sprintTab && d && (
        <>
          {/* Вид запоминается у человека; канбан — только на компьютере (D003). */}
          <span className="inline-flex overflow-hidden rounded-[8px] border border-line-2 bg-surface">
            {(["list", "kanban"] as const).map((v) => {
              const off = v === "kanban" && p.kanbanDisabled;
              const on = p.view === v;
              return (
                <button
                  key={v}
                  type="button"
                  disabled={off}
                  aria-pressed={on}
                  onClick={() => p.onView(v)}
                  title={off
                    ? dt(
                      "Канбан — только на компьютере",
                      "Kanban is desktop only",
                    )
                    : undefined}
                  className={cn(
                    "h-[28px] border-r border-line-2 px-3 font-medium transition-colors last:border-r-0",
                    on
                      ? "bg-primary font-semibold text-white"
                      : off
                      ? "text-ink-mute"
                      : "text-ink-soft hover:bg-surface-2",
                  )}
                  style={{ fontSize: 12.5 }}
                >
                  {v === "list" ? dt("Список", "List") : dt("Канбан", "Kanban")}
                </button>
              );
            })}
          </span>
          {p.onPool && (
            <ToolbarButton
              onClick={p.onPool}
              title={dt(
                "Взять задачи из бэклога",
                "Take tasks from the backlog",
              )}
            >
              <RoyIcon name="plus" size={12} strokeWidth={2} />
              {dt("Набрать состав", "Pick tasks")}
              <span className="font-mono text-ink-mute">{p.poolCount}</span>
            </ToolbarButton>
          )}
          {
            /* Режим правки: вне его доска только читается — никаких «+», «✎», «✕». Ежедневные
              отметки он НЕ прячет. */
          }
          <ToolbarButton
            on={p.editMode}
            onClick={p.onEditMode}
            title={dt(
              "Показать кнопки правки: завести, переименовать, удалить",
              "Show editing controls: create, rename, delete",
            )}
          >
            <RoyIcon name="pencil" size={12} strokeWidth={2} />
            {dt("Правка", "Edit")}
          </ToolbarButton>
        </>
      )}
      {!d && p.sprintTab && (
        <ToolbarButton on={p.editMode} onClick={p.onEditMode}>
          <RoyIcon name="pencil" size={12} strokeWidth={2} />
          {dt("Правка", "Edit")}
        </ToolbarButton>
      )}

      {p.sprintTab && d && (
        <div className="ml-auto flex items-center gap-2">
          {d.status === "draft" && (
            <button
              type="button"
              onClick={p.onStart}
              disabled={p.busy}
              className="h-[30px] rounded-[7px] bg-primary px-3 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              style={{ fontSize: 12.5 }}
            >
              {dt("Начать спринт", "Start sprint")}
            </button>
          )}
          {d.status === "active" && (
            <button
              type="button"
              onClick={p.onAccept}
              disabled={p.busy}
              className={cn(
                "h-[30px] rounded-[7px] border px-3 font-semibold transition-colors disabled:opacity-50",
                over
                  ? "border-primary bg-primary text-white"
                  : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
              style={{ fontSize: 12.5 }}
            >
              {over
                ? dt("Спринт закончился — принять", "Sprint is over — accept")
                : dt("Принять спринт", "Accept sprint")}
            </button>
          )}
          {accepted && (
            <ToolbarButton on={p.reportOpen} onClick={p.onReport}>
              {p.reportOpen
                ? dt("Скрыть отчёт", "Hide report")
                : dt("Открыть отчёт", "Open report")}
            </ToolbarButton>
          )}
        </div>
      )}
    </div>
  );
}
