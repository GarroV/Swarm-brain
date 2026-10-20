"use client";
import { useState } from "react";
import { useDashboardData } from "./dash/useDashboardData";
import { ProjectMapButton } from "./dash/ProjectMapButton";
import { HomeGrid } from "./home/HomeGrid";
import { NotificationsBell } from "./NotificationsBell";
import { ROY_TYPE, SHELL_BAR_H } from "./ui";
import { useDt, useRoyNav } from "./nav";
import { HeaderNotice } from "./DeployNoticeBar";
import { TaskModal } from "@/components/TaskModal";
import type { TaskDraft } from "@/lib/homeInspections";

// Главная (десктоп) — сборная из виджетов: docs/decisions/2026-10-07-home-dashboard-direction.md.
// Каждый собирает её сам (home/HomeGrid.tsx, раскладка — lib/homeLayout.ts); по умолчанию сверху
// доска стикеров, под ней колонки: РКО и РС слева, созвоны и ближайшие задачи справа; дальше пиццерии.
// Прежние таблицы «Мои задачи» / «Задачи команды», «Новости» и «Последнее в базе» (стенд
// 24.09.2026) остались виджетами каталога. Поиска на главной нет — он один, слева (RailSearch). На мобайле экран не рендерится.

export function RoyDashboard() {
  const data = useDashboardData();
  const { bumpTasks } = useRoyNav();
  const [creating, setCreating] = useState(false);
  // Черновик задачи из проверки (виджет «Проверки»): только заполняет форму, сохраняет человек.
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HomeHeader editing={editing} onEdit={() => setEditing(true)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <HomeGrid data={data} onCreateTask={() => { setDraft(null); setCreating(true); }} onCreateTaskFrom={(d) => { setDraft(d); setCreating(true); }} editing={editing} onEditing={setEditing} />
      </div>
      {/* Быстрое создание задачи с главной — окно поверх, без ухода на доску. */}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={bumpTasks} prefill={draft ?? undefined} />
    </div>
  );
}

// Шапка главной: заголовок, плашка и инструменты. Поля поиска здесь нет: поиск один, в левой
// колонке (решение владельца 19.10.2026, docs/decisions/2026-10-19-search-and-2fa-deadline.md §1).
function HomeHeader({ editing, onEdit }: { editing: boolean; onEdit: () => void }) {
  const dt = useDt();
  return (
    // relative z-30: окна шапки — поверх содержимого экрана (#487).
    <div className="relative z-30 flex shrink-0 items-center gap-3 border-b border-line px-6" style={{ height: SHELL_BAR_H }}>
      <h1 className="leading-[1.1]" style={ROY_TYPE.pageTitle}>{dt("Главная", "Home")}</h1>
      {/* Плашка берёт всё свободное место между заголовком и кнопками и держит себя по центру. */}
      <HeaderNotice />
      <div className="flex shrink-0 items-center gap-2">
        {/* Настройка главной: виджеты и «Мои страны» (решение 07.10.2026). */}
        <button type="button" onClick={onEdit} disabled={editing} aria-pressed={editing}
          className="flex h-[32px] items-center gap-1.5 rounded-[8px] border border-line-2 bg-surface px-2.5 font-semibold text-ink-soft hover:border-accent-line hover:text-primary disabled:border-primary disabled:text-primary"
          style={{ fontSize: 12.5 }}>
          <span aria-hidden="true">⚙</span>{dt("Настроить главную", "Customize home")}
        </button>
        <NotificationsBell />
        <ProjectMapButton />
      </div>
    </div>
  );
}
