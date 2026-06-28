"use client";
import { RoyMark } from "./RoyMark";
import { useDashboardData } from "./dash/useDashboardData";
import { PersonalTasks } from "./dash/PersonalTasks";
import { SearchHero } from "./dash/SearchHero";
// Materials («Добавлено за сутки») временно скрыт на дашборде — переиспользуем позже.
// import { Materials } from "./dash/Materials";
import { MeetingsApprove } from "./dash/MeetingsApprove";
import { TeamTasks } from "./dash/TeamTasks";
import { ProjectMapButton } from "./dash/ProjectMapButton";
import { PersonalDigest } from "./dash/PersonalDigest";

// Desktop-главный экран «Рой» — 3-колоночная раскладка (только lg+, см. RoyApp `isDashboard`).
// Лево (288px): личные задачи. Центр (1fr): поиск-герой + материалы за сутки. Право (344px):
// встречи на согласование + задачи команды. Один источник данных — useDashboardData.
// На мобайле этот экран не рендерится (там SearchScreen); если всё же отрисуется узко —
// колонки складываются вертикально через grid с min-width (graceful, без отдельного фолбэка).

export function RoyDashboard() {
  const data = useDashboardData();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* шапка: лого слева, иконка «Карта проекта» справа (симметрично) */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-4">
        <div className="flex items-center gap-2.5">
          <RoyMark size={32} />
          <span className="font-bold" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>
            Swarm
          </span>
        </div>
        <ProjectMapButton />
      </div>

      {/* 3 колонки: лево / центр / право. minmax(0,1fr) — чтобы центр не распирал грид. */}
      <div
        className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4"
        style={{ gridTemplateColumns: "minmax(260px, 288px) minmax(0, 1fr) minmax(300px, 344px)" }}
      >
        <PersonalTasks data={data} />

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <SearchHero />
          <PersonalDigest className="min-h-0 flex-1" />
          {/* «Добавлено за сутки» (Materials) временно скрыто — переиспользуем позже */}
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <MeetingsApprove data={data} className="min-h-0 flex-1" />
          <TeamTasks data={data} className="min-h-0 flex-1" />
        </div>
      </div>
    </div>
  );
}
