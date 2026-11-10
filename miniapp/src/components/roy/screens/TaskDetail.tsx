"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRoyNav, useDt } from "../nav";
import { TaskMarkets } from "@/components/tasks/TaskMarkets";
import { NavHeader, RoyCard, PriDot, Market, AvatarStack, SectionLabel, IconBtn, TypeTag } from "../ui";
import { RoyIcon } from "../icons";
import { entryTagKey, deriveEntryTitle } from "../entry";
import { fetchTask, updateTask, deleteTask, fetchMeeting } from "@/lib/api";
import { TaskComments } from "@/components/tasks/TaskComments";
import { TaskFiles } from "@/components/tasks/TaskFiles";
import { displayName } from "@/lib/utils";
import type { Task, Entry } from "@/types";
import { formatDate } from "@/lib/displayFormat";

// Переключателя статусов в карточке БОЛЬШЕ НЕТ (решение владельца 21.09.2026: «статусы в
// самой задаче давай пока скроем. мы к ним привяжемся в проектах и спринтах, но в самом теле
// задач пока скрой эти элементы»). Осталось одно действие — завершить задачу: без него
// закрыть её из карточки было бы нечем, галочка есть только в строке списка.
const PRI_LABEL: Record<string, { ru: string; en: string }> = {
  high: { ru: "Высокий", en: "High" },
  med: { ru: "Средний", en: "Medium" },
  low: { ru: "Низкий", en: "Low" },
};
const TASK_DETAIL_COPY = {
  task: { ru: "Задача", en: "Task" },
  actions: { ru: "Действия", en: "Actions" },
  closeMenu: { ru: "Закрыть меню", en: "Close menu" },
  edit: { ru: "Изменить", en: "Edit" },
  delete: { ru: "Удалить", en: "Delete" },
  deleted: { ru: "Задача удалена", en: "Task deleted" },
  deleteError: { ru: "Не удалось удалить", en: "Could not delete task" },
  loadError: { ru: "Не удалось загрузить задачу.", en: "Could not load task." },
  reopen: { ru: "Вернуть в работу", en: "Reopen" },
  done: { ru: "Готово", en: "Done" },
  assignees: { ru: "Исполнители", en: "Assignees" },
  assignee: { ru: "Исполнитель", en: "Assignee" },
  due: { ru: "Срок", en: "Due" },
  priority: { ru: "Приоритет", en: "Priority" },
  created: { ru: "Создано", en: "Created" },
  source: { ru: "Источник", en: "Source" },
  author: { ru: "Автор", en: "Author" },
  description: { ru: "Описание", en: "Description" },
  linked: { ru: "Связано из базы", en: "Linked from knowledge base" },
} as const;
const norm = (s: string) => (s === "progress" ? "in_progress" : s);
// «Отменена» закрыта так же, как «Готово» — как в statusBucket на экране списка.
const isClosed = (t: Task) => norm(t.status) === "done" || t.status === "cancelled";

function fmtDate(iso: string | null): string {
  return formatDate(iso, { day: "numeric", month: "long" }) ?? "—";
}

// Человекочитаемый источник задачи (провенанс): откуда задача взялась.
const SOURCE_LABEL: Record<string, { ru: string; en: string }> = {
  transcript: { ru: "Из встречи", en: "From meeting" },
  "desktop-agent": { ru: "Из встречи", en: "From meeting" },
  mini_app: { ru: "Веб", en: "Web" },
  claude: { ru: "Claude", en: "Claude" },
  manual: { ru: "Вручную", en: "Manual" },
  file: { ru: "Файл", en: "File" },
  note: { ru: "Заметка", en: "Note" },
};
function sourceLabel(source: string | null, dt: (ru: string, en: string) => string): string {
  if (!source) return "—";
  const label = SOURCE_LABEL[source];
  return label ? dt(label.ru, label.en) : source;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ minHeight: 48 }}>
      <span className="text-ink-soft" style={{ fontSize: 13 }}>
        {label}
      </span>
      <span className="text-right font-medium text-ink" style={{ fontSize: 14 }}>
        {children}
      </span>
    </div>
  );
}

