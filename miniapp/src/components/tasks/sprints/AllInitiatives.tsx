"use client";
import { useMemo, useState } from "react";
import type { Project, Task, User } from "@/types";
import { buildBoard, isBareDirection } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { AssigneeChip, DueBadge, ProgressBar, ProgressText } from "./atoms";
import { fmtDay, isOverdue } from "./format";

// «Все инициативы» — вид на ПРОСТРАНСТВО, а не на спринт: здесь видно всю стройку, включая
// то, что в текущий спринт не попало. Отсюда же задача берётся в живой спринт кнопкой, иначе
// набор состава возможен только из пула, а пул не знает про инициативы.
//
// Дерево строит та же функция, что и список спринта (`buildBoard`): правило раскладки одно,
// и две его копии разъехались бы на первом же подпроекте.

const CLOSED = new Set(["done", "cancelled"]);

/** Ответственный и сроки инициативы — правятся здесь же: ради одного поля уходить в другой
 *  экран никто не станет, и поля остались бы пустыми. */
function InitiativeFields(
  { project, users, onSave, onCancel }: {
    project: Project;
    users: User[];
    onSave: (
      patch: {
        owner_telegram_id: number | null;
        start_date: string | null;
        end_date: string | null;
      },
    ) => void;
    onCancel: () => void;
  },
) {
  const dt = useDt();
  const [owner, setOwner] = useState(
    project.owner_telegram_id?.toString() ?? "",
  );
  const [start, setStart] = useState(project.start_date ?? "");
  const [end, setEnd] = useState(project.end_date ?? "");
  const wrong = start !== "" && end !== "" && start > end;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 px-2.5 py-2">
      <select
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none"
      >
        <option value="">{dt("без ответственного", "no owner")}</option>
        {users.map((u) => (
          <option key={u.telegram_id} value={u.telegram_id}>{u.name}</option>
        ))}
      </select>
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none"
      />
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none"
      />
      {
        /* Отказ приходит до сохранения: сервер отобьёт то же самое, но человек увидит это
          после нажатия и не свяжет с датами. */
      }
      {wrong && (
        <span className="text-[11px] text-destructive">
          {dt("начало позже конца", "start is after the end")}
        </span>
      )}
      <button
        type="button"
        disabled={wrong}
        onClick={() =>
          onSave({
            owner_telegram_id: owner === "" ? null : parseInt(owner, 10),
            start_date: start || null,
            end_date: end || null,
          })}
        className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {dt("Сохранить", "Save")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-1.5 text-xs text-ink-soft"
      >
        {dt("Отмена", "Cancel")}
      </button>
    </div>
  );
}

/** Строка задачи в «Инициативах». Задача здесь живая: правки идут в саму задачу, а не в
 *  состав спринта, поэтому клик открывает карточку. */
function TaskLine(
  { task, inSprint, sprintName, onAddToSprint, onOpenTask }: {
    task: Task;
    inSprint: Set<string>;
    sprintName: string | null;
    onAddToSprint: (taskId: string) => void;
    onOpenTask: (task: Task) => void;
  },
) {
  const dt = useDt();
  const closed = CLOSED.has(task.status);
  const taken = inSprint.has(task.id);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <button
        type="button"
        onClick={() => onOpenTask(task)}
        className="min-w-0 flex-1 truncate text-left text-sm text-ink"
      >
        <span className={closed ? "text-ink-soft line-through" : ""}>
          {task.title}
        </span>
      </button>
      {task.assignees.length === 0
        ? <AssigneeChip name={null} />
        : task.assignees.map((a) => <AssigneeChip key={a} name={a} />)}
      {task.due_date && <DueBadge date={task.due_date} closed={closed} />}
      {
        /* Кнопка только у того, что взять можно: закрытую задачу в спринт не берут, а уже
          взятая подписана, а не молчит. */
      }
      {sprintName && !closed && (taken
        ? (
          <span className="whitespace-nowrap rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-soft">
            {dt("в спринте", "in the sprint")}
          </span>
        )
        : (
          <button
            type="button"
            onClick={() =>
              onAddToSprint(task.id)}
            className="whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink-soft hover:bg-surface-2"
          >
            {dt(`в «${sprintName}»`, `to “${sprintName}”`)}
          </button>
        ))}
    </div>
  );
}

