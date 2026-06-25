"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { RoyHeader, Segmented, RoyCard, Market, SectionLabel, PriDot } from "../ui";
import { RoyIcon, type RoyIconName } from "../icons";
import { useIsDesktop } from "../useIsDesktop";
import { deriveEntryTitle } from "../entry";
import { fetchMeetings, fetchTasks, deleteMeeting } from "@/lib/api";
import { AgentReviewQueue } from "@/components/AgentReviewQueue";
import type { Entry, Task } from "@/types";

const SEGS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ожидают" },
  { id: "confirmed", label: "Подтверждены" },
];

export function sourceLabel(s: string): string {
  if (s === "granola") return "Granola";
  if (s === "read_ai") return "Read.ai";
  if (s === "desktop-agent") return "Рекордер";
  return "Встреча";
}
const isConfirmed = (e: Entry) => e.metadata?.confirmed === true;
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}
// Подсчёт с сортировкой по убыванию.
function tally(keys: string[]): [string, number][] {
  const m = new Map<string, number>();
  keys.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function ActionIcon({ name, label, color, onClick }: { name: RoyIconName; label: string; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      className="flex items-center justify-center rounded-[10px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92]"
      style={{ width: 36, height: 36, color }}
    >
      <RoyIcon name={name} size={18} strokeWidth={1.9} />
    </button>
  );
}

function MeetingCard({ e, onOpen, onRemove }: { e: Entry; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="relative">
      <button type="button" onClick={onOpen} className="block w-full text-left transition-transform active:scale-[0.99]">
        <RoyCard className="flex items-center gap-3 px-4 py-3.5">
          <span className="inline-flex shrink-0 items-center justify-center rounded-[12px]" style={{ width: 38, height: 38, background: "var(--meet-soft)", color: "var(--meet-ink)" }}>
            <RoyIcon name="meet" size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 truncate font-semibold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
              {deriveEntryTitle(e)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "1px 7px" }}>
                {sourceLabel(e.source)}
              </span>
              <Market code={e.countries?.[0]} />
              {fmtDate(e.entry_date || e.created_at) && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>
                  {fmtDate(e.entry_date || e.created_at)}
                </span>
              )}
              {e.added_by && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>· {e.added_by}</span>
              )}
            </div>
          </div>
          <span className="shrink-0" style={{ width: 90 }} />
        </RoyCard>
      </button>
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        <ActionIcon name="pencil" label="Изменить" color="var(--status-open)" onClick={onOpen} />
        <ActionIcon name="trash" label="Удалить" color="var(--pri-high)" onClick={onRemove} />
      </div>
    </div>
  );
}

// Задачи, извлечённые из встреч (meeting_id != null) — быстрый доступ из раздела встреч.
function MeetingTasksPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    fetchTasks()
      .then((ts) => setTasks(ts.filter((t) => t.meeting_id && t.status !== "done")))
      .catch(() => setTasks([]));
  }, []);
  if (!tasks || tasks.length === 0) return null;
  return (
    <RoyCard className="px-3.5 py-3">
      <SectionLabel className="!mb-2">Задачи из встреч · {tasks.length}</SectionLabel>
      <div className="space-y-0.5">
        {tasks.slice(0, 10).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
          >
            <PriDot pri={(t.priority as "high" | "med" | "low" | null) ?? null} />
            <span className="min-w-0 flex-1 truncate text-ink" style={{ fontSize: 13 }}>{t.title}</span>
          </button>
        ))}
      </div>
    </RoyCard>
  );
}

function CountsPanel({ title, counts }: { title: string; counts: [string, number][] }) {
  if (counts.length === 0) return null;
  return (
    <RoyCard className="px-3.5 py-3">
      <SectionLabel className="!mb-2">{title}</SectionLabel>
      <div className="space-y-1.5">
        {counts.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between gap-2" style={{ fontSize: 13 }}>
            <span className="truncate text-ink-soft">{k}</span>
            <span className="shrink-0 font-bold text-ink">{n}</span>
          </div>
        ))}
      </div>
    </RoyCard>
  );
}

export function RoyMeetingsScreen() {
  const { push, toast } = useRoyNav();
  const isDesktop = useIsDesktop();
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [seg, setSeg] = useState("all");

  const load = useCallback(() => {
    fetchMeetings()
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const all = meetings ?? [];
  const items = all.filter((e) => (seg === "all" ? true : seg === "confirmed" ? isConfirmed(e) : !isConfirmed(e)));

  const open = (id: string) => push({ view: "meetingDetail", params: { id } });
  const remove = async (e: Entry) => {
    if (typeof window !== "undefined" && !window.confirm(`Удалить встречу «${deriveEntryTitle(e)}»? Это удалит и расшифровку.`)) return;
    setMeetings((prev) => prev?.filter((x) => x.id !== e.id) ?? null);
    try {
      await deleteMeeting(e.id);
      toast("Встреча удалена");
    } catch {
      toast("Не удалось удалить");
      load();
    }
  };
  const openReview = (id: string) => push({ view: "meetingReview", params: { id } });

  const segmented = <Segmented items={SEGS} value={seg} onChange={setSeg} />;
  const skeleton = meetings == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 72, borderRadius: 18 }} />);
  const emptyFeed = meetings && items.length === 0 && <div className="py-10 text-center text-sm text-ink-soft">Встреч нет</div>;
  const feedCards = items.map((e) => <MeetingCard key={e.id} e={e} onOpen={() => open(e.id)} onRemove={() => remove(e)} />);

  const sidebarCounts = (
    <>
      <CountsPanel title="По странам" counts={tally(all.flatMap((e) => (e.countries?.length ? e.countries : ["—"])))} />
      <CountsPanel title="Источники" counts={tally(all.map((e) => sourceLabel(e.source)))} />
    </>
  );

  // ── Десктоп: лента + правый сайдбар (бенто) ──────────────────────────────────
  if (isDesktop) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <RoyHeader title="Встречи" />
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-4 px-5 pb-5">
          <div className="min-h-0 overflow-y-auto pr-1">
            <div className="pb-3">{segmented}</div>
            <div className="space-y-2.5 pb-4">
              {skeleton}
              {emptyFeed}
              {feedCards}
            </div>
          </div>
          <aside className="min-h-0 space-y-3 overflow-y-auto">
            <AgentReviewQueue onOpen={openReview} />
            <MeetingTasksPanel onOpen={(id) => push({ view: "taskDetail", params: { id } })} />
            {sidebarCounts}
          </aside>
        </div>
      </div>
    );
  }

  // ── Мобайл: стопкой (как было) ───────────────────────────────────────────────
  return (
    <div className="relative h-full overflow-y-auto">
      <AgentReviewQueue onOpen={openReview} />
      <RoyHeader title="Встречи" />
      <div className="px-5 pb-3">{segmented}</div>
      <div className="space-y-2.5 px-5 pb-28">
        {skeleton}
        {emptyFeed}
        {feedCards}
      </div>
    </div>
  );
}
