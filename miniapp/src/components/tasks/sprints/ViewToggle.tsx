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
  | "check"
  | "initiatives"
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
      if (
        saved === "list" || saved === "kanban" || saved === "check" ||
        saved === "initiatives" || saved === "analytics" ||
        saved === "journal"
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
    icon: "task" | "board" | "check" | "graph" | "timeline" | "clock";
    label: string;
  }[] = [
    { id: "list", icon: "task", label: dt("Список", "List") },
    { id: "kanban", icon: "board", label: dt("Канбан", "Kanban") },
    // Сверка — та же линза на тот же состав, поэтому живёт в переключателе, а не отдельной
    // вкладкой: ритуал идёт по спринту, который сейчас открыт.
    { id: "check", icon: "check", label: dt("Сверка", "Check-in") },
    // «Все инициативы» — вид на ПРОСТРАНСТВО, а не на спринт: здесь видно и то, что в
    // спринт не попало. Стоит в том же ряду, потому что человек переключает не сущность,
    // а то, на что смотрит.
    {
      id: "initiatives",
      icon: "graph",
      label: dt("Инициативы", "Initiatives"),
    },
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
