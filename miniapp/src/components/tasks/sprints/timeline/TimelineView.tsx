"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSprintBoard, fetchSprintCycle } from "@/lib/api";
import {
  buildColumns,
  buildGroups,
  type MoveMark,
  PAST_VISIBLE,
  summarize,
  type TaskRowModel,
} from "@/lib/sprintTimeline";
import type { SprintBoardData, SprintCycleItem, User } from "@/types";
import { useDt } from "@/components/roy/nav";
import { namesOf } from "../board/boardModel";
import { Backdrop, GroupBlock, MIN_W, TimelineHead } from "./TimelineGrid";
import { MoveTip, type TipState } from "./MoveTip";
import { TimelineLegend } from "./TimelineLegend";
import { TimelineSummary } from "./TimelineSummary";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
};
/** Сколько групп раскрыто при входе: лента на сотню строк сразу была бы стеной. */
const OPEN_BY_DEFAULT = 3;

/**
 * Вид «Лента времени» (стенд под флагом, решение 12.11.2026): спринты пространства горизонтальной шкалой,
 * слева группы и задачи, задача — отрезок через спринты, перенос — чип со стрелкой и причиной на наведении.
 * Только чтение: данные — `GET /sprint-cycles/board` плюс состав последних принятых спринтов ради причин
 * их переносов. Клик по задаче — существующая карточка.
 */
export function TimelineView({ space, users, reloadKey, onOpenTask }: {
  space: string | null;
  users: readonly User[];
  reloadKey: number;
  onOpenTask: (taskId: string) => void;
}) {
  const dt = useDt();
  const [data, setData] = useState<SprintBoardData | null>(null);
  const [pastMoved, setPastMoved] = useState<
    ReadonlyMap<string, SprintCycleItem[]>
  >(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [person, setPerson] = useState<string>("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string> | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const board = await fetchSprintBoard(space);
      const accepted = board.cycles
        .filter((c) => c.cycle.status === "accepted")
        .sort((a, b) => a.cycle.start_date.localeCompare(b.cycle.start_date))
        .slice(-PAST_VISIBLE);
      // Принятые приходят без состава: причины их переносов берём из карточки спринта.
      const details = await Promise.all(
        accepted.map((c) => fetchSprintCycle(c.cycle.id).catch(() => null)),
      );
      setPastMoved(
        new Map(
          accepted.flatMap((
            c,
            i,
          ) => (details[i]
            ? [[c.cycle.id, details[i]!.moved ?? []] as const]
            : [])
          ),
        ),
      );
      setData(board);
      setErr(null);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось загрузить ленту", "Could not load the timeline"),
      );
    }
  }, [space, dt]);

  useEffect(() => {
    setData(null);
    load();
  }, [load, reloadKey]);

  const cols = useMemo(() => (data ? buildColumns(data, pastMoved) : []), [
    data,
    pastMoved,
  ]);
  const allGroups = useMemo(() => (data ? buildGroups(data, cols) : []), [
    data,
    cols,
  ]);
  const summary = useMemo(() => summarize(cols, today), [cols, today]);

  const namesOfRow = useCallback(
    (r: TaskRowModel) =>
      namesOf(r.task.assignees, r.task.assignee_telegram_ids, users),
    [users],
  );
  const people = useMemo(
    () =>
      [...new Set(allGroups.flatMap((g) => g.rows.flatMap(namesOfRow)))].sort((
        a,
        b,
      ) => a.localeCompare(b)),
    [allGroups, namesOfRow],
  );
  const groups = useMemo(
    () =>
      allGroups
        .map((g) => ({
          ...g,
          rows: g.rows.filter((r) =>
            (!person || namesOfRow(r).includes(person)) &&
            (!attentionOnly || r.attention)
          ),
        }))
        .filter((g) => g.rows.length > 0),
    [allGroups, person, attentionOnly, namesOfRow],
  );
  const parents = useMemo(
    () => new Set(allGroups.flatMap((g) => g.rows.map((r) => r.task.id))),
    [allGroups],
  );
  const collapsed = closed ??
    new Set(groups.slice(OPEN_BY_DEFAULT).map((g) => g.id));
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setClosed(next);
  };

  const hover = useCallback(
    (mark: MoveMark | null, el: HTMLElement | null, row: TaskRowModel) => {
      setTip(
        mark && el ? { mark, row, rect: el.getBoundingClientRect() } : null,
      );
    },
    [],
  );
  const userName = useCallback(
    (id: number | null) =>
      users.find((u) => u.telegram_id === id)?.name ?? null,
    [users],
  );

  if (err) {
    return (
      <p className="px-5 py-10 text-center text-sm text-destructive">{err}</p>
    );
  }
  if (!data) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-soft/70">
        {dt("Загружаем ленту…", "Loading the timeline…")}
      </p>
    );
  }
  if (cols.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-soft/70">
        {dt(
          "В этом пространстве нет спринтов для ленты.",
          "This space has no sprints to show on the timeline.",
        )}
      </p>
    );
  }
  const taskCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const select =
    "h-[30px] rounded-[7px] border border-line-2 bg-surface px-2 text-ink-soft outline-none focus:border-accent-line";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3 lg:px-5">
      <TimelineSummary
        s={summary}
        dt={dt}
        attentionOnly={attentionOnly}
        onToggleAttention={() => setAttentionOnly((v) => !v)}
      />
      <div className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
        <select
          aria-label={dt("Фильтр по человеку", "Filter by person")}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className={select}
        >
          <option value="">{dt("Все люди", "Everyone")}</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          type="button"
          className="px-2 text-ink-soft hover:text-ink"
          onClick={() => setClosed(new Set())}
        >
          {dt("Развернуть все", "Expand all")}
        </button>
        <button
          type="button"
          className="px-2 text-ink-soft hover:text-ink"
          onClick={() => setClosed(new Set(groups.map((g) => g.id)))}
        >
          {dt("Свернуть все", "Collapse all")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
        <div className="relative" style={{ minWidth: MIN_W }}>
          <Backdrop cols={cols} today={today} />
          <TimelineHead
            cols={cols}
            today={today}
            dt={dt}
            groupsLabel={dt("Группы", "Groups")}
            tasksLabel={dt(`${taskCount} задач`, `${taskCount} tasks`)}
          />
          {groups.length === 0
            ? (
              <p className="relative z-[1] px-5 py-10 text-center text-sm text-ink-soft/70">
                {dt(
                  "Под фильтр ничего не подходит.",
                  "Nothing matches the filter.",
                )}
              </p>
            )
            : groups.map((g) => (
              <GroupBlock
                key={g.id}
                group={g}
                cols={cols}
                open={!collapsed.has(g.id)}
                onToggle={() => toggle(g.id)}
                dt={dt}
                onOpen={onOpenTask}
                onHover={hover}
                indexOfParent={parents}
              />
            ))}
        </div>
      </div>
      <TimelineLegend dt={dt} />
      {tip && <MoveTip tip={tip} cols={cols} userName={userName} dt={dt} />}
    </div>
  );
}
