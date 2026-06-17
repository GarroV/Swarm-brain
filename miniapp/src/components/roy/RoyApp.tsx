"use client";
import { useCallback, useEffect, useState } from "react";
import type { Me } from "@/types";
import { cn } from "@/lib/utils";
import { getDeepLinkMeetingId } from "@/lib/telegram";
import { RoyNavContext, useRoyNav, type RoyNav, type RoyRoute, type RoyTab } from "./nav";
import { RoyTabBar, NavHeader, Avatar, ROY_TABS } from "./ui";
import { RoyIcon } from "./icons";
import { useIsDesktop } from "./useIsDesktop";
import { SearchScreen } from "./screens/SearchScreen";
import { AnswerScreen } from "./screens/AnswerScreen";
import { RecordDetail } from "./screens/RecordDetail";
import { RoyTasksScreen } from "./screens/RoyTasksScreen";
import { TaskDetail } from "./screens/TaskDetail";
import { NewTask } from "./screens/NewTask";
import { RoyBaseScreen } from "./screens/RoyBaseScreen";
import { NewEntry } from "./screens/NewEntry";
import { RoyMeetingsScreen } from "./screens/RoyMeetingsScreen";
import { MeetingDetail } from "./screens/MeetingDetail";
import { RoyDashboard } from "./RoyDashboard";
import { RoyMark } from "./RoyMark";
import { MeetingReview } from "@/components/MeetingReview";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { TeamScreen } from "@/components/TeamScreen";
import { SettingsScreen } from "@/components/SettingsScreen";
import { AdminScreen } from "@/components/AdminScreen";

// Каркас «Рой» по дизайн-хендоффу: 4 корневых таба (Поиск/Задачи/База/Встречи) + push-стек.
// Мобайл — нижний таб-бар; десктоп (lg+) — левый сайдбар. На десктопе вкладка «Задачи»
// показывает полный TasksScreen с видами Доска/Таймлайн/Спринт/Граф; на мобайле — список.

