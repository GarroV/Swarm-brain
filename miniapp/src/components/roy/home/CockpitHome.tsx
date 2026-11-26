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
import { useInspections } from "./useInspections";
import { latestInspections, pctText } from "@/lib/homeInspections";
import { useQuality, type QualityState } from "./useQuality";
import { CockpitSettings } from "./CockpitSettings";
import { CockpitPerformance } from "./CockpitPerformance";
import styles from "./cockpit.module.css";

type Props = {
  data: DashboardData; editing: boolean; onEditing: (open: boolean) => void;
  onCreateTask: () => void; onCreateTaskFrom: (draft: TaskDraft) => void;
};

export function CockpitHome({ data, editing, onEditing, onCreateTask }: Props) {
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
  const saved = (next: string[], blocks: CockpitPreferences) => {
    setMarkets(next); setPreferences(blocks); saveCockpitPreferences(owner, blocks); onEditing(false);
  };
  return <div className={styles.home} data-home="cockpit">
    {preferences.reminders && <section className={styles.reminders}><h2>{dt("Напоминания и объявления", "Reminders and notices")}</h2><BoardWidget data={data} compact /></section>}
    <div className={styles.homeColumns}>
      <div className={styles.mainColumn}>
        {!me ? <div className="roy-shim h-72 rounded-xl" /> : !active ? <div className={styles.empty}><p>{dt("Выберите свои страны, чтобы видеть показатели", "Choose your countries to see performance")}</p><button type="button" className={styles.button} onClick={() => onEditing(true)}>{dt("Настроить главную", "Customize home")}</button></div> : <CockpitPerformance key={owner} codes={markets} selected={active} onSelect={setSelected} showUnits={preferences.units}>
          {preferences.quality && <QualityBrief code={active} quality={quality} />}
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

function QualityBrief({ code, quality }: { code: string; quality: QualityState }) {
  const dt = useDt(), inspections = useInspections();
  const row = quality.data ? countryOf(quality.data, code) : null;
  const latest = latestInspections(inspections.data?.inspections ?? [], [code])[0];
  const locale = dt("ru-RU", "en-GB");
  const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const period = (kind: "rs" | "rko") => {
    const dates = quality.data?.[kind];
    if (!dates || !dates.dates[dates.last]) return dt("Период не получен", "Period unavailable");
    const fmt = (d: Date) => d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${fmt(dates.dates[dates.last])}–${fmt(dates.ends[dates.last])}`;
  };
  const cards = [
    { key: "rs", label: dt("Стандарты · РС", "Standards · RS"), value: quality.failed ? "—" : number(row?.rs), note: quality.failed ? dt("Не удалось загрузить", "Could not load") : period("rs"), href: `/quality?country=${code}` },
    { key: "rko", label: dt("Клиентский опыт · РКО", "Customer experience · RKO"), value: quality.failed ? "—" : number(row?.rko), note: quality.failed ? dt("Не удалось загрузить", "Could not load") : period("rko"), href: `/quality?country=${code}` },
    { key: "inspections", label: dt("Выездные проверки", "Field inspections"), value: inspections.failed ? "—" : latest ? `${pctText(latest.score_pct)} · ${latest.grade}` : "—", note: inspections.failed ? dt("Не удалось загрузить", "Could not load") : latest ? `${dt("Последняя", "Latest")} · ${latest.date}` : dt("За 90 дней проверок нет", "No inspections in 90 days"), href: `/inspections?country=${code}` },
  ];
  return <div className={styles.briefGrid} data-quality-brief>{cards.map(card => <a key={card.key} className={styles.briefCard} href={`https://decimus.vasiliy-garro.workers.dev${card.href}`} target="_blank" rel="noopener noreferrer">
    <span className={styles.metricLabel}>{card.label}</span><strong className={styles.value}>{card.value}</strong><span className={styles.briefPeriod}>{card.note}</span><span className={styles.metricAction}>{dt("В Decimus", "Open Decimus")} →</span>
  </a>)}</div>;
}
