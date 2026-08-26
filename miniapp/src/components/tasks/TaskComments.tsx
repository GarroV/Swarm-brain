"use client";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useRoyNav, useDt } from "@/components/roy/nav";
import { RoyCard, SectionLabel } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";
import { fetchTaskComments, addTaskComment, deleteTaskComment, fetchTaskSubscription, setTaskSubscription, type TaskComment, type TaskSubscription } from "@/lib/api";
import { displayName } from "@/lib/utils";
import { linkify } from "@/lib/linkify";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch {
    return "—";
  }
}

// Лента комментариев/истории задачи + добавление. Самодостаточна (грузит по taskId).
// Используется в TaskModal (правка задачи) и на экране TaskDetail — один источник UI (DRY).
// Рендерится только внутри RoyApp → useRoyNav безопасен (как в TaskDetail).
export function TaskComments({ taskId }: { taskId: string }) {
  const { toast, me } = useRoyNav();
  // dt только для новых строк (подписка) — остальной текст файла пока русский,
  // его переводит отдельная задача i18n, здесь её не тащим.
  const dt = useDt();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [sub, setSub] = useState<TaskSubscription | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTaskComments(taskId)
      .then((c) => {
        if (!alive) return;
        // Не затираем коммент, добавленный до загрузки списка (union по id, серверный порядок первым).
        setComments((prev) => {
          const ids = new Set(c.map((x) => x.id));
          return [...c, ...prev.filter((p) => !ids.has(p.id))];
        });
      })
      .catch(() => {
        if (alive) toast("Не удалось загрузить комментарии");
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  // Состояние подписки — отдельным запросом: тумблер появляется, когда ответ пришёл,
  // и не задерживает ленту комментариев (ошибку не показываем — тумблер просто не покажем).
  useEffect(() => {
    let alive = true;
    fetchTaskSubscription(taskId).then((s) => { if (alive) setSub(s); }).catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  // Тумблер «уведомлять / не уведомлять». Оптимистично, с откатом: человек жмёт его, чтобы
  // прекратить поток уведомлений, и должен сразу видеть результат.
  const toggleSub = async () => {
    if (!sub || subBusy) return;
    const next = !sub.notified;
    setSubBusy(true);
    setSub({ ...sub, notified: next, state: next ? "subscribed" : "muted", reason: "manual" });
    try {
      setSub(await setTaskSubscription(taskId, next));
    } catch {
      setSub(sub);
      toast(dt("Не удалось сохранить", "Could not save"));
    } finally {
      setSubBusy(false);
    }
  };

  const submitComment = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Оптимистично добавляем с временным id, затем заменяем ответом сервера.
    const tempId = `temp-${Date.now()}`;
    const optimistic: TaskComment = {
      id: tempId,
      content: text,
      author_name: me?.name ?? "",
      author_telegram_id: me?.telegram_id ?? null,
      created_at: new Date().toISOString(),
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const created = await addTaskComment(taskId, text);
      setComments((prev) => prev.map((c) => (c.id === tempId ? created : c)));
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setDraft(text);
      toast("Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  // Enter отправляет, Shift+Enter — перенос строки.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitComment();
    }
  };

  const removeComment = async (commentId: string) => {
    const removed = comments.find((c) => c.id === commentId);
    if (!removed) return;
    setComments((cs) => cs.filter((c) => c.id !== commentId));
    try {
      await deleteTaskComment(taskId, commentId);
    } catch {
      // Точечный откат по времени (не воскрешаем уже удалённые в гонке параллельных удалений).
      setComments((cs) => [...cs, removed].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      toast("Не удалось удалить");
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Комментарии</SectionLabel>
        {sub && (
          <button
            type="button"
            onClick={() => void toggleSub()}
            disabled={subBusy}
            aria-pressed={sub.notified}
            title={sub.notified
              ? dt("Уведомления о новых комментариях включены. Нажмите, чтобы отписаться.",
                   "Notifications for new comments are on. Click to unsubscribe.")
              : dt("Уведомления отключены. Нажмите, чтобы подписаться.",
                   "Notifications are off. Click to subscribe.")}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            style={{ fontSize: 12, color: sub.notified ? "var(--accent-ink)" : "var(--ink-mute)" }}
          >
            <RoyIcon name="bell" size={13} strokeWidth={2} />
            {sub.notified ? dt("Уведомлять", "Notify me") : dt("Не уведомлять", "Muted")}
          </button>
        )}
      </div>

      {/* Ввод — сверху: Enter отправляет, новый апдейт появляется первым в ленте (новые сверху). */}
      <div className="mt-1.5 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Комментарий"
          placeholder="Написать апдейт…  (Enter — отправить)"
          rows={1}
          className="max-h-28 min-h-[38px] w-full resize-none rounded-[11px] border border-line bg-surface px-3 py-2 text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute"
          style={{ fontSize: 13.5, lineHeight: 1.45 }}
        />
        <button
          type="button"
          onClick={() => void submitComment()}
          disabled={!draft.trim() || sending}
          aria-label="Отправить"
          title="Отправить (Enter)"
          className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-primary text-white transition-transform active:scale-[0.94] disabled:opacity-40"
        >
          <RoyIcon name="arrow" size={16} strokeWidth={2.2} />
        </button>
      </div>

      {comments.length === 0 ? (
        <p className="mt-2 text-ink-soft" style={{ fontSize: 12.5 }}>Пока нет комментариев.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {[...comments].reverse().map((c) => {
            const mine = c.author_telegram_id != null && c.author_telegram_id === me?.telegram_id;
            // temp-* — оптимистичный коммент, ещё не подтверждён сервером; удаление 404-ит.
            const canDelete = (mine || !!me?.is_admin) && !c.id.startsWith("temp-");
            return (
              <RoyCard key={c.id} className="px-3 py-2">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink" style={{ fontSize: 12.5 }}>{displayName(c.author_name)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-ink-mute" style={{ fontSize: 11.5 }}>{fmtDate(c.created_at)}</span>
                    {canDelete && (
                      <button type="button" aria-label="Удалить комментарий" onClick={() => removeComment(c.id)} // Тач-цель 36x36 у крестика 13px: иконка мелкая, зона нажатия — нет.
                        className="-m-2 inline-flex size-9 items-center justify-center p-2 text-ink-soft transition-colors hover:text-[var(--pri-high)]"
                      >
                        <RoyIcon name="x" size={13} strokeWidth={2} />
                      </button>
                    )}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 13.5, lineHeight: 1.45 }}>{linkify(c.content)}</p>
              </RoyCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
