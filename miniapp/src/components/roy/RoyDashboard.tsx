"use client";
import { useState } from "react";
import { useDashboardData } from "./dash/useDashboardData";
import { ProjectMapButton } from "./dash/ProjectMapButton";
import { HomeGrid } from "./home/HomeGrid";
import { CockpitHome } from "./home/CockpitHome";
import { NotificationsBell } from "./NotificationsBell";
import { ROY_TYPE, SHELL_BAR_H } from "./ui";
import { useDt, useRoyNav } from "./nav";
import { HeaderNotice } from "./DeployNoticeBar";
import { TaskModal } from "@/components/TaskModal";
import type { TaskDraft } from "@/lib/homeInspections";

// По умолчанию — пульт страны с рабочим днём. Прежняя персональная сетка доступна
// отдельным режимом; её сохранённую раскладку не меняем.

export function RoyDashboard() {
  const data = useDashboardData();
  const { bumpTasks } = useRoyNav();
  const [creating, setCreating] = useState(false);
  // Черновик задачи из проверки (виджет «Проверки»): только заполняет форму, сохраняет человек.
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [customLayout, setCustomLayout] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HomeHeader editing={editing} onEdit={() => setEditing(true)} customLayout={customLayout} onLayout={() => { setEditing(false); setCustomLayout((value) => !value); }} />
      <div className="min-h-0 flex-1 overflow-auto">
        {customLayout ? <HomeGrid data={data} onCreateTask={() => { setDraft(null); setCreating(true); }} onCreateTaskFrom={(d) => { setDraft(d); setCreating(true); }} editing={editing} onEditing={setEditing} />
          : <CockpitHome data={data} onCreateTask={() => { setDraft(null); setCreating(true); }} onCreateTaskFrom={(d) => { setDraft(d); setCreating(true); }} editing={editing} onEditing={setEditing} />}
      </div>
      {/* Быстрое создание задачи с главной — окно поверх, без ухода на доску. */}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={bumpTasks} prefill={draft ?? undefined} />
    </div>
  );
}

// Шапка главной: заголовок, плашка и инструменты. Поля поиска здесь нет: поиск один, в левой
// колонке (решение владельца 19.10.2026, docs/decisions/2026-10-19-search-and-2fa-deadline.md §1).
function HomeHeader({ editing, onEdit, customLayout, onLayout }: { editing: boolean; onEdit: () => void; customLayout: boolean; onLayout: () => void }) {
  const dt = useDt();
  return (
    // relative z-30: окна шапки — поверх содержимого экрана (#487).
    <div className="relative z-30 flex shrink-0 items-center gap-3 border-b border-line px-6" style={{ height: SHELL_BAR_H }}>
      <h1 className="leading-[1.1]" style={ROY_TYPE.pageTitle}>{dt("Главная", "Home")}</h1>
      {/* Плашка берёт всё свободное место между заголовком и кнопками и держит себя по центру. */}
      <HeaderNotice />
      {/* ml-auto: без плашки (обычный день) инструменты всё равно у правого края, а не у заголовка. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={onLayout} aria-pressed={customLayout} className="rounded-lg border border-line-2 px-2 py-1.5 text-[11px] text-ink-soft hover:border-primary hover:text-primary">{customLayout ? dt("Пульт страны", "Country cockpit") : dt("Своя раскладка", "Custom layout")}</button>
        {/* Настройка главной: виджеты и «Мои страны» (решение 07.10.2026). */}
        <button type="button" onClick={onEdit} disabled={editing} aria-pressed={editing} aria-expanded={editing} aria-controls="home-customization"
          title={dt("Выбрать страны, блоки и их расположение", "Choose countries, widgets and their order")}
          className="flex h-[36px] items-center gap-1.5 rounded-[8px] border border-accent-line bg-accent-soft px-3 font-semibold text-primary hover:border-primary disabled:opacity-70"
          style={{ fontSize: 12.5 }}>
          <span aria-hidden="true">⚙</span>{dt("Настроить главную", "Customize home")}
        </button>
        <NotificationsBell />
        <ProjectMapButton />
      </div>
    </div>
  );
}
