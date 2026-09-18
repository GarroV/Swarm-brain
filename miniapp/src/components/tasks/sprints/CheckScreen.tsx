"use client";
import { useMemo, useState } from "react";
import type { CheckStatus, SprintCycleDetail, SprintCycleItem } from "@/types";
import { sprintKpi } from "@/lib/initiatives";
import { useDt } from "@/components/roy/nav";
import { CarryBadge } from "./atoms";
import { fmtDay } from "./format";

// Сверка — середина спринта: короткий ритуал, на котором каждый говорит одно из трёх и,
// если не «по плану», одним предложением почему. Отдельной линзой, а не колонкой в списке,
// потому что вопрос здесь другой: не «что сделано», а «что не доедет».
//
// Задачи сгруппированы по исполнителю: ритуал идёт по людям, а не по проектам — человек
// должен видеть свои строки рядом, а не искать их по дереву.

const CLOSED = new Set(["done", "cancelled"]);

/** Ключ группы. У задачи бывает несколько исполнителей — держимся первого: ритуал ведёт
 *  один человек, и одна и та же задача, названная дважды, удлиняет встречу вдвое. */
function personOf(item: SprintCycleItem): string | null {
  return item.assignees[0] ?? null;
}

const MARKS: { id: CheckStatus; ru: string; en: string; cls: string }[] = [
  {
    id: "ok",
    ru: "по плану",
    en: "on track",
    cls: "border-status-done/50 bg-status-done/15 text-status-done",
  },
  {
    id: "risk",
    ru: "риск",
    en: "at risk",
    cls: "border-pri-med/50 bg-pri-med/15 text-pri-med",
  },
  {
    id: "problem",
    ru: "проблема",
    en: "problem",
    cls: "border-pri-high/50 bg-pri-high/15 text-pri-high",
  },
];

/** Шкала ритуала: где спринт относительно дня сверки. Читается быстрее любой подписи. */
function RitualScale({ cycle }: { cycle: SprintCycleDetail }) {
  const dt = useDt();
  const start = new Date(`${cycle.start_date}T00:00:00`).getTime();
  const end = new Date(`${cycle.end_date}T23:59:59`).getTime();
  const span = Math.max(1, end - start);
  const at = (t: number) =>
    Math.max(0, Math.min(100, ((t - start) / span) * 100));
  const now = at(Date.now());
  const check = cycle.check_date
    ? at(new Date(`${cycle.check_date}T00:00:00`).getTime())
    : null;

  return (
    <div className="space-y-1">
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary/40"
          style={{ width: `${now}%` }}
        />
        {check !== null && (
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--background)] bg-pri-med"
            style={{ left: `${check}%` }}
            title={dt(
              `сверка ${fmtDay(cycle.check_date!)}`,
              `check-in on ${fmtDay(cycle.check_date!)}`,
            )}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-ink-soft">
        <span>{fmtDay(cycle.start_date)}</span>
        {cycle.check_date && (
          <span className="font-semibold text-pri-med">
            {dt("сверка", "check-in")} {fmtDay(cycle.check_date)}
          </span>
        )}
        <span>{fmtDay(cycle.end_date)}</span>
      </div>
    </div>
  );
}

