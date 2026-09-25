"use client";
import { useEffect, useState } from "react";
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

/**
 * Вкладки раздела (стенд: подчёркнутые табы у заголовка): «Спринт · Аналитика · Журнал».
 * Список и канбан — не вкладки, а вид внутри «Спринта»: переключатель живёт в полосе спринта.
 * Таймлайна здесь нет — решение владельца: спрятан, код не удалён.
 */
export function SprintTabs(
  { value, onChange }: { value: SprintView; onChange: (v: SprintView) => void },
) {
  const dt = useDt();
  const tab = value === "analytics" || value === "journal" ? value : "sprint";
  const tabs: { id: "sprint" | "analytics" | "journal"; label: string }[] = [
    { id: "sprint", label: dt("Спринт", "Sprint") },
    // Аналитика — тоже про пространство: семь таблиц по всем его спринтам.
    { id: "analytics", label: dt("Аналитика", "Analytics") },
    { id: "journal", label: dt("Журнал", "Journal") },
  ];
  return (
    <nav
      className="flex items-stretch gap-0.5 self-stretch"
      aria-label={dt("Вкладки спринтов", "Sprint tabs")}
    >
      {tabs.map((t) => {
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onChange(t.id === "sprint" ? "list" : t.id)}
            className={`-mb-px flex items-center border-b-2 px-2.5 transition-colors ${
              on
                ? "border-primary font-semibold text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
            style={{ fontSize: 13 }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
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
  // Тихий текстовый переключатель (стенд: `.sgrp` + `.lk`): группировка — свойство списка,
  // а не отдельный экран, и кнопками она перетягивала бы внимание с состава.
  return (
    <span
      className="ml-auto flex items-center gap-2.5"
      style={{ fontSize: 12 }}
    >
      <span className="text-ink-mute">{dt("группировать", "group")}</span>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={value === o.id
            ? "font-semibold text-ink underline underline-offset-[3px]"
            : "text-ink-soft hover:text-accent-ink"}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
