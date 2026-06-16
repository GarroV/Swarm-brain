"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRoyNav } from "./nav";
import { RoyIcon, type RoyIconName } from "./icons";
import { RoyCard, TypeTag, Market, PriDot, Avatar } from "./ui";
import { entryTagKey, deriveEntryTitle } from "./entry";
import { saveRecent } from "./screens/SearchScreen";
import { sourceLabel } from "./screens/RoyMeetingsScreen";
import { fetchTasks, fetchMeetings, fetchEntries } from "@/lib/api";
import type { Task, Entry } from "@/types";

// Десктоп-дашборд «бенто»: поиск-герой сверху + три панели сразу (Задачи крупно слева,
// Встречи и База справа). Каждая панель скроллится внутри себя и раскрывается в полную
// вкладку по клику на шапку. Только lg+ — на мобайле остаётся SearchScreen (см. RoyApp).

const norm = (s: string) => (s === "progress" ? "in_progress" : s);
const pri = (t: Task) => (t.priority as "high" | "med" | "low" | null) ?? null;
const isConfirmed = (e: Entry) => e.metadata?.confirmed === true;

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}
function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

export function RoyDashboard() {
  const { me, push, setTab } = useRoyNav();
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
    fetchMeetings().then(setMeetings).catch(() => setMeetings([]));
    fetchEntries().then(setEntries).catch(() => setEntries([]));
  }, []);

  const go = (query: string) => {
    const v = query.trim();
    if (!v) return;
    saveRecent(v);
    push({ view: "answer", params: { query: v } });
  };

  // Задачи: открытые сначала, потом в работе — то, что требует внимания.
  const openTasks = (tasks ?? []).filter((t) => norm(t.status) !== "done");
  // Встречи: неподтверждённые («ожидают») вперёд, затем остальные.
  const sortedMeetings = [...(meetings ?? [])].sort((a, b) => Number(isConfirmed(a)) - Number(isConfirmed(b)));

  return (
    <div className="flex h-full flex-col overflow-hidden px-7 py-6">
      {/* шапка: лого + аватар */}
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center rounded-[11px] bg-primary font-extrabold text-white" style={{ width: 34, height: 34, fontSize: 19 }}>
            Р
          </span>
          <span className="font-bold" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
            Рой
          </span>
        </div>
        <button type="button" onClick={() => push({ view: "more" })} aria-label="Меню" className="transition-transform active:scale-[0.95]">
          <Avatar size={38}>{initials(me?.name)}</Avatar>
        </button>
      </div>

      {/* поиск-герой */}
      <form onSubmit={(e) => { e.preventDefault(); go(q); }}>
        <div className="flex items-center gap-3 bg-surface" style={{ border: "2px solid var(--ink)", borderRadius: 16, padding: "14px 18px" }}>
          <RoyIcon name="spark" size={21} className="shrink-0 text-primary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Спросить или найти по базе знаний…"
            enterKeyHint="search"
            autoFocus
            className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
            style={{ fontSize: 17 }}
          />
          <kbd className="hidden select-none rounded-[7px] border border-line-2 bg-surface-2 px-2 py-0.5 font-semibold text-ink-mute lg:inline-block" style={{ fontSize: 12 }}>
            ↵
          </kbd>
        </div>
      </form>

      {/* бенто: Задачи (слева, на всю высоту) + Встречи / База (справа) */}
      <div className="mt-5 grid min-h-0 flex-1 grid-cols-[1.5fr_1fr] grid-rows-2 gap-4">
        <DashBlock
          className="row-span-2"
          title="Задачи"
          icon="task"
          tint="var(--status-open)"
          count={openTasks.length}
          loading={tasks == null}
          empty={tasks != null && openTasks.length === 0}
          emptyText="Открытых задач нет"
          onExpand={() => setTab("task")}
        >
          {openTasks.map((t) => (
            <Row key={t.id} onClick={() => push({ view: "taskDetail", params: { id: t.id } })}>
              <PriDot pri={pri(t)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink" style={{ fontSize: 14, letterSpacing: "-0.01em" }}>
                  {t.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <StatusPill status={norm(t.status)} />
                  <Market code={t.country} />
                  {fmtDate(t.due_date) && (
                    <span className="inline-flex items-center gap-1 text-ink-mute" style={{ fontSize: 11.5 }}>
                      <RoyIcon name="cal" size={11} />
                      {fmtDate(t.due_date)}
                    </span>
                  )}
                </div>
              </div>
              {t.assignees?.[0] && <Avatar size={26}>{initials(t.assignees[0])}</Avatar>}
            </Row>
          ))}
        </DashBlock>

        <DashBlock
          title="Встречи"
          icon="meet"
          tint="var(--meet-ink)"
          count={meetings?.length}
          loading={meetings == null}
          empty={meetings != null && sortedMeetings.length === 0}
          emptyText="Встреч нет"
          onExpand={() => setTab("cal")}
        >
          {sortedMeetings.map((e) => (
            <Row key={e.id} onClick={() => push({ view: "meetingDetail", params: { id: e.id } })}>
              <span className="inline-flex shrink-0 items-center justify-center rounded-[10px]" style={{ width: 32, height: 32, background: "var(--meet-soft)", color: "var(--meet-ink)" }}>
                <RoyIcon name="meet" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
                  {deriveEntryTitle(e)}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)" }}>
                    {sourceLabel(e.source)}
                  </span>
                  <Market code={e.countries?.[0]} />
                  {fmtDate(e.entry_date || e.created_at) && (
                    <span className="text-ink-mute" style={{ fontSize: 11 }}>{fmtDate(e.entry_date || e.created_at)}</span>
                  )}
                </div>
              </div>
            </Row>
          ))}
        </DashBlock>

        <DashBlock
          title="База"
          icon="book"
          tint="var(--accent-ink)"
          count={entries?.length}
          loading={entries == null}
          empty={entries != null && (entries?.length ?? 0) === 0}
          emptyText="База пуста"
          onExpand={() => setTab("book")}
        >
          {(entries ?? []).map((e) => (
            <Row key={e.id} onClick={() => push({ view: "record", params: { id: e.id } })}>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <TypeTag type={entryTagKey(e)} small />
                  <Market code={e.countries?.[0]} />
                </div>
                <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
                  {deriveEntryTitle(e)}
                </div>
              </div>
            </Row>
          ))}
        </DashBlock>
      </div>
    </div>
  );
}