export function CheckScreen(
  { cycle, unchecked, onMark }: {
    cycle: SprintCycleDetail;
    unchecked: boolean;
    onMark: (
      item: SprintCycleItem,
      patch: Partial<
        Pick<
          SprintCycleItem,
          "check_status" | "check_note" | "to_carry" | "carry_reason"
        >
      >,
    ) => void;
  },
) {
  const dt = useDt();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const kpi = useMemo(() => sprintKpi(cycle.items), [cycle.items]);

  // Отмечают только живые и незакрытые: закрытую задачу сверять нечего, а упоминание
  // удалённой и чужая приватная строка не принадлежат никому на этой встрече.
  const groups = useMemo(() => {
    const open = cycle.items.filter((i) =>
      !i.removed && !i.hidden && !CLOSED.has(i.status)
    );
    const map = new Map<string, SprintCycleItem[]>();
    for (const item of open) {
      const key = personOf(item) ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    // «Без исполнителя» — последним: это не человек, а дыра в планировании.
    return [...map.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)
    );
  }, [cycle.items]);

  return (
    <div className="flex-1 min-w-0 space-y-4 overflow-y-auto">
      <div className="rounded-2xl border border-line bg-surface/40 px-3 py-2.5 dark:backdrop-blur-sm">
        <RitualScale cycle={cycle} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="rounded-full border border-status-done/40 bg-status-done/10 px-2 py-0.5 text-status-done">
            {dt("по плану", "on track")} {kpi.checkOk}
          </span>
          <span className="rounded-full border border-pri-med/40 bg-pri-med/10 px-2 py-0.5 text-pri-med">
            {dt("риск", "at risk")} {kpi.checkRisk}
          </span>
          <span className="rounded-full border border-pri-high/40 bg-pri-high/10 px-2 py-0.5 text-pri-high">
            {dt("проблема", "problem")} {kpi.checkProblem}
          </span>
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-ink-soft">
            {dt("выполнено", "done")} {kpi.done}
          </span>
          {unchecked && kpi.unchecked > 0 && (
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-ink-soft">
              {dt("не отмечено", "not checked")} {kpi.unchecked}
            </span>
          )}
        </div>
      </div>

      {groups.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-soft/70">
          {dt(
            "Сверять нечего: незакрытых задач в спринте нет.",
            "Nothing to check in: no unfinished tasks in this sprint.",
          )}
        </p>
      )}

      {groups.map(([person, items]) => {
        const silent = items.filter((i) => i.check_status === null).length;
        return (
          <section key={person || "__none__"} className="space-y-1.5">
            <header className="flex items-center gap-2 px-0.5">
              <h3 className="text-sm font-bold text-ink">
                {person || dt("Без исполнителя", "Unassigned")}
              </h3>
              <span className="text-[11px] text-ink-soft">{items.length}</span>
              {unchecked && silent > 0 && (
                <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                  {dt(`не отмечено ${silent}`, `not checked ${silent}`)}
                </span>
              )}
            </header>

            <div className="space-y-1.5">
              {items.map((item) => {
                const needsNote = item.check_status === "risk" ||
                  item.check_status === "problem";
                const noteValue = notes[item.id] ?? item.check_note ?? "";
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-line bg-surface/40 px-2.5 py-2 dark:backdrop-blur-sm"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {item.title}
                      </span>
                      <CarryBadge
                        count={item.carry_count}
                        reason={item.carry_reason}
                      />
                      {MARKS.map((m) => {
                        const on = item.check_status === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            // Повторное нажатие снимает отметку: передумать должно быть так
                            // же дёшево, как отметить, иначе люди не отмечают вовсе.
                            onClick={() =>
                              onMark(item, {
                                check_status: on ? null : m.id,
                                ...(on ? { check_note: null } : {}),
                              })}
                            className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                              on
                                ? m.cls
                                : "border-line bg-surface text-ink-soft hover:bg-surface-2"
                            }`}
                          >
                            {dt(m.ru, m.en)}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          onMark(item, { to_carry: !item.to_carry })}
                        className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          item.to_carry
                            ? "border-ink/30 bg-ink text-background"
                            : "border-line bg-surface text-ink-soft hover:bg-surface-2"
                        }`}
                      >
                        {dt("к переносу", "to carry")}
                      </button>
                    </div>

                    {
                      /* Комментарий просим при риске и проблеме — там он и нужен: «риск» без
                        причины на следующей встрече уже никто не помнит. Поле необязательное:
                        принуждение даёт «нет времени» вместо объяснения. */
                    }
                    {(needsNote || item.to_carry) && (
                      <input
                        value={noteValue}
                        onChange={(e) =>
                          setNotes((p) => ({
                            ...p,
                            [item.id]: e.target.value,
                          }))}
                        onBlur={() => {
                          const v = noteValue.trim();
                          const was = item.check_note ?? "";
                          if (v === was.trim()) return;
                          onMark(
                            item,
                            needsNote
                              ? { check_note: v || null }
                              : { carry_reason: v || null },
                          );
                        }}
                        placeholder={needsNote
                          ? dt(
                            "что именно мешает (необязательно)",
                            "what exactly is blocking (optional)",
                          )
                          : dt(
                            "почему переносится (необязательно)",
                            "why it is carried over (optional)",
                          )}
                        className="mt-1.5 w-full rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-primary/50"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
