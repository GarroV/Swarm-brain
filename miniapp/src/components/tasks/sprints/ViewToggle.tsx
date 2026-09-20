"use client";
import { useEffect, useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Список и канбан — два вида одного состава. Выбор запоминается у человека (решение
// владельца: «Список + канбан переключателем»): вид — это привычка смотреть, и сбрасывать
// его на каждом заходе значит переключать вручную по десять раз в день.

export type SprintView =
  | "list"
  | "kanban"
  | "analytics"
  | "journal";

const KEY = "swarm.sprints.view";

/**
 * Запомненный вид. Читается в эффекте, а не при инициализации состояния: на сервере
 * `localStorage` нет, и разный первый рендер ломает гидрацию Next.
 * Доступ в try/catch — в приватном окне обращение к хранилищу кидает.
 */
export function useSprintView(): [SprintView, (v: SprintView) => void] {
  const [view, setView] = useState<SprintView>("list");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Снятые виды: «Сверка» (19.09.2026, отметки переехали в строку списка) и «Инициативы»
      // (19.09.2026, владелец: «вообще не ясно что это такое, надо убрать пункт»). У кого они
      // остались запомненными — открывается список, а не пустой экран.
      if (saved === "check" || saved === "initiatives") setView("list");
      else if (
        saved === "list" || saved === "kanban" ||
        saved === "analytics" || saved === "journal"
      ) {
        setView(saved);
      }
    } catch {
      /* приватное окно: вид останется списком, это рабочее состояние */
    }
  }, []);

  const choose = (v: SprintView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch { /* не запомнили — не беда, экран уже переключён */ }
  };

  return [view, choose];
}

export function ViewToggle(
  { value, onChange, kanbanDisabled = false }: {
    value: SprintView;
    onChange: (v: SprintView) => void;
    kanbanDisabled?: boolean;
  },
) {
  const dt = useDt();
  const views: {
    id: SprintView;
    icon: "task" | "board" | "timeline" | "clock";
    label: string;
  }[] = [
    { id: "list", icon: "task", label: dt("Список", "List") },
    { id: "kanban", icon: "board", label: dt("Канбан", "Kanban") },
    // Аналитика — тоже про пространство: семь таблиц по всем его спринтам.
    { id: "analytics", icon: "timeline", label: dt("Аналитика", "Analytics") },
    { id: "journal", icon: "clock", label: dt("Журнал", "Journal") },
  ];

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 dark:backdrop-blur-sm">
      {views.map((v) => {
        // Канбан на телефоне не работает: перетаскивание пальцем по трём колонкам
        // нечитаемо (D003). Кнопку показываем отключённой и подписываем причину —
        // молча пропавший переключатель выглядит поломкой.
        const off = kanbanDisabled && v.id === "kanban";
        const active = value === v.id;
        return (
          <button
            key={v.id}
            type="button"
            disabled={off}
            onClick={() => onChange(v.id)}
            title={off
              ? dt("Канбан — только на компьютере", "Kanban is desktop only")
              : v.label}
            aria-pressed={active}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : off
                ? "text-ink-soft/40"
                : "text-ink-soft hover:bg-surface-2"
            }`}
          >
            <RoyIcon name={v.icon} size={12} strokeWidth={2} />
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Группировка списка: по инициативам (как работают) или по людям (как обходят на встрече).
 * Жила отдельным экраном «Сверка», пока отметки не переехали в строку (владелец
 * 19.09.2026): один состав, две линзы — это переключатель, а не второй экран.
 */
export type SprintGrouping = "initiatives" | "people";

const GKEY = "swarm.sprints.grouping";

export function useSprintGrouping(): [
  SprintGrouping,
  (v: SprintGrouping) => void,
] {
  const [grouping, setGrouping] = useState<SprintGrouping>("initiatives");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GKEY);
      if (saved === "initiatives" || saved === "people") setGrouping(saved);
    } catch { /* приватное окно: останется группировка по инициативам */ }
  }, []);

  const choose = (v: SprintGrouping) => {
    setGrouping(v);
    try {
      localStorage.setItem(GKEY, v);
    } catch { /* не запомнили — не беда */ }
  };

  return [grouping, choose];
}

export function GroupingToggle(
  { value, onChange }: {
    value: SprintGrouping;
    onChange: (v: SprintGrouping) => void;
  },
) {
  const dt = useDt();
  const opts: { id: SprintGrouping; label: string }[] = [
    { id: "initiatives", label: dt("по инициативам", "by initiative") },
    { id: "people", label: dt("по людям", "by person") },
  ];
  return (
    <div className="mb-2 flex items-center gap-1 px-0.5">
      <span className="mr-1 text-[11px] text-ink-soft">
        {dt("группировать:", "group:")}
      </span>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            value === o.id
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-line bg-surface text-ink-soft hover:bg-surface-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
