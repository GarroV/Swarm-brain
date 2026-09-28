"use client";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentMeeting, Entry, Task } from "@/types";
import { fetchAgentMeetings, fetchConfig, fetchMeetings, fetchTasks } from "@/lib/api";
import { countryCode, countryName } from "@/lib/countries";
import { Menu, ToolbarButton, type MenuItem } from "@/components/tasks/table/Menu";
import { useDt, useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "./RoyMeetingsScreen";
import {
  applyMeetingsFilter, EMPTY_FILTERS, isConfirmed, isFilterActive, loadSavedFilters, meetingDay, periodBounds,
  personOf, saveFilters, type MeetingsFilterState, type PeriodId,
} from "./meetingsFilter";

// «Встречи» десктопа по стенду (docs/redesign/stand/js/screens-meetings.js): одна таблица с
// секциями «На вычитке» · «Черновики bumblebee» · «Все встречи» вместо вкладок и ленты карточек,
// фильтры одной строкой. Правило фильтра — прежнее (meetingsFilter.ts, запоминается между
// заходами). Колонки «Длит.» нет: длительность записана у 2 встреч из 346 (прод, 24.09.2026),
// показывать было бы нечего.

const COLS = "minmax(0,1fr) 110px minmax(150px,24%) 64px";
const PERIODS: [PeriodId, string, string][] = [
  ["all", "всё время", "all time"], ["week", "неделя", "week"], ["month", "месяц", "month"], ["quarter", "квартал", "quarter"],
];

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function MeetingsDesk() {
  const dt = useDt();
  const { push, tasksVersion } = useRoyNav();
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [drafts, setDrafts] = useState<AgentMeeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // Статус в строке фильтров не выбирается — его заменили секции; сохранённый прежде статус
  // не должен прятать встречи незаметно для человека.
  const [f, setF] = useState<MeetingsFilterState>(() => ({ ...loadSavedFilters(), status: "any" }));

  useEffect(() => {
    fetchMeetings().then(setMeetings).catch((e) => { console.error("[MeetingsDesk] meetings", e); setFailed(true); setMeetings([]); });
    fetchAgentMeetings("awaiting_review").then(setDrafts).catch((e) => console.warn("[MeetingsDesk] drafts", e));
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => setMarkets([]));
  }, []);
  useEffect(() => {
    fetchTasks().then(setTasks).catch((e) => console.warn("[MeetingsDesk] tasks", e));
  }, [tasksVersion]);

  const update = (patch: Partial<MeetingsFilterState>) => {
    const next = { ...f, ...patch };
    setF(next);
    saveFilters(next);
  };

  const all = meetings ?? [];
  const shown = useMemo(() => applyMeetingsFilter(all, f), [all, f]);
  const pending = shown.filter((e) => !isConfirmed(e));
  const rest = shown.filter(isConfirmed);
  // Черновики рекордера: у них нет стран, хранилища и «кто принёс» — при этих фильтрах прячем,
  // остальное (поиск, период, источник) применяем к тому, что у черновика есть.
  const shownDrafts = useMemo(() => {
    if (f.countries.length || f.people.length || f.storage !== "any") return [];
    const q = f.query.trim().toLowerCase();
    const bounds = f.period === "custom"
      ? (f.from || f.to ? { from: f.from || "0000-01-01", to: f.to || "9999-12-31" } : null)
      : periodBounds(f.period);
    return drafts.filter((m) => {
      if (q && !(m.title ?? "").toLowerCase().includes(q)) return false;
      if (f.sources.length && !f.sources.includes(sourceLabel(m.source))) return false;
      const day = m.started_at?.slice(0, 10);
      if (bounds && (!day || day < bounds.from || day > bounds.to)) return false;
      return true;
    });
  }, [drafts, f]);

  const taskCount = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of tasks) if (t.meeting_id) by.set(t.meeting_id, (by.get(t.meeting_id) ?? 0) + 1);
    return by;
  }, [tasks]);

  const sources = [...new Set([...all.map((e) => sourceLabel(e.source)), ...drafts.map((m) => sourceLabel(m.source))])].sort();
  const people = [...new Set(all.map(personOf).filter(Boolean))].sort();
  const total = all.length + drafts.length;
  const count = shown.length + shownDrafts.length;
  const active = isFilterActive(f);

  const periodItems: MenuItem[] = PERIODS.map(([id, ru, en]) => ({
    key: id, label: dt(ru, en), on: f.period === id, action: true, onPick: () => update({ period: id }),
  }));
  const multi = (values: string[], chosen: string[], key: "sources" | "people" | "countries", label: (v: string) => string): MenuItem[] =>
    values.map((v) => ({ key: v, label: label(v), on: chosen.includes(v), onPick: () => update({ [key]: toggle(chosen, v) }) }));

  const loading = meetings == null;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Заголовок экрана — в полосе оболочки над ним (RoyApp); второй h1 здесь дублировал бы его. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2">
        <label className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line-2 bg-surface px-2.5 text-ink-mute focus-within:border-primary">
          <RoyIcon name="search" size={13} />
          <input
            value={f.query}
            onChange={(e) => update({ query: e.target.value })}
            placeholder={dt("Поиск по встречам", "Search meetings")}
            className="w-[170px] bg-transparent text-ink outline-none placeholder:text-ink-mute"
            style={{ fontSize: 12.5 }}
          />
        </label>
        <Menu label={`${dt("Период", "Period")}: ${periodLabel(f.period, dt)}`} on={f.period !== "all"} items={periodItems} />
        <Menu label={f.sources.length ? `${dt("Источник", "Source")}: ${f.sources.length}` : dt("Источник", "Source")}
          on={f.sources.length > 0} items={multi(sources, f.sources, "sources", (v) => v)} />
        {markets.length > 0 && (
          <Menu label={f.countries.length ? `${dt("Страна", "Country")}: ${f.countries.map(countryCode).join(", ")}` : dt("Страна", "Country")}
            on={f.countries.length > 0} items={multi(markets, f.countries, "countries", (c) => `${countryCode(c)} · ${countryName(c)}`)} />
        )}
        {people.length > 0 && (
          <Menu label={f.people.length ? `${dt("Кто принёс", "Brought by")}: ${f.people.length}` : dt("Кто принёс", "Brought by")}
            on={f.people.length > 0} items={multi(people, f.people, "people", (v) => v)} />
        )}
        <ToolbarButton on={f.storage === "shared"} onClick={() => update({ storage: f.storage === "shared" ? "any" : "shared" })}>
          {dt("Общее", "Shared")}
        </ToolbarButton>
        <ToolbarButton on={f.storage === "personal"} onClick={() => update({ storage: f.storage === "personal" ? "any" : "personal" })}>
          {dt("Личное", "Personal")}
        </ToolbarButton>
        {active && <ToolbarButton onClick={() => update({ ...EMPTY_FILTERS })}>{dt("Сбросить", "Reset")}</ToolbarButton>}
        <span className="ml-auto whitespace-nowrap text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Показано", "Shown")} <b className="text-ink">{count}</b> {dt("из", "of")} {total}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim mb-1.5" style={{ height: 34, borderRadius: 8 }} />)}
        {!loading && failed && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Встречи не загрузились — обновите страницу", "Meetings failed to load — reload the page")}
          </div>
        )}
        {!loading && !failed && count === 0 && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center">
            <div className="font-medium text-ink" style={{ fontSize: 13.5 }}>{dt("Встреч в этом срезе нет", "No meetings in this view")}</div>
            <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12.5 }}>
              {active
                ? dt("Сбросьте фильтры", "Reset the filters")
                : dt("Записи появятся после bumblebee, Granola или Read.ai", "Recordings appear after bumblebee, Granola or Read.ai")}
            </div>
          </div>
        )}
        {!loading && !failed && count > 0 && (
          <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface" style={{ fontSize: 13 }}>
            <div role="row" className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
              style={{ gridTemplateColumns: COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
              <span className="px-3">{dt("Встреча", "Meeting")}</span>
              <span className="px-2">{dt("Когда", "When")}</span>
              <span className="px-2">{dt("Источник", "Source")}</span>
              <span className="px-3 text-right">{dt("Задач", "Tasks")}</span>
            </div>
            <Section title={dt("На вычитке", "In review")} sub={dt("тезисы готовы, ждут подтверждения", "notes ready, awaiting confirmation")} n={pending.length} />
            {pending.map((e) => (
              <EntryRow key={e.id} e={e} tasks={taskCount.get(e.id) ?? 0} state="pending"
                onOpen={() => push({ view: "meetingDetail", params: { id: e.id } })} />
            ))}
            <Section title={dt("Черновики bumblebee", "bumblebee drafts")} sub={dt("запись есть, тезисов ещё нет", "recorded, no notes yet")} n={shownDrafts.length} />
            {shownDrafts.map((m) => <DraftRow key={m.id} m={m} onOpen={() => push({ view: "meetingReview", params: { id: m.id } })} />)}
            <Section title={dt("Все встречи", "All meetings")} n={rest.length} />
            {rest.map((e) => (
              <EntryRow key={e.id} e={e} tasks={taskCount.get(e.id) ?? 0} state="done"
                onOpen={() => push({ view: "meetingDetail", params: { id: e.id } })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function periodLabel(p: PeriodId, dt: (ru: string, en: string) => string): string {
  if (p === "custom") return dt("свой", "custom");
  const hit = PERIODS.find(([id]) => id === p);
  return hit ? dt(hit[1], hit[2]) : dt("всё время", "all time");
}

function Section({ title, sub, n }: { title: string; sub?: string; n: number }) {
  if (!n) return null;
  return (
    <div role="row" className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 font-semibold uppercase text-ink-soft"
      style={{ height: 30, fontSize: 10.5, letterSpacing: "0.07em" }}>
      <span>{title} · {n}</span>
      {sub && <span className="font-normal normal-case tracking-normal text-ink-mute" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

const fmtDay = (iso: string | null | undefined, locale: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
};

function RowShell({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="grid cursor-pointer items-center border-b border-line transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      style={{ gridTemplateColumns: COLS, minHeight: 34 }}
    >
      {children}
    </div>
  );
}

function Tag({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={cn("inline-flex h-[20px] items-center rounded-[5px] bg-surface-2 px-1.5 text-ink-soft", mono && "font-mono")}
      style={{ fontSize: 11 }}>
      {children}
    </span>
  );
}

function EntryRow({ e, tasks, state, onOpen }: { e: Entry; tasks: number; state: "pending" | "done"; onOpen: () => void }) {
  const dt = useDt();
  return (
    <RowShell onOpen={onOpen}>
      <div className="flex min-w-0 items-center gap-2.5 px-3">
        <span className={cn("size-[7px] shrink-0 rounded-full", state === "pending" ? "bg-status-open" : "bg-status-done")} />
        <span className="truncate text-ink">{deriveEntryTitle(e)}</span>
        {e.is_private && (
          <span className="shrink-0 text-ink-mute" title={dt("Личное хранилище", "Personal storage")}>
            <RoyIcon name="lock" size={12} />
          </span>
        )}
      </div>
      <div className="px-2 text-ink-soft">{fmtDay(meetingDay(e), dt("ru-RU", "en-GB"))}</div>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden px-2">
        <Tag>{sourceLabel(e.source)}</Tag>
        {(e.countries ?? []).slice(0, 3).map((c) => <Tag key={c} mono>{countryCode(c)}</Tag>)}
      </div>
      <div className="px-3 text-right font-mono text-ink-soft" style={{ fontSize: 12 }}>
        {tasks || <span className="text-ink-mute">—</span>}
      </div>
    </RowShell>
  );
}

function DraftRow({ m, onOpen }: { m: AgentMeeting; onOpen: () => void }) {
  const dt = useDt();
  return (
    <RowShell onOpen={onOpen}>
      <div className="flex min-w-0 items-center gap-2.5 px-3">
        <span className="size-[7px] shrink-0 rounded-full bg-status-open" />
        <span className="truncate text-ink">{m.title ?? dt("Запись без названия", "Untitled recording")}</span>
      </div>
      <div className="px-2 text-ink-soft">{fmtDay(m.started_at, dt("ru-RU", "en-GB"))}</div>
      <div className="px-2"><Tag>{sourceLabel(m.source)}</Tag></div>
      <div className="px-3 text-right text-ink-mute">—</div>
    </RowShell>
  );
}
