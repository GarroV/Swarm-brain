"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, Segmented, RoyCard, PriDot, Market, AvatarStack, SectionLabel, IconBtn, TypeTag } from "../ui";
import { RoyIcon } from "../icons";
import { entryTagKey, deriveEntryTitle } from "../entry";
import { fetchTask, updateTask, deleteTask, fetchMeeting } from "@/lib/api";
import { TaskComments } from "@/components/tasks/TaskComments";
import { displayName } from "@/lib/utils";
import type { Task, Entry } from "@/types";

const SEGS = [
  { id: "open", label: "Открыто" },
  { id: "in_progress", label: "В работе" },
  { id: "done", label: "Готово" },
];
const PRI_LABEL: Record<string, string> = { high: "Высокий", med: "Средний", low: "Низкий" };
const norm = (s: string) => (s === "progress" ? "in_progress" : s);

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch {
    return "—";
  }
}

// Человекочитаемый источник задачи (провенанс): откуда задача взялась.
const SOURCE_LABEL: Record<string, string> = {
  transcript: "Из встречи",
  "desktop-agent": "Из встречи",
  mini_app: "Веб",
  claude: "Claude",
  manual: "Вручную",
  file: "Файл",
  note: "Заметка",
};
function sourceLabel(source: string | null): string {
  if (!source) return "—";
  return SOURCE_LABEL[source] ?? source;
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
  const [t, setT] = useState<Task | null>(null);
  const [meeting, setMeeting] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTask(id)
      .then((x) => {
        if (!alive) return;
        setT(x);
        if (x.meeting_id) {
          fetchMeeting(x.meeting_id)
            .then((m) => alive && setMeeting(m))
            .catch(() => {/* нет встречи — не показываем секцию */});
        }
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const setStatus = async (s: string) => {
    if (!t) return;
    setT({ ...t, status: s });
    try {
      await updateTask(id, { status: s });
    } catch {
      /* визуально оставляем выбранный; повторная загрузка экрана исправит */
    }
  };

  const del = async () => {
    setMenu(false);
    try {
      await deleteTask(id);
      toast("Задача удалена");
      pop();
    } catch {
      toast("Не удалось удалить");
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Задача" right={<IconBtn name="dots" aria-label="Действия" onClick={() => setMenu((v) => !v)} />} />
      {menu && (
        <>
          <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="roy-pop absolute right-4 top-14 z-50 flex gap-1 rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.18)]">
            <button type="button" aria-label="Изменить" onClick={() => { setMenu(false); push({ view: "newTask", params: { id } }); }} className="flex items-center justify-center rounded-[10px] p-2.5 transition-colors hover:bg-accent-soft active:scale-[0.94]" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={20} strokeWidth={1.9} />
            </button>
            <button type="button" aria-label="Удалить" onClick={del} className="flex items-center justify-center rounded-[10px] p-2.5 transition-colors active:scale-[0.94]" style={{ color: "var(--pri-high)" }}>
              <RoyIcon name="trash" size={20} strokeWidth={1.9} />
            </button>
          </div>
        </>
      )}
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {err && <div className="py-8 text-center text-sm text-ink-soft">Не удалось загрузить задачу.</div>}
        {t && (
          <>
            <div className="mb-2 flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ fontSize: 12, color: "var(--accent-ink)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 8, padding: "3px 9px" }}>
                <RoyIcon name="task" size={12} strokeWidth={1.9} />
                Задача
              </span>
              <Market code={t.country} />
            </div>
            <h1 className="mb-4 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {t.title}
            </h1>
            <Segmented items={SEGS} value={norm(t.status)} onChange={setStatus} />
            <div className="mt-4">
              <RoyCard className="divide-y divide-line">
                <Row label={t.assignees?.length > 1 ? "Исполнители" : "Исполнитель"}>
                  {t.assignees?.length > 0 ? (
                    <span className="flex items-center justify-end gap-2">
                      <AvatarStack names={t.assignees} size={24} />
                      <span className="text-right">{t.assignees.map(displayName).join(", ")}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Срок">{fmtDate(t.due_date)}</Row>
                <Row label="Приоритет">
                  {t.priority ? (
                    <span className="flex items-center justify-end gap-2">
                      <PriDot pri={t.priority as "high" | "med" | "low"} />
                      {PRI_LABEL[t.priority] ?? t.priority}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Создано">{fmtDate(t.created_at)}</Row>
                <Row label="Источник">{sourceLabel(t.source ?? null)}</Row>
                {t.created_by_name && <Row label="Автор">{t.created_by_name}</Row>}
              </RoyCard>
            </div>
            {t.description && (
              <div className="mt-5">
                <SectionLabel>Описание</SectionLabel>
                <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                  {t.description}
                </p>
              </div>
            )}
            {meeting && (
              <div className="mt-5">
                <SectionLabel>Связано из базы</SectionLabel>
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
            <TaskComments taskId={id} />
          </>
        )}
      </div>
    </div>
  );
}
