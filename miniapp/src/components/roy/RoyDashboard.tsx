"use client";
import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types";
import { fetchProjects, fetchTaskLabels, type TaskLabel } from "@/lib/api";
import { groupHome, hiddenCount, HOME_TEAM_LIMIT, homeTeam } from "@/lib/homeTasks";
import { useDashboardData } from "./dash/useDashboardData";
import { HomeLabel } from "./dash/shared";
import { HomeTaskTable } from "./dash/HomeTaskTable";
import { HomeNews, LatestInBase } from "./dash/HomeSide";
import { MeetingsToday } from "./dash/MeetingsToday";
import { ProjectMapButton } from "./dash/ProjectMapButton";
import { NotificationsBell } from "./NotificationsBell";
import { RoyIcon } from "./icons";
import { ROY_TYPE } from "./ui";
import { useDt, useRoyNav } from "./nav";
import { saveRecent } from "./screens/SearchScreen";
import { TaskModal } from "@/components/TaskModal";

// Главная (десктоп) по стенду — docs/decisions/2026-09-24-home-by-stand.md, образец
// docs/redesign/stand/js/screens-home.js. Слева таблицы «Мои задачи» (Просрочено · Сегодня ·
// Дальше · Без срока) и «Задачи команды»; справа (344px) встречи дня, «Топ 5 новостей»,
// «Ждут вас», «Последнее в базе». Поиск — в шапке, а не посреди экрана. «Личный дайджест»
// с главной снят решением владельца; компонент dash/PersonalDigest.tsx оставлен.
// На мобайле этот экран не рендерится (там SearchScreen).


export function RoyDashboard() {
  const data = useDashboardData();
  const dt = useDt();
  const { openTasks, bumpTasks } = useRoyNav();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);

  // Названия проектов и списков для колонок таблицы. Не пришли — в ячейке прочерк, строки те же.
  useEffect(() => {
    fetchProjects().then(setProjects).catch((e) => console.warn("[RoyDashboard] projects", e));
    fetchTaskLabels().then(setLabels).catch((e) => console.warn("[RoyDashboard] labels", e));
  }, []);

  const now = useMemo(() => new Date(), [data.tasks]);
  const mineSections = useMemo(() => groupHome(data.mine, now, lang), [data.mine, now, lang]);
  const more = hiddenCount(data.mine, mineSections, now);
  const team = useMemo(() => homeTeam(data.team, now), [data.team, now]);

  const projectName = (t: { project_id: string | null }) => projects.find((p) => p.id === t.project_id)?.name ?? null;
  const labelNames = (t: { label_ids?: string[] | null }) =>
    (t.label_ids ?? []).map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ");

  const { loading, failed, retry } = data.tasksState;
  const mineCount = mineSections.reduce((n, s) => n + s.tasks.length, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HomeHeader />
      {/* Правая колонка — 344px (стенд). Уже 1100px она уходит под задачи: на узком окне две
          колонки съедали названия задач до пары слов. Класс статичный — Tailwind не видит
          значений из переменных, поэтому 344 записано в нём самом. */}
      <div className="grid min-h-0 flex-1 content-start overflow-auto min-[1100px]:grid-cols-[minmax(0,1fr)_344px] min-[1100px]:content-stretch">
        <div className="min-w-0 px-6 pb-6">
          <HomeLabel first count={loading ? undefined : mineCount}
            action={{ text: dt("+ новая задача", "+ new task"), onClick: () => setCreating(true) }}>
            {dt("Мои задачи", "My tasks")}
          </HomeLabel>
          <TasksSlot loading={loading} failed={failed} retry={retry}
            empty={mineSections.length === 0}
            emptyTitle={dt("Задач на вас нет", "No tasks on you")}
            emptyHint={dt("Свободно — можно взять из общего списка", "You're free — pick one from the shared list")}>
            <HomeTaskTable sections={mineSections} projectName={projectName} labelNames={labelNames} now={now} />
          </TasksSlot>
          {more > 0 && (
            <button type="button" onClick={() => openTasks("mine", "all")}
              className="mt-2 inline-flex min-h-6 items-center font-medium text-primary hover:underline" style={{ fontSize: 12 }}>
              {dt(`Ещё ${more} в «Задачах»`, `${more} more in Tasks`)}
            </button>
          )}

          <HomeLabel count={loading ? undefined : team.length}
            action={team.length ? { text: dt("все задачи команды", "all team tasks"), onClick: () => openTasks("team", "all") } : undefined}>
            {dt("Задачи команды", "Team tasks")}
          </HomeLabel>
          <TasksSlot loading={loading} failed={failed} retry={retry}
            empty={team.length === 0}
            emptyTitle={dt("Ничьих задач нет", "No unassigned tasks")}
            emptyHint={dt("У каждой общей задачи есть исполнитель", "Every shared task has an owner")}>
            <HomeTaskTable
              sections={[{ key: "team", label: "", tasks: team.slice(0, HOME_TEAM_LIMIT) }]}
              projectName={projectName} labelNames={labelNames} showLabels={false} now={now} />
          </TasksSlot>
        </div>

        <aside className="min-w-0 border-t border-line px-6 pb-6 min-[1100px]:border-l min-[1100px]:border-t-0 min-[1100px]:px-5">
          <MeetingsToday flat first />
          <HomeNews data={data} now={now} />
          <LatestInBase data={data} />
        </aside>
      </div>
      {/* Быстрое создание задачи с главной — окно поверх, без ухода на доску. */}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={bumpTasks} drawer />
    </div>
  );
}

function TasksSlot({ loading, failed, retry, empty, emptyTitle, emptyHint, children }: {
  loading: boolean; failed: boolean; retry: () => void; empty: boolean;
  emptyTitle: string; emptyHint: string; children: React.ReactNode;
}) {
  const dt = useDt();
  if (loading) return <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 34, borderRadius: 8 }} />)}</div>;
  if (failed) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-ink-soft" style={{ fontSize: 13 }}>
        {dt("Не загрузилось", "Failed to load")}
        <button type="button" onClick={retry} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center">
        <div className="font-medium text-ink" style={{ fontSize: 13.5 }}>{emptyTitle}</div>
        <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12.5 }}>{emptyHint}</div>
      </div>
    );
  }
  return <>{children}</>;
}

// Шапка главной: заголовок и поиск по базе (стенд: поиск в шапке вместо поиска посреди главной).
function HomeHeader() {
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
      <form className="ml-auto w-full max-w-[380px]" role="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
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
        <NotificationsBell />
        <ProjectMapButton />
      </div>
    </div>
  );
}
