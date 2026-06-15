"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, Segmented, RoyCard, PriDot, Market, Avatar, SectionLabel, IconBtn } from "../ui";
import { RoyIcon } from "../icons";
import { fetchTask, updateTask, deleteTask } from "@/lib/api";
import { displayName } from "@/lib/utils";
import type { Task } from "@/types";

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
  const { pop, push, toast } = useRoyNav();
  const [t, setT] = useState<Task | null>(null);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTask(id)
      .then((x) => alive && setT(x))
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
          <div className="roy-pop absolute right-4 top-14 z-50 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_10px_30px_rgba(0,0,0,.18)]">
            <button type="button" onClick={() => { setMenu(false); push({ view: "newTask", params: { id } }); }} className="block w-full px-5 py-2.5 text-left font-medium text-ink" style={{ fontSize: 14 }}>
              Изменить
            </button>
            <button type="button" onClick={del} className="block w-full px-5 py-2.5 text-left font-medium" style={{ fontSize: 14, color: "var(--pri-high)" }}>
              Удалить
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
            <h1 className="mb-4 font-bold text-ink" style={{ fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              {t.title}
            </h1>
            <Segmented items={SEGS} value={norm(t.status)} onChange={setStatus} />
            <div className="mt-4">
              <RoyCard className="divide-y divide-line">
                <Row label="Исполнитель">
                  {t.assignees?.[0] ? (
                    <span className="flex items-center justify-end gap-2">
                      <Avatar size={24}>{(displayName(t.assignees[0])[0] || "?").toUpperCase()}</Avatar>
                      {displayName(t.assignees[0])}
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
          </>
        )}
      </div>
    </div>
  );
}