export function AllInitiatives(
  {
    tasks,
    projects,
    users,
    inSprint,
    sprintName,
    onAddToSprint,
    onOpenTask,
    onSaveProject,
  }: {
    tasks: Task[];
    projects: Project[];
    users: User[];
    /** id задач, уже взятых в открытый спринт. */
    inSprint: Set<string>;
    /** Имя живого спринта; null — брать некуда, кнопку не показываем. */
    sprintName: string | null;
    onAddToSprint: (taskId: string) => void;
    onOpenTask: (task: Task) => void;
    onSaveProject: (id: string, patch: {
      owner_telegram_id: number | null;
      start_date: string | null;
      end_date: string | null;
    }) => void;
  },
) {
  const dt = useDt();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const board = useMemo(() => buildBoard(tasks, projects), [tasks, projects]);
  const ownerName = (id: number) =>
    users.find((u) => u.telegram_id === id)?.name ?? String(id);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (board.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-soft/70">
        {dt(
          "В этом пространстве пока нет задач с проектом — инициативы появятся вместе с ними.",
          "No tasks with a project in this space yet — initiatives appear together with them.",
        )}
      </p>
    );
  }

  return (
    <div className="flex-1 min-w-0 space-y-4 overflow-y-auto">
      {board.map((dir) => (
        <section key={dir.project?.id ?? "__none__"} className="space-y-1.5">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
            {dir.project?.emoji && (
              <span className="text-sm">{dir.project.emoji}</span>
            )}
            <h3 className="min-w-0 truncate text-sm font-bold text-ink">
              {dir.project?.name ?? dt("Без направления", "No direction")}
            </h3>
            <div className="ml-auto flex items-center gap-2">
              <ProgressBar percent={dir.progress.percent} className="w-24" />
              <ProgressText progress={dir.progress} />
            </div>
          </header>

          <div className="space-y-1.5">
            {isBareDirection(dir) && (
              <div className="rounded-xl border border-line bg-surface/40 px-1 py-1 dark:backdrop-blur-sm">
                {dir.initiatives[0].items.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    inSprint={inSprint}
                    sprintName={sprintName}
                    onAddToSprint={onAddToSprint}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </div>
            )}
            {(isBareDirection(dir) ? [] : dir.initiatives).map((ini) => {
              const key = `${dir.project?.id ?? ""}/${ini.project?.id ?? ""}`;
              const shut = collapsed.has(key);
              const p = ini.project;
              const late = !!p?.end_date && isOverdue(p.end_date) &&
                ini.progress.done < ini.progress.total;
              return (
                <div
                  key={key}
                  className="rounded-xl border border-line bg-surface/40 dark:backdrop-blur-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <RoyIcon
                        name={shut ? "cright" : "arrow"}
                        size={12}
                        className="shrink-0 text-ink-soft"
                      />
                      {p?.emoji && <span className="text-sm">{p.emoji}</span>}
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">
                        {p?.name ?? dt("Общее", "General")}
                      </span>
                      {p?.owner_telegram_id && (
                        <span className="whitespace-nowrap text-[11px] text-ink-soft">
                          · {ownerName(p.owner_telegram_id)}
                        </span>
                      )}
                      {p?.end_date && (
                        <span
                          className={`whitespace-nowrap text-[11px] ${
                            late
                              ? "font-semibold text-pri-high"
                              : "text-ink-soft"
                          }`}
                        >
                          · {dt("до", "due")} {fmtDay(p.end_date)}
                          {late ? dt(" · просрочена", " · overdue") : ""}
                        </span>
                      )}
                    </button>
                    <ProgressBar
                      percent={ini.progress.percent}
                      className="w-20"
                    />
                    <ProgressText progress={ini.progress} />
                    {p && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing(editing === p.id ? null : p.id)}
                        title={dt("Ответственный и сроки", "Owner and dates")}
                        className="rounded p-1 text-ink-soft hover:text-ink"
                      >
                        <RoyIcon name="pencil" size={12} />
                      </button>
                    )}
                  </div>

                  {p && editing === p.id && (
                    <InitiativeFields
                      project={p}
                      users={users}
                      onCancel={() => setEditing(null)}
                      onSave={(patch) => {
                        onSaveProject(p.id, patch);
                        setEditing(null);
                      }}
                    />
                  )}

                  {!shut && (
                    <div className="border-t border-line/60 px-1 py-1">
                      {ini.items.map((task) => (
                        <TaskLine
                          key={task.id}
                          task={task}
                          inSprint={inSprint}
                          sprintName={sprintName}
                          onAddToSprint={onAddToSprint}
                          onOpenTask={onOpenTask}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
