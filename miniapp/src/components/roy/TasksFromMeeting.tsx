"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "./nav";
import { RoyCard } from "./ui";
import { RoyIcon } from "./icons";
import { extractTasksPreview } from "@/lib/api";
import type { ProposedTask } from "@/lib/api";
import { TaskModal } from "@/components/TaskModal";
import { countryCode } from "@/lib/countries";

// Генерация задач из встречи ПО ЯВНОМУ действию пользователя (кнопка), не автоматически.
// Превью (POST /tasks/extract { save:false }) → клик по строке (или «Своя») открывает тот же
// редактор задач, что в разделе задач (TaskModal): исполнитель/срок/страна с флагами/списки/описание.
// Созданная задача привязывается к встрече (meeting_id = entry.id) → видна в блоке «Задачи из встречи».
// Используется и в ревью встреч, и на экране самой встречи.

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

type DraftTask = ProposedTask & { _key: string };

// text — источник для извлечения (entry.content или draft_notes_md черновика рекордера).
// meetingId — entry.id для привязки задач (у agent-черновика записи ещё нет → undefined,
// задачи создаются автономно). resetKey — id выбранной записи: при смене сбрасываем список.
export function TasksFromMeeting({
  text, meetingId, resetKey, onAdded,
}: { text: string; meetingId?: string | null; resetKey: string; onAdded?: () => void }) {
  const { toast } = useRoyNav();
  const [tasks, setTasks] = useState<DraftTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Открытый в редакторе черновик: строка-предложение (доводка) или пустой (кнопка «Своя»).
  const [editing, setEditing] = useState<DraftTask | null>(null);

  // Смена выбранной записи сбрасывает локальный список предложенных задач и закрывает редактор.
  useEffect(() => {
    setTasks(null);
    setLoading(false);
    setEditing(null);
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

  const removeRow = (key: string) => {
    setTasks((prev) => prev?.filter((t) => t._key !== key) ?? null);
  };

  // Задача сохранена через TaskModal → убираем строку-предложение из списка (пустой «Своя»-ключ
  // в списке отсутствует — filter просто ничего не найдёт) и уведомляем родителя.
  const handleSaved = () => {
    if (editing) removeRow(editing._key);
    toast("Задача добавлена");
    onAdded?.();
  };

  const hasContent = Boolean(text?.trim());

  return (
    <div>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          Задачи из встречи
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing({ title: "", _key: `own-${Date.now()}` })}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97]"
            // Тач-цель: кнопки были 32px при норме 44 (аудит мобилки 2026-08-24).
            style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
          >
            <RoyIcon name="plus" size={13} strokeWidth={2.1} />
            Своя
          </button>
          <button
            type="button"
            disabled={loading || !hasContent}
            onClick={extract}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,opacity,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
            // Тач-цель: кнопки были 32px при норме 44 (аудит мобилки 2026-08-24).
            style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
          >
            <RoyIcon name="spark" size={13} strokeWidth={1.9} />
            {loading ? "Генерируем…" : "Сгенерировать"}
          </button>
        </div>
      </div>

      {!hasContent && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Нет содержания для извлечения.</p>
      )}

      {hasContent && tasks !== null && tasks.length === 0 && !loading && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Задач не найдено.</p>
      )}

      {tasks && tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <RoyCard key={t._key} className="px-1.5 py-1 transition-colors hover:border-line-2">
              <div className="flex items-center gap-1">
                {/* Клик по строке открывает полноценный редактор задачи (TaskModal) с префиллом. */}
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="min-w-0 flex-1 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="truncate font-medium text-ink" style={{ fontSize: 13 }}>
                    {t.title || "Без названия — открыть и заполнить"}
                  </div>
                  {(t.country || t.due_date) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                </button>
                <button
                  type="button"
                  aria-label="Убрать предложенную задачу"
                  onClick={() => removeRow(t._key)}
                  className="inline-flex shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface text-ink-mute transition-opacity hover:opacity-70"
                  style={{ width: 30, height: 30 }}
                >
                  <RoyIcon name="x" size={14} strokeWidth={1.9} />
                </button>
              </div>
            </RoyCard>
          ))}
        </div>
      )}

      {/* Тот же редактор задачи, что в разделе задач. Открывается кликом по предложению / «Своя».
          Приватность/командность и списки — штатными средствами TaskModal. */}
      <TaskModal
        open={!!editing}
        prefill={editing ? {
          title: editing.title,
          description: editing.description ?? null,
          country: editing.country ?? null,
          due_date: editing.due_date ?? null,
        } : undefined}
        meetingId={meetingId ?? null}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
