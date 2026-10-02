"use client";
// Архив задач (#489): «удалить» с 21.09.2026 значит «архивировать» (#427), и убранное по ошибке
// возвращали руками в базе — посмотреть архив было негде. Кнопка в навигации списков открывает
// диалог: убранные задачи, свежие сверху, «Вернуть» у каждой.
import { useEffect, useState } from "react";
import type { Task } from "@/types";
import { fetchArchivedTasks, restoreTask } from "@/lib/api";
import { formatDate } from "@/lib/displayFormat";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TaskArchiveButton({ onRestored }: { onRestored?: () => void }) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface"
        style={{ fontSize: 13.5 }}
      >
        <RoyIcon name="trash" size={16} strokeWidth={1.8} />
        <span className="flex-1 text-left">{dt("Архив", "Archive")}</span>
      </button>
      {open && <TaskArchiveDialog onClose={() => setOpen(false)} onRestored={onRestored} />}
    </>
  );
}

function TaskArchiveDialog({ onClose, onRestored }: { onClose: () => void; onRestored?: () => void }) {
  const dt = useDt();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchArchivedTasks()
      .then((t) => { if (alive) setTasks(t); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const back = async (t: Task) => {
    setBusy(t.id);
    try {
      await restoreTask(t.id);
      setTasks((list) => (list ?? []).filter((x) => x.id !== t.id));
      onRestored?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось вернуть задачу", "Failed to restore the task"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{dt("Архив задач", "Task archive")}</DialogTitle>
        </DialogHeader>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {tasks === null && !err && <p className="text-xs text-ink-soft">{dt("Загрузка…", "Loading…")}</p>}
        {tasks?.length === 0 && <p className="text-xs text-ink-soft">{dt("Архив пуст.", "The archive is empty.")}</p>}
        <ul className="divide-y divide-line">
          {tasks?.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{t.title}</div>
                {t.archived_at && (
                  <div className="text-[11px] text-ink-mute">
                    {dt("убрана", "archived")} {formatDate(t.archived_at, { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => back(t)}
                disabled={busy !== null}
                className="h-[28px] shrink-0 rounded-full border border-line-2 bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {busy === t.id ? dt("Возвращаю…", "Restoring…") : dt("Вернуть", "Restore")}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
