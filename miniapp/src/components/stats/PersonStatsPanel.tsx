"use client";
import type { ReactNode } from "react";
import type { PeopleStatsResponse, PersonStats } from "@/lib/api";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";
import { useDt } from "@/components/roy/nav";

// Плитки по одному человеку. Пустое значение — «—», а не 0: «нет данных» и «ноль» читаются
// по-разному (доля в срок без единой задачи со сроком — не 0% и не 100%).

export function PersonStatsPanel({ person: p, meta }: { person: PersonStats; meta: PeopleStatsResponse }) {
  const dt = useDt();
  const locale = dt("ru-RU", "en-GB");
  const t = p.tasks;
  const last = p.activity.lastActiveAt
    ? new Date(p.activity.lastActiveAt).toLocaleDateString(locale, { day: "numeric", month: "long" })
    : null;

  return (
    <div className="mx-auto max-w-[880px]">
      <header className="mb-5 flex items-center gap-3">
        <Avatar size={40}>{initials(p.name)}</Avatar>
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-ink" style={{ fontSize: 18 }}>{p.name}</h2>
          <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
            {last
              ? dt(`Последняя активность — ${last}`, `Last active ${last}`)
              : dt("Активности за 90 дней нет", "No activity in 90 days")}
          </p>
        </div>
      </header>

      {meta.tasksTruncated && (
        <p className="mb-4 rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-ink-soft" style={{ fontSize: 12.5 }}>
          {dt("Задач больше, чем помещается в выборку, — числа по задачам неполные.", "More tasks than the sample holds — task numbers are incomplete.")}
        </p>
      )}

      <Group title={dt("Задачи сейчас", "Tasks now")}>
        <Tile label={dt("Открыто", "Open")} value={t.open} />
        <Tile label={dt("В работе", "In progress")} value={t.inProgress} />
        <Tile label={dt("Просрочено", "Overdue")} value={t.overdue} tone={t.overdue > 0 ? "bad" : undefined} />
        <Tile label={dt("Закрыто всего", "Closed, all time")} value={t.closed} />
      </Group>

      <Group title={dt(`За ${meta.closedWindowDays} дней`, `Last ${meta.closedWindowDays} days`)}>
        <Tile label={dt("Закрыто", "Closed")} value={t.closedRecent} />
        <Tile label={dt("В срок", "On time")}
          value={t.onTimeRate == null ? null : `${Math.round(t.onTimeRate * 100)}%`}
          sub={t.onTimeBase ? dt(`из ${t.onTimeBase} со сроком`, `of ${t.onTimeBase} with a due date`) : dt("не было задач со сроком", "no tasks with a due date")} />
        <Tile label={dt("Среднее время закрытия", "Average time to close")}
          value={t.avgCloseDays == null ? null : dt(`${t.avgCloseDays} дн.`, `${t.avgCloseDays} d`)} />
      </Group>

      <Group title={dt("Встречи", "Meetings")}>
        <Tile label={dt("Опубликовано", "Published")} value={p.meetings.published} />
        <Tile label={dt("На вычитке", "In review")} value={p.meetings.inReview}
          tone={p.meetings.inReview > 0 ? "warn" : undefined} />
      </Group>

      <Group title={dt(`Активность за ${meta.activityDays} дней`, `Activity, last ${meta.activityDays} days`)}>
        <Tile label={dt("Активных дней", "Active days")} value={`${p.activity.activeDays} / ${meta.activityDays}`}
          sub={dt("правки задач, комментарии, записи, встречи", "task edits, comments, entries, recordings")}>
          <div className="mt-3"><ActivityStrip strip={p.activity.strip} size={14} /></div>
        </Tile>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 font-semibold uppercase text-ink-soft" style={{ fontSize: 10.5, letterSpacing: "0.07em" }}>{title}</h3>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>{children}</div>
    </section>
  );
}

const TONE = { bad: "text-pri-high", warn: "text-pri-med" } as const;

function Tile({ label, value, sub, tone, children }: {
  label: string; value: number | string | null; sub?: string; tone?: keyof typeof TONE; children?: ReactNode;
}) {
  return (
    <div className={children ? "col-span-full rounded-[10px] border border-line bg-surface px-4 py-3" : "rounded-[10px] border border-line bg-surface px-4 py-3"}>
      <div className="text-ink-soft" style={{ fontSize: 12 }}>{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${tone ? TONE[tone] : "text-ink"}`} style={{ fontSize: 24, lineHeight: 1.15 }}>
        {value ?? <span className="text-ink-mute">—</span>}
      </div>
      {sub && <div className="mt-0.5 text-ink-mute" style={{ fontSize: 11.5 }}>{sub}</div>}
      {children}
    </div>
  );
}

/** Полоска по дням, старый день слева. Насыщенность — сколько действий было в день. */
export function ActivityStrip({ strip, size }: { strip: number[]; size: number }) {
  const max = Math.max(1, ...strip);
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {strip.map((n, i) => (
        <span key={i} className="shrink-0 rounded-[2px]"
          style={{
            width: size, height: size,
            background: n === 0
              ? "var(--color-line)"
              : `color-mix(in oklab, var(--color-accent-ink) ${Math.round(35 + (65 * n) / max)}%, transparent)`,
          }} />
      ))}
    </span>
  );
}
