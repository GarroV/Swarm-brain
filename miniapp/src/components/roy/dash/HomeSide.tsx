"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { deriveEntryTitle } from "../entry";
import { homeNews, type NewsItem, type NewsKind, type NewsTarget } from "@/lib/homeTasks";
import { openSourceRoute, useDt, useRoyNav } from "../nav";
import { DashBlock, HomeLabel } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Правая колонка главной по стенду (screens-home.js → .news/.nw): короткие строки с точкой
// состояния. Встречи дня — MeetingsToday; здесь «Топ 5 новостей», «Ждут вас», «Последнее в базе».

const DOT: Record<NewsKind | "none", string> = {
  bad: "bg-pri-high",
  warn: "bg-pri-med",
  ok: "bg-status-done",
  none: "bg-ink-mute",
};

function NewsRow({ kind = "none", onClick, right, children }: {
  kind?: NewsKind | "none";
  onClick?: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const cls = "flex min-h-[30px] w-full items-center gap-2 py-1 text-left text-ink-soft";
  const body = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[kind])} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right && <span className="shrink-0 text-ink-mute" style={{ fontSize: 11.5 }}>{right}</span>}
    </>
  );
  if (!onClick) return <div className={cls} style={{ fontSize: 13 }}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:text-ink")} style={{ fontSize: 13 }}>
      {body}
    </button>
  );
}

export function HomeNews({ data, overdue, closedWeek, meetingsToday }: {
  data: DashboardData;
  overdue: number;
  closedWeek: number;
  meetingsToday: number | null;
}) {
  const dt = useDt();
  const { openTasks, push } = useRoyNav();
  const go: Record<NewsTarget, () => void> = {
    tasks: () => openTasks("mine", "all"),
    meetings: () => push({ view: "meetAdmin" }),
    base: () => push({ view: "base" }),
  };
  const items: NewsItem[] = homeNews({
    overdue,
    pendingReview: data.pendingMeetings,
    meetingsToday,
    agentProposals: data.reviewCount,
    closedWeek,
  }, dt);
  return (
    <section>
      <HomeLabel>{dt("Топ 5 новостей", "Top 5 news")}</HomeLabel>
      {items.map((n) => <NewsRow key={n.text} kind={n.kind} onClick={go[n.target]}>{n.text}</NewsRow>)}
    </section>
  );
}

export function WaitingForYou({ data }: { data: DashboardData }) {
  const dt = useDt();
  const { push } = useRoyNav();
  const { meetingsState, pendingList, reviewList } = data;
  const empty = pendingList.length === 0 && reviewList.length === 0;
  return (
    <DashBlock
      flat
      title={dt("Ждут вас", "Waiting for you")}
      icon="cal"
      tint="var(--meet-ink)"
      loading={meetingsState.loading}
      failed={meetingsState.failed}
      onRetry={meetingsState.retry}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
      empty={false}
      emptyText=""
    >
      {empty && <NewsRow kind="ok">{dt("Вычитка разобрана", "Review queue is clear")}</NewsRow>}
      {pendingList.slice(0, 4).map((e) => (
        <NewsRow key={e.id} kind="warn" right={dt("вычитка", "review")}
          onClick={() => push({ view: "meetingDetail", params: { id: e.id } })}>
          {deriveEntryTitle(e)}
        </NewsRow>
      ))}
      {/* Черновики рекордера — тот же ярус вычитки, открываются на экране ревью. */}
      {reviewList.slice(0, 4).map((m) => (
        <NewsRow key={m.id} kind="warn" right={dt("черновик", "draft")} onClick={() => push({ view: "meetAdmin" })}>
          {m.title ?? dt("Запись без названия", "Untitled recording")}
        </NewsRow>
      ))}
    </DashBlock>
  );
}

export function LatestInBase({ data }: { data: DashboardData }) {
  const dt = useDt();
  const { push } = useRoyNav();
  const open = openSourceRoute(push);
  const locale = dt("ru-RU", "en-GB");
  const day = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
  };
  return (
    <DashBlock
      flat
      title={dt("Последнее в базе", "Latest in the base")}
      icon="book"
      tint="var(--accent-ink)"
      loading={data.materialsState.loading}
      failed={data.materialsState.failed}
      onRetry={data.materialsState.retry}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
      empty={data.latest.length === 0}
      emptyText={dt("В базе пока пусто", "The base is empty so far")}
    >
      {data.latest.map((e) => (
        <NewsRow key={e.id} right={day(e.created_at)} onClick={() => open(e)}>
          {deriveEntryTitle(e)}
        </NewsRow>
      ))}
    </DashBlock>
  );
}