export function TaskDetail({ id }: { id: string }) {
  const { pop, push, toast, me } = useRoyNav();
  const dt = useDt();
  const [t, setT] = useState<Task | null>(null);
  const [meeting, setMeeting] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [loadedGeneration, setLoadedGeneration] = useState<{ id: string } | null>(null);
  // Object identity distinguishes loads even when navigation returns to the same id.
  const currentLoad = useRef<{ id: string } | null>(null);
  const statusOperation = useRef<symbol | null>(null);

  useEffect(() => {
    const load = { id };
    currentLoad.current = load;
    statusOperation.current = null;
    setStatusPending(false);
    setLoadedGeneration(null);
    let alive = true;
    fetchTask(id)
      .then((x) => {
        if (!alive) return;
        setT(x);
        setLoadedGeneration(load);
        if (x.meeting_id) {
          fetchMeeting(x.meeting_id)
            .then((m) => alive && setMeeting(m))
            .catch(() => {/* нет встречи — не показываем секцию */});
        }
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
      if (currentLoad.current === load) {
        currentLoad.current = null;
        statusOperation.current = null;
      }
    };
  }, [id]);

  const setStatus = async (s: string) => {
    const load = loadedGeneration;
    if (!t || t.id !== id || load?.id !== id || load !== currentLoad.current || statusOperation.current) return;
    const operation = Symbol();
    const previousStatus = t.status;
    // Lock synchronously: two click handlers can run before the disabled state renders.
    statusOperation.current = operation;
    setStatusPending(true);
    setT((current) => current?.id === id ? { ...current, status: s } : current);
    const isCurrent = () => currentLoad.current === load && statusOperation.current === operation;
    try {
      await updateTask(id, { status: s });
    } catch {
      if (isCurrent()) {
        setT((current) => current?.id === id ? { ...current, status: previousStatus } : current);
      }
    } finally {
      if (isCurrent()) {
        statusOperation.current = null;
        setStatusPending(false);
      }
    }
  };

  const del = async () => {
    setMenu(false);
    try {
      await deleteTask(id);
      toast(dt(TASK_DETAIL_COPY.deleted.ru, TASK_DETAIL_COPY.deleted.en));
      pop();
    } catch {
      toast(dt(TASK_DETAIL_COPY.deleteError.ru, TASK_DETAIL_COPY.deleteError.en));
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={dt(TASK_DETAIL_COPY.task.ru, TASK_DETAIL_COPY.task.en)} right={<IconBtn name="dots" aria-label={dt(TASK_DETAIL_COPY.actions.ru, TASK_DETAIL_COPY.actions.en)} onClick={() => setMenu((v) => !v)} />} />
      {menu && (
        <>
          <button type="button" aria-label={dt(TASK_DETAIL_COPY.closeMenu.ru, TASK_DETAIL_COPY.closeMenu.en)} className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="roy-pop absolute right-4 top-14 z-50 flex gap-1 rounded-[10px] border border-line bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.18)]">
            <button type="button" aria-label={dt(TASK_DETAIL_COPY.edit.ru, TASK_DETAIL_COPY.edit.en)} onClick={() => { setMenu(false); push({ view: "newTask", params: { id } }); }} className="flex items-center justify-center rounded-full p-2.5 transition-colors hover:bg-accent-soft active:scale-[0.94]" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={20} strokeWidth={1.9} />
            </button>
            <button type="button" aria-label={dt(TASK_DETAIL_COPY.delete.ru, TASK_DETAIL_COPY.delete.en)} onClick={del} className="flex items-center justify-center rounded-full p-2.5 transition-colors active:scale-[0.94]" style={{ color: "var(--pri-high)" }}>
              <RoyIcon name="trash" size={20} strokeWidth={1.9} />
            </button>
          </div>
        </>
      )}
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {err && <div className="py-8 text-center text-sm text-ink-soft">{dt(TASK_DETAIL_COPY.loadError.ru, TASK_DETAIL_COPY.loadError.en)}</div>}
        {t && (
          <>
            <div className="mb-2 flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ fontSize: 12, color: "var(--accent-ink)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 8, padding: "3px 9px" }}>
                <RoyIcon name="task" size={12} strokeWidth={1.9} />
                {dt(TASK_DETAIL_COPY.task.ru, TASK_DETAIL_COPY.task.en)}
              </span>
              <TaskMarkets task={t} />
            </div>
            <h1 className="mb-4 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {t.title}
            </h1>
            <button
              type="button"
              onClick={() => setStatus(isClosed(t) ? "open" : "done")}
              disabled={statusPending || t.id !== id || !loadedGeneration || loadedGeneration !== currentLoad.current}
              aria-busy={statusPending}
              className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold"
              style={isClosed(t)
                ? { color: "var(--ink-soft)", background: "var(--surface-2)", border: "1px solid var(--line-2)" }
                : { color: "var(--accent-ink)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}
            >
              <RoyIcon name={isClosed(t) ? "repeat" : "check"} size={14} strokeWidth={2} />
              {isClosed(t) ? dt(TASK_DETAIL_COPY.reopen.ru, TASK_DETAIL_COPY.reopen.en) : dt(TASK_DETAIL_COPY.done.ru, TASK_DETAIL_COPY.done.en)}
            </button>
            <div className="mt-4">
              <RoyCard className="divide-y divide-line">
                <Row label={t.assignees?.length > 1 ? dt(TASK_DETAIL_COPY.assignees.ru, TASK_DETAIL_COPY.assignees.en) : dt(TASK_DETAIL_COPY.assignee.ru, TASK_DETAIL_COPY.assignee.en)}>
                  {t.assignees?.length > 0 ? (
                    <span className="flex items-center justify-end gap-2">
                      <AvatarStack names={t.assignees} size={24} />
                      <span className="text-right">{t.assignees.map(displayName).join(", ")}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label={dt(TASK_DETAIL_COPY.due.ru, TASK_DETAIL_COPY.due.en)}>{fmtDate(t.due_date)}</Row>
                <Row label={dt(TASK_DETAIL_COPY.priority.ru, TASK_DETAIL_COPY.priority.en)}>
                  {t.priority ? (
                    <span className="flex items-center justify-end gap-2">
                      <PriDot pri={t.priority as "high" | "med" | "low"} />
                      {PRI_LABEL[t.priority] ? dt(PRI_LABEL[t.priority].ru, PRI_LABEL[t.priority].en) : t.priority}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label={dt(TASK_DETAIL_COPY.created.ru, TASK_DETAIL_COPY.created.en)}>{fmtDate(t.created_at)}</Row>
                <Row label={dt(TASK_DETAIL_COPY.source.ru, TASK_DETAIL_COPY.source.en)}>{sourceLabel(t.source ?? null, dt)}</Row>
                {t.created_by_name && <Row label={dt(TASK_DETAIL_COPY.author.ru, TASK_DETAIL_COPY.author.en)}>{t.created_by_name}</Row>}
              </RoyCard>
            </div>
            {t.description && (
              <div className="mt-5">
                <SectionLabel>{dt(TASK_DETAIL_COPY.description.ru, TASK_DETAIL_COPY.description.en)}</SectionLabel>
                <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                  {t.description}
                </p>
              </div>
            )}
            {meeting && (
              <div className="mt-5">
                <SectionLabel>{dt(TASK_DETAIL_COPY.linked.ru, TASK_DETAIL_COPY.linked.en)}</SectionLabel>
                <button
                  type="button"
                  onClick={() => push({ view: "meetingDetail", params: { id: meeting.id } })}
                  className="w-full text-left transition-transform active:scale-[0.99]"
                >
                  <RoyCard className="flex items-center gap-2 px-4 py-3">
                    <TypeTag type={entryTagKey(meeting)} small />
                    <Market code={meeting.countries?.[0]} />
                    <span className="flex-1 truncate font-medium text-ink" style={{ fontSize: 14 }}>
                      {deriveEntryTitle(meeting)}
                    </span>
                    <RoyIcon name="cright" size={16} strokeWidth={1.9} className="shrink-0 text-ink-soft" />
                  </RoyCard>
                </button>
              </div>
            )}
            <div className="mt-5"><TaskFiles taskId={id} taskCreatorId={t.created_by_telegram_id ?? null} /></div>
            <TaskComments taskId={id} />
          </>
        )}
      </div>
    </div>
  );
}
