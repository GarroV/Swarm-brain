"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "./nav";
import { RoyCard } from "./ui";
import { RoyIcon } from "./icons";
import { extractTasksPreview, createTask } from "@/lib/api";
import type { ProposedTask } from "@/lib/api";
import { countryCode } from "@/lib/countries";

// Генерация задач из встречи ПО ЯВНОМУ действию пользователя (кнопка), не автоматически.
// Превью (POST /tasks/extract { save:false }) → правка/удаление → добавить себе / в общие.
// Добавленные задачи привязываются к встрече (meeting_id = entry.id), поэтому затем видны
// в блоке «Задачи из встречи». Используется и в ревью встреч, и на экране самой встречи.

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

type DraftTask = ProposedTask & { _key: string };
type TaskTarget = "personal" | "shared";

// text — источник для извлечения (entry.content или draft_notes_md черновика рекордера).
// meetingId — entry.id для привязки задач (у agent-черновика записи ещё нет → undefined,
// задачи создаются автономно). resetKey — id выбранной записи: при смене сбрасываем список.
export function TasksFromMeeting({
  text, meetingId, resetKey, onAdded,
}: { text: string; meetingId?: string | null; resetKey: string; onAdded?: () => void }) {
  const { toast } = useRoyNav();
  const [tasks, setTasks] = useState<DraftTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // Смена выбранной записи сбрасывает локальный список предложенных задач.
  useEffect(() => {
    setTasks(null);
    setLoading(false);
    setAddingKey(null);
  }, [resetKey]);

  const extract = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const proposed = await extractTasksPreview(text);
      setTasks(proposed.map((p, i) => ({ ...p, _key: `${Date.now()}-${i}` })));
    } catch {
      toast("Не удалось вычленить задачи");
    } finally {
      setLoading(false);
    }
  };

  const setTitle = (key: string, title: string) => {
    setTasks((prev) => prev?.map((t) => (t._key === key ? { ...t, title } : t)) ?? null);
  };

  const removeRow = (key: string) => {
    setTasks((prev) => prev?.filter((t) => t._key !== key) ?? null);
  };

  const addTask = async (task: DraftTask, target: TaskTarget) => {
    if (addingKey) return;
    const title = task.title.trim();
    if (!title) return;
    setAddingKey(task._key);
    try {
      await createTask({
        title,
        description: task.description ?? null,
        country: task.country ?? null,
        due_date: task.due_date ?? null,
        meeting_id: meetingId ?? null,
        is_private: target === "personal",
      });
      removeRow(task._key);
      toast("Задача добавлена");
      onAdded?.();
    } catch {
      toast("Не удалось добавить задачу");
    } finally {
      setAddingKey(null);
    }
  };

  const hasContent = Boolean(text?.trim());

  return (
    <div>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          Задачи из встречи
        </span>
        <button
          type="button"
          disabled={loading || !hasContent}
          onClick={extract}
          className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,opacity,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
          style={{ padding: "6px 12px", fontSize: 12 }}
        >
          <RoyIcon name="spark" size={13} strokeWidth={1.9} />
          {loading ? "Генерируем…" : "Сгенерировать задачи"}
        </button>
      </div>

      {!hasContent && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Нет содержания для извлечения.</p>
      )}

      {hasContent && tasks !== null && tasks.length === 0 && !loading && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Задач не найдено.</p>
      )}

      {tasks && tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const busy = addingKey === t._key;
            return (
              <RoyCard key={t._key} className="px-3 py-2.5 transition-colors hover:border-line-2">
                <div className="flex items-start gap-2">
                  <input
                    value={t.title}
                    onChange={(e) => setTitle(t._key, e.target.value)}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface text-ink font-medium outline-none focus:border-[var(--accent-ink)] disabled:opacity-50"
                    style={{ fontSize: 13, padding: "6px 9px" }}
                  />
                  <button
                    type="button"
                    aria-label="Удалить предложенную задачу"
                    disabled={busy}
                    onClick={() => removeRow(t._key)}
                    className="inline-flex shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface text-ink-mute transition-opacity disabled:opacity-50"
                    style={{ width: 30, height: 30 }}
                  >
                    <RoyIcon name="x" size={14} strokeWidth={1.9} />
                  </button>
                </div>
                {(t.country || t.due_date) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-0.5">
                    {t.country && (
                      <span
                        className="inline-flex items-center font-semibold text-ink-soft bg-surface-2 border border-line-2"
                        style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px" }}
                      >
                        {countryCode(t.country)}
                      </span>
                    )}
                    {t.due_date && (
                      <span className="text-ink-mute" style={{ fontSize: 11 }}>
                        до {fmtDate(t.due_date) ?? t.due_date}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addTask(t, "personal")}
                    className="flex-1 rounded-[10px] border border-line bg-surface font-semibold text-ink transition-[transform,opacity,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
                    style={{ padding: "6px 10px", fontSize: 12.5 }}
                  >
                    Себе
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addTask(t, "shared")}
                    className="flex-1 rounded-[10px] border-0 font-semibold transition-[transform,opacity,filter] duration-150 hover:scale-[1.03] hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
                    style={{ padding: "7px 10px", fontSize: 12.5, background: "var(--accent-ink)", color: "var(--card)" }}
                  >
                    В общие
                  </button>
                </div>
              </RoyCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
