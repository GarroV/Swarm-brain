"use client";
import { useState } from "react";
import { useDashboardData } from "./dash/useDashboardData";
import { ProjectMapButton } from "./dash/ProjectMapButton";
import { HomeGrid } from "./home/HomeGrid";
import { NotificationsBell } from "./NotificationsBell";
import { RoyIcon } from "./icons";
import { ROY_TYPE } from "./ui";
import { useDt, useRoyNav } from "./nav";
import { saveRecent } from "./screens/SearchScreen";
import { HeaderNotice } from "./DeployNoticeBar";
import { TaskModal } from "@/components/TaskModal";

// Главная (десктоп) — сборная из виджетов: docs/decisions/2026-10-07-home-dashboard-direction.md.
// Каждый собирает её сам (home/HomeGrid.tsx, раскладка — lib/homeLayout.ts); по умолчанию сверху
// созвоны и ближайшие задачи, доска стикеров, РС и РКО по своей подборке стран, пиццерии.
// Прежние таблицы «Мои задачи» / «Задачи команды», «Новости» и «Последнее в базе» (стенд
// 24.09.2026) остались виджетами каталога. Поиск — в шапке. На мобайле экран не рендерится.

export function RoyDashboard() {
  const data = useDashboardData();
  const { bumpTasks } = useRoyNav();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HomeHeader editing={editing} onEdit={() => setEditing(true)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <HomeGrid data={data} onCreateTask={() => setCreating(true)} editing={editing} onEditing={setEditing} />
      </div>
      {/* Быстрое создание задачи с главной — окно поверх, без ухода на доску. */}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={bumpTasks} />
    </div>
  );
}

// Шапка главной: заголовок и поиск по базе (стенд: поиск в шапке вместо поиска посреди главной).
function HomeHeader({ editing, onEdit }: { editing: boolean; onEdit: () => void }) {
  const dt = useDt();
  const { openAnswer } = useRoyNav();
  const [q, setQ] = useState("");
  const go = () => {
    const v = q.trim();
    if (!v) return;
    saveRecent(v);
    openAnswer(v);
  };
  return (
    // relative z-30: окна шапки — поверх содержимого экрана (#487).
    <div className="relative z-30 flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
      <h1 className="leading-[1.1]" style={ROY_TYPE.pageTitle}>{dt("Главная", "Home")}</h1>
      {/* Плашка делит место с поиском: на тесной шапке ужимается поиск (у плашки shrink 0.01), до
          220px, и только потом плашка переносит текст. Раньше поиск (w-full) забирал всё, и плашка
          ломалась на пять строк. */}
      <HeaderNotice flex="flex-[1_0.01_auto]" />
      <form className="ml-auto min-w-[220px] flex-[0_100_380px]" role="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label className="flex h-[32px] items-center gap-2 rounded-[8px] border border-line-2 bg-surface px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-accent-soft">
          <RoyIcon name="spark" size={15} className="shrink-0 text-primary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={dt("Спросить или найти по базе знаний…", "Ask or search your knowledge base…")}
            aria-label={dt("Поиск по базе", "Search the base")}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
            style={{ fontSize: 13 }}
          />
        </label>
      </form>
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
