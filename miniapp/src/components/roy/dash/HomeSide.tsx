"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { deriveEntryTitle } from "../entry";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/types";
import { fetchNotifications, fetchSprintCycle, fetchSprintCycles, fetchTask, markNotificationsRead, type SwarmNotification } from "@/lib/api";
import { toISO } from "@/lib/calendar";
import { checkpointReminder, freshComments, hotTasks, type CheckpointReminder, type CycleWithItems } from "@/lib/homeNews";
import { openSourceRoute, useDt, useRoyNav } from "../nav";
import { DashBlock, HomeLabel } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Правая колонка главной по стенду (screens-home.js → .news/.nw): короткие строки с точкой
// состояния. Встречи дня — MeetingsToday; здесь «Новости» и «Последнее в базе».

type NewsKind = "bad" | "warn" | "ok";

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

// «Новости» (решение владельца 2026-09-25): новые комментарии к моим задачам — только если они
// есть, горящие задачи, встречи на вычитке (бывший блок «Ждут вас») и напоминание отметиться на
// чекпоинте спринта. Пустая часть не рисуется; если пусто всё — одна строка «всё спокойно».
export function HomeNews({ data, now }: { data: DashboardData; now: Date }) {
  const dt = useDt();
  const { push, openTask, setTab } = useRoyNav();
  const extra = useNewsExtras(data.mine);
  const hot = useMemo(() => hotTasks(data.mine, now), [data.mine, now]);
  const { pendingList, reviewList } = data;
  const reviews = pendingList.length + reviewList.length;
  const locale = dt("ru-RU", "en-GB");
  const day = (iso: string) => {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
  };
  const today = toISO(now);
  const openComment = async (n: SwarmNotification) => {
    if (!n.task_id) return;
    markNotificationsRead([n.id]).catch((e) => console.warn("[HomeNews] mark read", e));
    try { openTask(await fetchTask(n.task_id)); } catch (e) { console.error("[HomeNews] open task", e); }
  };
  const quiet = !extra.comments.length && !hot.length && !reviews && !extra.checkpoint;

  return (
    <section>
      <HomeLabel>{dt("Новости", "News")}</HomeLabel>
      {quiet && <NewsRow kind="ok">{dt("Всё спокойно: горящих задач и вычитки нет", "All quiet: nothing urgent, nothing to review")}</NewsRow>}
      {extra.checkpoint && (
        <NewsRow kind="warn" onClick={() => setTab("sprints")}
          right={day(extra.checkpoint.checkDate)}>
          {dt(`Чекпоинт «${extra.checkpoint.name}»: отметьте ${extra.checkpoint.pending} ${plural(extra.checkpoint.pending, "задачу", "задачи", "задач")}`,
            `Checkpoint “${extra.checkpoint.name}”: update ${extra.checkpoint.pending} task${extra.checkpoint.pending === 1 ? "" : "s"}`)}
        </NewsRow>
      )}
      {extra.comments.map((n) => (
        <NewsRow key={n.id} kind="warn" onClick={() => openComment(n)} right={n.actor_name}>
          <span className="text-ink">{n.task_title}</span>
          <span className="text-ink-mute"> — {n.content}</span>
        </NewsRow>
      ))}
      {hot.map((t) => {
        const d = t.due_date ? toISO(new Date(t.due_date)) : "";
        return (
          <NewsRow key={t.id} kind={d < today ? "bad" : "warn"} onClick={() => openTask(t)}
            right={d < today ? dt("просрочено", "overdue") : d === today ? dt("сегодня", "today") : dt("завтра", "tomorrow")}>
            {t.title}
          </NewsRow>
        );
      })}
      {pendingList.slice(0, REVIEW_ROWS).map((e) => (
        <NewsRow key={e.id} kind="warn" right={dt("вычитка", "review")}
          onClick={() => push({ view: "meetingDetail", params: { id: e.id } })}>
          {deriveEntryTitle(e)}
        </NewsRow>
      ))}
      {/* Черновики рекордера — тот же ярус вычитки, открываются вычиткой в панели. */}
      {reviewList.slice(0, REVIEW_ROWS).map((m) => (
        <NewsRow key={m.id} kind="warn" right={dt("черновик", "draft")} onClick={() => push({ view: "meetingReview", params: { id: m.id } })}>
          {m.title ?? dt("Запись без названия", "Untitled recording")}
        </NewsRow>
      ))}
    </section>
  );
}

const REVIEW_ROWS = 4;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Комментарии — из ленты уведомлений (сервер уже пишет task_comment каждому причастному),
// чекпоинт — из живых спринтов. Сбой любого источника гасит только свою часть блока.
function useNewsExtras(mine: Task[]): { comments: SwarmNotification[]; checkpoint: CheckpointReminder | null } {
  const [comments, setComments] = useState<SwarmNotification[]>([]);
  const [cycles, setCycles] = useState<CycleWithItems[]>([]);
  useEffect(() => {
    let alive = true;
    fetchNotifications()
      .then((r) => { if (alive) setComments(freshComments(r.items)); })
      .catch((e) => console.warn("[HomeNews] notifications", e));
    fetchSprintCycles()
      .then((all) => Promise.all(all.filter((c) => c.status === "active").map((c) =>
        fetchSprintCycle(c.id).then(({ items, ...cycle }) => ({ cycle, items })))))
      .then((list) => { if (alive) setCycles(list); })
      .catch((e) => console.warn("[HomeNews] sprint cycles", e));
    return () => { alive = false; };
  }, []);
  const checkpoint = useMemo(
    () => checkpointReminder(cycles, new Set(mine.map((t) => t.id)), new Date()),
    [cycles, mine],
  );
  return { comments, checkpoint };
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
