"use client";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";
import type { TaskSection } from "@/lib/taskTable";
import { isDone, isOverdue } from "@/lib/smartLists";
import { homeDateReason } from "@/lib/homeTasks";
import { RoyIcon } from "../icons";
import { useDt, useRoyNav } from "../nav";

// Таблица задач главной по стенду (screens-home.js → table/homeRow): Задача · Проект · Списки ·
// Срок. Только чтение — правка в карточке задачи по клику, как на стенде. Быстрые действия
// строки живут на экране «Задачи»: главная показывает, что горит, а не дублирует доску.

const COLS = "minmax(0,1fr) 26% 18% 84px";
const COLS_NARROW = "minmax(0,1fr) 30% 84px";

const fmtDue = (iso: string, en: boolean) =>
  new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).replace(".", "");
// Пинг — голая дата «YYYY-MM-DD»: читаем как местный день, иначе западнее UTC он уедет на вчера.
const fmtDay = (day: string, en: boolean) => {
  const [y, m, d] = day.split("-").map(Number);
  return fmtDue(new Date(y, m - 1, d).toISOString(), en);
};

export function HomeTaskTable({ sections, projectName, labelNames, showLabels = true, now }: {
  sections: TaskSection[];
  projectName: (t: Task) => string | null;
  labelNames: (t: Task) => string;
  showLabels?: boolean;
  now: Date;
}) {
  const dt = useDt();
  const { openTask } = useRoyNav();
  const cols = showLabels ? COLS : COLS_NARROW;
  const en = dt("ru", "en") === "en";

  return (
    <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_1px_1px_rgba(27,32,40,.03)]" style={{ fontSize: 13 }}>
      <div
        role="row"
        className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
        style={{ gridTemplateColumns: cols, height: 30, fontSize: 10.5, letterSpacing: "0.07em" }}
      >
        <span className="px-3">{dt("Задача", "Task")}</span>
        <span className="px-2">{dt("Проект", "Project")}</span>
        {showLabels && <span className="px-2">{dt("Списки", "Lists")}</span>}
        <span className="px-3 text-right">{dt("Срок", "Due")}</span>
      </div>
      {sections.map((sec) => (
        <div key={sec.key} role="rowgroup">
          {/* Подпись секции без подложки: на главной их до четырёх подряд, серые полосы
              разрезали бы короткую таблицу на ломти (стенд: tr.sect). */}
          {sec.label && (
            <div
              role="row"
              className="flex items-center border-b border-line px-3 font-semibold uppercase text-ink-mute"
              style={{ height: 28, fontSize: 10.5, letterSpacing: "0.07em" }}
            >
              {sec.label} · {sec.tasks.length}
            </div>
          )}
          {sec.tasks.map((t) => (
            <HomeRow key={`${sec.key}:${t.id}`} task={t} cols={cols} showLabels={showLabels} now={now} en={en}
              project={projectName(t)} labels={labelNames(t)} onOpen={() => openTask(t)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function HomeRow({ task, cols, showLabels, now, en, project, labels, onOpen }: {
  task: Task; cols: string; showLabels: boolean; now: Date; en: boolean;
  project: string | null; labels: string; onOpen: () => void;
}) {
  const dt = useDt();
  const late = isOverdue(task, now);
  const reason = homeDateReason(task, now);
  const pingLabel = dt("Пинг", "Reminder");
  const dueLabel = dt("срок", "due");
  const dot = isDone(task) ? "bg-status-done" : task.status === "in_progress" ? "bg-status-prog" : "bg-status-open";
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="grid cursor-pointer items-center border-b border-line transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      style={{ gridTemplateColumns: cols, minHeight: 34 }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3">
        <span className={cn("size-[7px] shrink-0 rounded-full", dot)} />
        <span className="truncate text-ink">{task.title}</span>
      </div>
      <div className="min-w-0 truncate px-2 text-ink-soft">{project ?? <span className="text-ink-mute">—</span>}</div>
      {showLabels && <div className="min-w-0 truncate px-2 text-ink-soft">{labels || <span className="text-ink-mute">—</span>}</div>}
      {/* Задачу на главную поднял пинг (homeDateReason) — в колонке его дата с колокольчиком,
          срок — в подсказке: иначе строка в «Сегодня» показывала бы срок через год. */}
      {reason?.kind === "ping" ? (
        <div className="flex items-center justify-end gap-1 px-3 font-mono" style={{ fontSize: 12, color: "var(--accent-ink)" }}
          title={task.due_date ? `${pingLabel} · ${dueLabel} ${fmtDue(task.due_date, en)}` : pingLabel}>
          <RoyIcon name="bell" size={12} strokeWidth={1.9} />
          {fmtDay(reason.date, en)}
        </div>
      ) : (
        <div className={cn("px-3 text-right font-mono", late ? "font-semibold text-pri-high" : "text-ink-soft")} style={{ fontSize: 12 }}>
          {task.due_date ? fmtDue(task.due_date, en) : <span className="text-ink-mute">—</span>}
        </div>
      )}
    </div>
  );
}
