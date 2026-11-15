"use client";
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { NavHeader, SectionLabel } from "../ui";
import { fetchMeetingContext } from "@/lib/meetingContextApi";
import type { MeetingContextView } from "@/lib/api-types/meeting-context";
import { countryCode, countryName } from "@/lib/countries";
import { countryOf } from "@/lib/homeQuality";
import { useQuality } from "../home/useQuality";
import { Stat } from "../home/QualityWidgets";

const COPY = {
  meeting: { ru: "Встреча", en: "Meeting" },
  preparation: { ru: "К встрече", en: "Meeting context" },
  previous: { ru: "Прошлая встреча", en: "Previous meeting" },
  noPrevious: { ru: "Предыдущая встреча с этим составом не найдена", en: "No previous meeting with these participants found" },
  historyPartial: { ru: "Поиск по прошлым встречам неполный", en: "The previous-meeting search is incomplete" },
  summaryPartial: { ru: "Показана часть тезисов", en: "Only part of the summary is shown" },
  tasks: { ru: "Открытые задачи участников", en: "Participants’ open tasks" },
  noTasks: { ru: "Открытых задач нет", en: "No open tasks" },
  tasksPartial: { ru: "Показана часть задач", en: "Only part of the task list is shown" },
  country: { ru: "Рейтинги страны", en: "Country ratings" },
  rs: { ru: "РС", en: "RS" },
  rko: { ru: "РКО", en: "RKO" },
  loading: { ru: "Загрузка…", en: "Loading…" },
  failed: { ru: "Не удалось загрузить контекст встречи", en: "Could not load the meeting context" },
  ratingsFailed: { ru: "Не удалось загрузить рейтинги", en: "Could not load ratings" },
  retry: { ru: "Повторить", en: "Retry" },
  open: { ru: "Открыть встречу", en: "Open meeting" },
} as const;
type CopyKey = keyof typeof COPY;
function useCopy() {
  const dt = useDt();
  return (key: CopyKey) => dt(COPY[key].ru, COPY[key].en);
}
const linkClass = "text-left font-semibold text-accent-ink underline-offset-2 hover:underline focus-visible:underline";

function CountryRatings({ countries }: { countries: string[] }) {
  const tx = useCopy();
  const quality = useQuality();
  if (quality.loading) return <p role="status" className="text-sm text-ink-soft">{tx("loading")}</p>;
  if (quality.failed || !quality.data) return <div className="text-sm text-ink-soft">{tx("ratingsFailed")} <button type="button" className={linkClass} onClick={quality.retry}>{tx("retry")}</button></div>;
  return <section className="space-y-2" aria-label={tx("country")}>
    <SectionLabel>{tx("country")}</SectionLabel>
    {[...new Set(countries.map(countryCode))].map((cc) => {
      const row = countryOf(quality.data!, cc);
      return <div key={cc} className="space-y-1.5">
        <h3 className="text-sm font-semibold text-ink">{cc} · {countryName(cc)}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={tx("rs")} value={row.rs == null ? "—" : row.rs.toFixed(1)} />
          <Stat label={tx("rko")} value={row.rko == null ? "—" : row.rko.toFixed(1)} />
        </div>
      </div>;
    })}
  </section>;
}

/** Shared read-only blocks for a published entry and an actor-owned calendar occurrence. */
export function MeetingContextBlocks({ entryId, calendarKey, showTitle = false }: { entryId?: string; calendarKey?: string; showTitle?: boolean }) {
  const tx = useCopy();
  const { push, tasksVersion } = useRoyNav();
  const [state, setState] = useState<{ key: string; data: MeetingContextView | null; failed: boolean }>({ key: "", data: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([entryId, calendarKey, tasksVersion, attempt]);
  const data = state.key === requestKey ? state.data : null;
  const failed = state.key === requestKey && state.failed;
  useEffect(() => {
    let alive = true;
    const input = entryId ? { entryId } : { calendarKey: calendarKey ?? "" };
    fetchMeetingContext(input).then((next) => { if (alive) setState({ key: requestKey, data: next, failed: false }); }).catch(() => { if (alive) setState({ key: requestKey, data: null, failed: true }); });
    return () => { alive = false; };
  }, [entryId, calendarKey, requestKey]);
  if (failed) return <section className="my-4 text-sm text-ink-soft" role="alert">{tx("failed")} <button type="button" className={linkClass} onClick={() => setAttempt((n) => n + 1)}>{tx("retry")}</button></section>;
  if (!data) return <p className="my-4 text-sm text-ink-soft" role="status">{tx("loading")}</p>;
  const countries = data.meeting.countries.filter((c) => c && c !== "General");
  return <section className="my-4 space-y-5 rounded-[10px] border border-line p-4" aria-label={tx("preparation")}>
    {showTitle && <h1 className="text-xl font-bold text-ink">{data.meeting.title ?? tx("meeting")}</h1>}
    <section className="space-y-2" aria-label={tx("previous")}>
      <SectionLabel>{tx("previous")}</SectionLabel>
      {data.previous ? <>
        <button type="button" className={linkClass} onClick={() => push({ view: "meetingDetail", params: { id: data.previous!.id } })}>
          {data.previous.title || tx("open")}
        </button>
        <p className="font-mono text-xs text-ink-mute">{data.previous.date}</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{data.previous.summary}</p>
        {data.previous.truncated && <p className="text-xs text-ink-mute">{tx("summaryPartial")}</p>}
      </> : !data.previousTruncated && <p className="text-sm text-ink-soft">{tx("noPrevious")}</p>}
      {data.previousTruncated && <p className="text-xs text-ink-mute">{tx("historyPartial")}</p>}
    </section>
    <section className="space-y-2" aria-label={tx("tasks")}>
      <SectionLabel>{tx("tasks")}{data.tasksTotal == null ? "" : ` · ${data.tasksTotal}`}</SectionLabel>
      {data.tasks.length === 0 && !data.tasksTruncated && <p className="text-sm text-ink-soft">{tx("noTasks")}</p>}
      <ul className="space-y-2">{data.tasks.map((task) => <li key={task.id} className="flex items-start justify-between gap-2 text-sm">
        <button type="button" className={linkClass} onClick={() => push({ view: "taskDetail", params: { id: task.id } })}>{task.title}</button>
        {task.dueDate && <time className="shrink-0 font-mono text-xs text-ink-mute" dateTime={task.dueDate}>{task.dueDate}</time>}
      </li>)}</ul>
      {data.tasksTruncated && <p className="text-xs text-ink-mute">{tx("tasksPartial")}</p>}
    </section>
    {countries.length > 0 && <CountryRatings countries={countries} />}
  </section>;
}

export function CalendarContextCard({ id }: { id: string }) {
  const tx = useCopy();
  const { pop } = useRoyNav();
  return <div className="flex h-full flex-col">
    <NavHeader title={tx("meeting")} onBack={pop} />
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-20"><MeetingContextBlocks calendarKey={id} showTitle /></div>
  </div>;
}