// ── Панель дашборда: шапка-кнопка (раскрыть в полную вкладку) + скроллируемое тело ──
function DashBlock({
  title, icon, tint, count, loading, empty, emptyText, onExpand, children, className,
}: {
  title: string;
  icon: RoyIconName;
  tint: string;
  count?: number;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  onExpand: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RoyCard className={`flex min-h-0 flex-col overflow-hidden p-0 ${className ?? ""}`}>
      <button
        type="button"
        onClick={onExpand}
        className="group flex shrink-0 items-center justify-between border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center rounded-[9px]" style={{ width: 28, height: 28, color: tint, backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)` }}>
            <RoyIcon name={icon} size={16} strokeWidth={2} />
          </span>
          <span className="font-bold text-ink" style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}>
            {title}
          </span>
          {count != null && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-ink-soft" style={{ fontSize: 12 }}>
              {count}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-0.5 font-semibold text-ink-mute transition-colors group-hover:text-primary" style={{ fontSize: 12.5 }}>
          Открыть
          <RoyIcon name="cright" size={14} strokeWidth={2} />
        </span>
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2">
        {loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim" style={{ height: 52, borderRadius: 12 }} />)}
        {empty && <div className="py-10 text-center text-sm text-ink-soft">{emptyText}</div>}
        {!loading && !empty && children}
      </div>
    </RoyCard>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "in_progress" ? "var(--status-prog)" : "var(--status-open)";
  const label = status === "in_progress" ? "В работе" : "Открыто";
  return (
    <span className="inline-flex items-center font-semibold" style={{ fontSize: 11, color, background: "color-mix(in srgb, " + color + " 14%, transparent)", borderRadius: 6, padding: "1px 7px" }}>
      {label}
    </span>
  );
}
