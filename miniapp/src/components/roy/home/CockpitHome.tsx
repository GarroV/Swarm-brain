"use client";
import { useState } from "react";
import type { TaskDraft } from "@/lib/homeInspections";
import { countryOf } from "@/lib/homeQuality";
import { cockpitCountries, loadCockpitPreferences, saveCockpitPreferences, type CockpitPreferences } from "@/lib/homeCockpit";
import { useDt, useRoyNav } from "../nav";
import type { DashboardData } from "../dash/useDashboardData";
import { MeetingsToday } from "../dash/MeetingsToday";
import { TopTasksWidget } from "./MiscWidgets";
import { BoardWidget } from "./StickerBoard";
import { RatingsWidget } from "./RatingsWidget";
import { InspectionsWidget } from "./InspectionsWidget";
import { PizzeriasWidget } from "./TableWidgets";
import { useQuality } from "./useQuality";
import { CockpitSettings } from "./CockpitSettings";
import { CockpitPerformance } from "./CockpitPerformance";
import styles from "./cockpit.module.css";

type Props = {
  data: DashboardData; editing: boolean; onEditing: (open: boolean) => void;
  onCreateTask: () => void; onCreateTaskFrom: (draft: TaskDraft) => void;
};

export function CockpitHome({ data, editing, onEditing, onCreateTask, onCreateTaskFrom }: Props) {
  const dt = useDt(), { me, openTasks } = useRoyNav();
  const owner = me ? `${me.group_id}:${me.telegram_id}` : null;
  const [prefsOwner, setPrefsOwner] = useState(owner);
  const [preferences, setPreferences] = useState(() => loadCockpitPreferences(owner));
  const [markets, setMarkets] = useState(() => cockpitCountries(me?.markets ?? []));
  const [seenProfile, setSeenProfile] = useState(me?.markets);
  const [selected, setSelected] = useState<string | null>(null);
  if (prefsOwner !== owner) { setPrefsOwner(owner); setPreferences(loadCockpitPreferences(owner)); }
  if (seenProfile !== me?.markets) { setSeenProfile(me?.markets); setMarkets(cockpitCountries(me?.markets ?? [])); }
  const quality = useQuality();
  const active = selected && markets.includes(selected) ? selected : markets[0];
  const codes = active ? [active] : [];
  const scope = quality.data ? codes.map((code) => countryOf(quality.data!, code)) : [];
  const saved = (next: string[], blocks: CockpitPreferences) => {
    setMarkets(next); setPreferences(blocks); saveCockpitPreferences(owner, blocks); onEditing(false);
  };
  const qualityGate = quality.loading ? <div className="roy-shim h-48 rounded-xl" />
    : quality.failed || !quality.data ? <div className={styles.empty}>{dt("Рейтинги не загрузились.", "Ratings failed to load.")} <button type="button" onClick={quality.retry} className={styles.textButton}>{dt("Повторить", "Retry")}</button></div>
      : !quality.data.countries.length ? <div className={styles.empty}>{dt("Баллы ещё не загружены", "Scores have not been loaded yet")}</div> : null;
  return <div className={styles.home} data-home="cockpit">
    {preferences.reminders && <section className={styles.reminders}><h2>{dt("Напоминания и объявления", "Reminders and notices")}</h2><BoardWidget data={data} compact /></section>}
    <div className={styles.homeColumns}>
      <div className={styles.mainColumn}>
        {!me ? <div className="roy-shim h-72 rounded-xl" /> : !active ? <div className={styles.empty}><p>{dt("Выберите свои страны, чтобы видеть показатели", "Choose your countries to see performance")}</p><button type="button" className={styles.button} onClick={() => onEditing(true)}>{dt("Настроить главную", "Customize home")}</button></div> : <CockpitPerformance key={owner} codes={markets} selected={active} onSelect={setSelected} showUnits={preferences.units}>
          {preferences.quality && <div className={styles.qualityColumns}>
            <section><div className={styles.sectionHeading}><h2>{dt("Рейтинги", "Ratings")} · {active}</h2></div><RatingsWidget codes={codes} q={quality.data} scope={scope} qualityGate={qualityGate} /></section>
            <section><div className={styles.sectionHeading}><h2>{dt("Выездные проверки", "Field inspections")} · {active}</h2></div><InspectionsWidget codes={codes} onCreateTask={onCreateTaskFrom} /></section>
          </div>}
          {preferences.units && <section className={styles.qualityPizzerias}><div className={styles.sectionHeading}><h2>{dt("Качество по пиццериям", "Quality by pizzeria")} · {active}</h2></div>{qualityGate ?? <PizzeriasWidget scope={scope} />}</section>}
        </CockpitPerformance>}
      </div>
      <aside className={styles.workday} aria-label={dt("Мой рабочий день", "My workday")}>
        <h2>{dt("Мой рабочий день", "My workday")}</h2>
        {preferences.meetings && <MeetingsToday flat first drafts={data.reviewList} flatBody="rounded-[12px] border border-line bg-surface p-2" />}
        {preferences.tasks && <section><div className={styles.sectionHeading}><h2>{dt("Ближайшие задачи", "Upcoming tasks")}</h2><button type="button" onClick={() => openTasks("mine", "all")} className={styles.textButton}>{dt("Все →", "All →")}</button></div><TopTasksWidget data={data} onCreate={onCreateTask} /></section>}
        {!preferences.meetings && !preferences.tasks && <div className={styles.empty}><button type="button" className={styles.textButton} onClick={() => onEditing(true)}>{dt("Добавить блоки рабочего дня", "Add workday blocks")}</button></div>}
      </aside>
    </div>
    {editing && <CockpitSettings markets={markets} preferences={preferences} onClose={() => onEditing(false)} onSaved={saved} />}
  </div>;
}