export function RoyApp({ me }: { me: Me | null }) {
  const [tab, setTabState] = useState<RoyTab>("search");
  const [stack, setStack] = useState<RoyRoute[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  const setTab = useCallback((t: RoyTab) => {
    setStack([]);
    setTabState(t);
    // Запоминаем вкладку, чтобы рефреш страницы не сбрасывал на «Поиск».
    try { sessionStorage.setItem("roy_tab", t); } catch { /* приватный режим */ }
  }, []);
  const push = useCallback((r: RoyRoute) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    // deep-link встречи приходит как ?meeting= — чистим, чтобы назад не открывал её снова
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const toast = useCallback((msg: string) => setToastMsg(msg), []);

  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(null), 1900);
    return () => clearTimeout(id);
  }, [toastMsg]);

  // Deep-link из уведомления «тезисы готовы» → вкладка Встречи + push вычитки.
  // Иначе — восстанавливаем последнюю вкладку (рефреш не должен кидать на «Поиск»).
  useEffect(() => {
    const id = getDeepLinkMeetingId();
    if (id) {
      setTabState("cal");
      setStack([{ view: "meetingReview", params: { id } }]);
      return;
    }
    try {
      const saved = sessionStorage.getItem("roy_tab");
      if (saved && ROY_TABS.some((t) => t.id === saved)) setTabState(saved as RoyTab);
    } catch { /* приватный режим */ }
  }, []);

  const nav: RoyNav = { me, tab, setTab, push, pop, toast };
  const top = stack[stack.length - 1];
  // На десктопе домашняя вкладка («Поиск») — бенто-дашборд во всю ширину; на мобайле и в
  // push-стеке остаётся центрированная колонка.
  const isDashboard = isDesktop && tab === "search" && !top;

  return (
    <RoyNavContext.Provider value={nav}>
      <div className="flex h-[100dvh] bg-background text-foreground">
        <RoySidebar className="hidden lg:flex" />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              "relative mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden",
              isDashboard ? "max-w-[1240px]" : "max-w-[480px] lg:max-w-[940px]",
            )}
          >
            {top ? (
              <PushScreen route={top} />
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {tab === "search" && (isDashboard ? <RoyDashboard /> : <SearchScreen />)}
                  {tab === "task" && (isDesktop ? <TasksScreen /> : <RoyTasksScreen />)}
                  {tab === "book" && <RoyBaseScreen />}
                  {tab === "cal" && <RoyMeetingsScreen />}
                </div>
                <RoyTabBar active={tab} onChange={(id) => setTab(id as RoyTab)} className="lg:hidden" />
              </>
            )}

            {toastMsg && (
              <div
                role="status"
                className="roy-pop absolute bottom-[110px] left-1/2 z-50 -translate-x-1/2 rounded-[13px] bg-ink px-4 py-2.5 text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,.3)]"
              >
                {toastMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </RoyNavContext.Provider>
  );
}

function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

function RoySidebar({ className }: { className?: string }) {
  const { tab, setTab, push, me } = useRoyNav();
  return (
    <aside className={cn("w-[232px] shrink-0 flex-col border-r border-line bg-surface-2 px-3 py-4", className)}>
      <div className="flex items-center gap-2 px-2 pb-5">
        <RoyMark size={30} />
        <span className="font-bold" style={{ fontSize: 20, letterSpacing: "-0.01em" }}>
          Рой
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {ROY_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as RoyTab)}
              className={cn("flex items-center gap-3 rounded-[12px] px-3 py-2.5 font-semibold transition-colors", on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface")}
              style={{ fontSize: 14.5 }}
            >
              <RoyIcon name={t.icon} size={20} strokeWidth={on ? 2.1 : 1.8} />
              {t.label}
            </button>
          );
        })}
      </nav>
      <button type="button" onClick={() => push({ view: "more" })} className="mt-auto flex items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors hover:bg-surface">
        <Avatar size={32}>{initials(me?.name)}</Avatar>
        <span className="font-medium text-ink-soft" style={{ fontSize: 14 }}>
          Ещё
        </span>
      </button>
    </aside>
  );
}

function PushScreen({ route }: { route: RoyRoute }) {
  if (route.view === "meetingReview") return <MeetingReviewScreen id={route.params.id} />;
  if (route.view === "answer") return <AnswerScreen query={route.params.query} />;
  if (route.view === "record") return <RecordDetail id={route.params.id} />;
  if (route.view === "taskDetail") return <TaskDetail id={route.params.id} />;
  if (route.view === "newTask") return <NewTask id={route.params?.id} />;
  if (route.view === "newEntry") return <NewEntry />;
  if (route.view === "meetingDetail") return <MeetingDetail id={route.params.id} />;
  if (route.view === "more") return <MoreScreen />;
  if (route.view === "settings") return <Wrapped title="Настройки"><SettingsScreen /></Wrapped>;
  if (route.view === "team") return <Wrapped title="Команда"><TeamScreen /></Wrapped>;
  if (route.view === "admin") return <Wrapped title="Админ"><AdminScreen /></Wrapped>;
  return null;
}

function MeetingReviewScreen({ id }: { id: string }) {
  const { pop } = useRoyNav();
  return <MeetingReview id={id} onClose={pop} />;
}

function Wrapped({ title, children }: { title: string; children: React.ReactNode }) {
  const { pop } = useRoyNav();
  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function MoreScreen() {
  const { me, push, pop } = useRoyNav();
  const rows: { label: string; route: RoyRoute }[] = [
    { label: "Настройки", route: { view: "settings" } },
    { label: "Команда", route: { view: "team" } },
  ];
  if (me?.is_admin) rows.push({ label: "Админ", route: { view: "admin" } });
  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Ещё" />
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {rows.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => push(r.route)}
            className="flex w-full items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3.5 text-left font-semibold text-ink transition-transform active:scale-[0.98]"
            style={{ fontSize: 15 }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
