"use client";
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { Avatar, NavHeader, SectionLabel, Chip, RoyCard, Market } from "../ui";
import { RoyMark } from "../RoyMark";
import { fetchTasks, fetchMeetings } from "@/lib/api";
import { deriveEntryTitle } from "../entry";
import { fmtDate, norm } from "../dash/shared";
import type { Task, Entry } from "@/types";

const RECENT_KEY = "roy_recent_searches";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function saveRecent(q: string) {
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — игнорируем */
  }
}

function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

export function SearchScreen({ onBack }: { onBack?: () => void }) {
  const dt = useDt();
  const { me, push, setTab, openAnswer } = useRoyNav();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Entry[] | null>(null);

  useEffect(() => {
    setRecent(loadRecent());
    fetchTasks().then(setTasks).catch(() => setTasks([]));
    fetchMeetings().then(setMeetings).catch(() => setMeetings([]));
  }, []);

  const go = (query: string) => {
    const v = query.trim();
    if (!v) return;
    saveRecent(v);
    openAnswer(v);
  };

  // Задачи в работе (статус in_progress / progress)
  const inProgressTasks = (tasks ?? []).filter((t) => norm(t.status) === "in_progress");
  // Последняя встреча для «Продолжить». Встречи в продукте — это записи уже
  // прошедших встреч (транскрипты Granola/Read.ai/Desktop Agent), будущих в данных
  // нет (календарь подключён отдельно, read-only). Поэтому «самая свежая по дате» —
  // и есть та, к которой логично вернуться.
  const recentMeeting: Entry | null = (() => {
    const list = [...(meetings ?? [])];
    list.sort((a, b) => {
      const da = new Date(a.entry_date ?? a.created_at).getTime();
      const db = new Date(b.entry_date ?? b.created_at).getTime();
      return db - da; // самая свежая первой
    });
    return list[0] ?? null;
  })();
  const showContinue = tasks !== null && meetings !== null && (inProgressTasks.length > 0 || recentMeeting !== null);

  return (
    <div className="h-full overflow-y-auto">
      {/* Шапка. В push-режиме (мобильный вход по иконке поиска) — «Назад»; на десктопе, где этот
          экран открывается как раздел, — лого и аватар как было. */}
      {onBack ? (
        <NavHeader onBack={onBack} title={dt("Поиск", "Search")} />
      ) : (
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <RoyMark size={30} />
            <span className="font-bold" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>
              Swarm
            </span>
          </div>
          <button type="button" onClick={() => push({ view: "more" })} aria-label={dt("Меню", "Menu")} className="transition-transform active:scale-[0.95]">
            <Avatar size={36}>{initials(me?.name)}</Avatar>
          </button>
        </div>
      )}

      {/* поле поиска (герой) */}
      <div className="px-5 pt-2">
        <form onSubmit={(e) => { e.preventDefault(); go(q); }}>
          <div className="flex items-center gap-2.5 bg-surface border border-line-2 focus-within:border-primary dark:backdrop-blur-md" style={{ borderRadius: 18, padding: "13px 15px" }}>
            <RoyIcon name="spark" size={20} className="shrink-0 text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Спросить или найти…"
              enterKeyHint="search"
              className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 16 }}
            />
          </div>
        </form>
      </div>

      {recent.length > 0 && (
        <div className="px-5 pt-6">
          <SectionLabel>Недавнее</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <Chip key={r} onClick={() => go(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {showContinue && (
        <div className="px-5 pt-6 pb-24">
          <SectionLabel>Продолжить</SectionLabel>
          <div className="flex flex-col gap-2">
            {inProgressTasks.length > 0 && (
              <button
                type="button"
                onClick={() => setTab("task")}
                className="w-full text-left transition-transform active:scale-[0.97]"
              >
                <RoyCard className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
                    style={{ width: 36, height: 36, background: "color-mix(in srgb, var(--status-prog) 14%, transparent)", color: "var(--status-prog)" }}
                  >
                    <RoyIcon name="task" size={18} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
                      {inProgressTasks.length} {inProgressTasks.length === 1 ? "задача в работе" : inProgressTasks.length < 5 ? "задачи в работе" : "задач в работе"}
                    </div>
                    <div className="text-ink-mute" style={{ fontSize: 12 }}>Открыть в задачах</div>
                  </div>
                  <RoyIcon name="cright" size={16} strokeWidth={2} className="shrink-0 text-ink-mute" />
                </RoyCard>
              </button>
            )}

            {recentMeeting && (
              <button
                type="button"
                onClick={() => push({ view: "meetingDetail", params: { id: recentMeeting.id } })}
                className="w-full text-left transition-transform active:scale-[0.97]"
              >
                <RoyCard className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
                    style={{ width: 36, height: 36, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
                  >
                    <RoyIcon name="meet" size={18} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>
                      {deriveEntryTitle(recentMeeting)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Market code={recentMeeting.countries?.[0]} />
                      {(() => {
                        const d = fmtDate(recentMeeting.entry_date ?? recentMeeting.created_at);
                        return d ? <span className="text-ink-mute" style={{ fontSize: 12 }}>{d}</span> : null;
                      })()}
                    </div>
                  </div>
                  <RoyIcon name="cright" size={16} strokeWidth={2} className="shrink-0 text-ink-mute" />
                </RoyCard>
              </button>
            )}
          </div>
        </div>
      )}

      {!showContinue && <div className="pb-24" />}
    </div>
  );
}
