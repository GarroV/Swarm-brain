"use client";
import { useCallback, useEffect, useState } from "react";
import type { Me } from "@/types";
import { getDeepLinkMeetingId } from "@/lib/telegram";
import { RoyNavContext, useRoyNav, type RoyNav, type RoyRoute, type RoyTab } from "./nav";
import { RoyTabBar, NavHeader } from "./ui";
import { SearchScreen } from "./screens/SearchScreen";
import { AnswerScreen } from "./screens/AnswerScreen";
import { RecordDetail } from "./screens/RecordDetail";
import { RoyTasksScreen } from "./screens/RoyTasksScreen";
import { TaskDetail } from "./screens/TaskDetail";
import { NewTask } from "./screens/NewTask";
import { RoyBaseScreen } from "./screens/RoyBaseScreen";
import { NewEntry } from "./screens/NewEntry";
import { MeetingsScreen } from "@/components/MeetingsScreen";
import { AgentReviewQueue } from "@/components/AgentReviewQueue";
import { MeetingReview } from "@/components/MeetingReview";
import { TeamScreen } from "@/components/TeamScreen";
import { SettingsScreen } from "@/components/SettingsScreen";
import { AdminScreen } from "@/components/AdminScreen";

// Каркас «Рой» по дизайн-хендоффу: 4 корневых таба (Поиск/Задачи/База/Встречи) + push-стек
// детальных/создающих экранов. На время фаз 5–7 существующие экраны задач/базы/встреч и
// настроек/команды/админа подключены как есть; визуально перестраиваются позже.

export function RoyApp({ me }: { me: Me | null }) {
  const [tab, setTabState] = useState<RoyTab>("search");
  const [stack, setStack] = useState<RoyRoute[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const setTab = useCallback((t: RoyTab) => {
    setStack([]);
    setTabState(t);
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

  // Deep-link из уведомления «тезисы готовы» → вкладка Встречи + push вычитки
  useEffect(() => {
    const id = getDeepLinkMeetingId();
    if (id) {
      setTabState("cal");
      setStack([{ view: "meetingReview", params: { id } }]);
    }
  }, []);

  const nav: RoyNav = { me, tab, setTab, push, pop, toast };
  const top = stack[stack.length - 1];

  return (
    <RoyNavContext.Provider value={nav}>
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col overflow-hidden bg-background text-foreground lg:max-w-[560px]">
        {top ? (
          <PushScreen route={top} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              {tab === "search" && <SearchScreen />}
              {tab === "task" && <RoyTasksScreen />}
              {tab === "book" && <RoyBaseScreen />}
              {tab === "cal" && (
                <div className="flex h-full flex-col">
                  <AgentReviewQueue onOpen={(id) => push({ view: "meetingReview", params: { id } })} />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <MeetingsScreen />
                  </div>
                </div>
              )}
            </div>
            <RoyTabBar active={tab} onChange={(id) => setTab(id as RoyTab)} />
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
    </RoyNavContext.Provider>
  );
}

function PushScreen({ route }: { route: RoyRoute }) {
  if (route.view === "meetingReview") return <MeetingReviewScreen id={route.params.id} />;
  if (route.view === "answer") return <AnswerScreen query={route.params.query} />;
  if (route.view === "record") return <RecordDetail id={route.params.id} />;
  if (route.view === "taskDetail") return <TaskDetail id={route.params.id} />;
  if (route.view === "newTask") return <NewTask id={route.params?.id} />;
  if (route.view === "newEntry") return <NewEntry />;
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
