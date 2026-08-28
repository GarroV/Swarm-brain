"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRoyNav, useDt } from "./nav";
import { RoyIcon } from "./icons";
import { createTask, extractTasksStreamed, fetchMe, fetchUsers } from "@/lib/api";
import { effectiveAssigneeId, taskCountLabel } from "@/lib/proposedTasks";
import type { Me, User } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { TasksHarvestSheet, type DraftTask, type HarvestActions } from "./TasksHarvestSheet";

// Генерация задач из встречи ПО ЯВНОМУ действию пользователя (кнопка), не автоматически.
// Превью (POST /tasks/extract { save:false }) не создаёт ничего в базе — предложения живут
// в памяти вкладки, пока человек их не примет.
//
// Сам разбор вынесен в TasksHarvestSheet: правая панель ревью слишком узкая, чтобы вычитывать
// в ней семь задач (заголовки резались, исполнителя не было видно, каждую приходилось
// открывать отдельно). Здесь остались кнопки, сводка и вся работа с данными — сохранение
// пачкой и привязка к встрече; лист занимается только показом и правкой.
//
// text — источник для извлечения (entry.content или draft_notes_md черновика рекордера).
// meetingId — entry.id для привязки задач (у agent-черновика записи ещё нет → undefined,
// задачи создаются автономно). resetKey — id выбранной записи: при смене сбрасываем список.
export function TasksFromMeeting({
  text, meetingId, resetKey, onAdded,
}: { text: string; meetingId?: string | null; resetKey: string; onAdded?: () => void }) {
  const { toast } = useRoyNav();
  const dt = useDt();
  const anchorRef = useRef<HTMLDivElement>(null);

  const [tasks, setTasks] = useState<DraftTask[] | null>(null);
  // streaming — модель ещё пишет: лист УЖЕ открыт и дописывается, кнопка занята.
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  // Кто разбирает: задача без названного ответственного остаётся на нём (effectiveAssigneeId).
  const [me, setMe] = useState<Me | null>(null);
  // Открытый в редакторе черновик: строка-предложение (доводка) или пустой (кнопка «Своя»).
  const [editing, setEditing] = useState<DraftTask | null>(null);

  // Смена выбранной записи сбрасывает локальный список предложенных задач и закрывает всё,
  // что было открыто по прошлой встрече.
  useEffect(() => {
    setTasks(null);
    setStreaming(false);
    setBusy(false);
    setSheetOpen(false);
    setEditing(null);
  }, [resetKey]);

  // Список команды нужен, чтобы имя исполнителя из тезисов превратить в telegram_id
  // (issue #126). GET дедуплицируется общим кэшем запросов, лишнего похода не будет.
  useEffect(() => {
    let alive = true;
    fetchUsers().then((u) => { if (alive) setUsers(u); }).catch(() => { /* тихо: без списка исполнитель просто останется «не назначен» */ });
    fetchMe().then((m) => { if (alive) setMe(m); }).catch(() => { /* тихо: без личности поведение как раньше — «не назначен» */ });
    return () => { alive = false; };
  }, []);

  const openSheet = useCallback(() => {
    setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null);
    setSheetOpen(true);
  }, []);

  // Лист открывается ДО запроса и дописывается по мере ответа модели: ожидание — это её
  // генерация (3–5 с по прод-логам), и держать перед человеком пустой экран всё это время
  // незачем, если первая задача готова примерно через секунду.
  const extract = async () => {
    if (streaming) return;
    setTasks([]);
    setStreaming(true);
    openSheet();
    let seen = 0;
    try {
      await extractTasksStreamed(text, (proposed) => {
        const key = `${Date.now()}-${seen++}`;
        setTasks((prev) => [...(prev ?? []), { ...proposed, _key: key, _selected: true }]);
      });
    } catch {
      toast(dt("Не удалось вычленить задачи", "Could not extract tasks"));
      // Что успело приехать — оставляем: половина разбора полезнее пустого листа.
      if (seen === 0) setSheetOpen(false);
    } finally {
      setStreaming(false);
    }
  };

  const removeRow = (key: string) => {
    setTasks((prev) => prev?.filter((t) => t._key !== key) ?? null);
  };

  // Задача сохранена через TaskModal → убираем строку-предложение из списка (пустой «Своя»-ключ
  // в списке отсутствует — filter просто ничего не найдёт) и уведомляем родителя.
  const handleSaved = () => {
    if (editing) removeRow(editing._key);
    toast(dt("Задача добавлена", "Task added"));
    onAdded?.();
  };

  // Массовое добавление: одна кнопка на все выбранные. Частичный сбой показываем честно —
  // неудачные строки ОСТАЮТСЯ в разборе, чтобы их можно было повторить, а не исчезали с
  // видом «всё прошло».
  const commit = async () => {
    const chosen = tasks?.filter((t) => t._selected) ?? [];
    if (busy || chosen.length === 0) return;
    setBusy(true);
    // Исполнителя считаем ДО отправки и держим рядом с черновиком: он нужен второй раз —
    // сказать в тосте, сколько задач ушло ничьими (имя в тезисах есть, а такого человека
    // в команде нет). Без этой строки «ничьи» задачи уезжают молча: тост говорит «Добавлено»,
    // а найти их потом негде — ровно так потерялись две задачи 28.08.2026.
    const payloads = chosen.map((t) => ({ draft: t, assigneeId: effectiveAssigneeId(t.assignee, users, me?.telegram_id ?? null) }));
    const results = await Promise.allSettled(payloads.map(({ draft, assigneeId }) => createTask({
      title: draft.title,
      description: draft.description,
      country: draft.country,
      due_date: draft.due_date,
      assignee_telegram_id: assigneeId,
      meeting_id: meetingId ?? null,
    })));
    const addedKeys = new Set(chosen.filter((_, i) => results[i].status === "fulfilled").map((t) => t._key));
    setTasks((prev) => prev?.filter((t) => !addedKeys.has(t._key)) ?? null);
    setBusy(false);

    const orphans = payloads.filter(({ draft, assigneeId }) => assigneeId == null && addedKeys.has(draft._key)).length;
    const orphanTail = orphans > 0
      ? dt(` · ${orphans} без исполнителя`, ` · ${orphans} unassigned`)
      : "";

    if (addedKeys.size > 0) onAdded?.();
    if (addedKeys.size === chosen.length) {
      toast(dt(`Добавлено ${taskCountLabel(addedKeys.size)}`, `Added ${addedKeys.size} task${addedKeys.size === 1 ? "" : "s"}`) + orphanTail);
      setSheetOpen(false);
    } else {
      toast(dt(
        `Добавлено ${addedKeys.size} из ${chosen.length} — остальные остались в разборе`,
        `Added ${addedKeys.size} of ${chosen.length} — the rest are still in the review`,
      ) + orphanTail);
    }
  };

  const actions: HarvestActions = {
    toggle: (key) => setTasks((prev) => prev?.map((t) => (t._key === key ? { ...t, _selected: !t._selected } : t)) ?? null),
    toggleAll: (next) => setTasks((prev) => prev?.map((t) => ({ ...t, _selected: next })) ?? null),
    rename: (key, title) => setTasks((prev) => prev?.map((t) => (t._key === key ? { ...t, title } : t)) ?? null),
    remove: removeRow,
    edit: (task) => setEditing(task),
    addOwn: () => setEditing({ title: "", description: null, assignee: null, due_date: null, country: null, _key: `own-${Date.now()}`, _selected: true }),
    commit,
  };

  const hasContent = Boolean(text?.trim());
  const pending = tasks?.length ?? 0;

  return (
    <div ref={anchorRef}>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          {dt("Задачи из встречи", "Tasks from meeting")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={actions.addOwn}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97]"
            // Тач-цель: кнопки были 32px при норме 44 (аудит мобилки 2026-08-24).
            style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
          >
            <RoyIcon name="plus" size={13} strokeWidth={2.1} />
            {dt("Своя", "Own")}
          </button>
          <button
            type="button"
            disabled={streaming || !hasContent}
            onClick={extract}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,opacity,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
            style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
          >
            <RoyIcon name="spark" size={13} strokeWidth={1.9} />
            {streaming ? dt("Ищу задачи…", "Finding tasks…") : dt("Сгенерировать", "Generate")}
          </button>
        </div>
      </div>

      {!hasContent && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Нет содержания для извлечения.", "Nothing to extract from.")}
        </p>
      )}

      {hasContent && pending === 0 && tasks !== null && !streaming && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Задач не найдено.", "No tasks found.")}
        </p>
      )}

      {/* Сводка вместо списка: сам разбор живёт в листе, а здесь остаётся вход в него —
          чтобы закрытый разбор не терялся и его можно было открыть заново. */}
      {pending > 0 && (
        <button
          type="button"
          onClick={openSheet}
          className="flex w-full items-center justify-between gap-2 rounded-[13px] border border-line bg-surface px-3 text-left font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.01] hover:border-line-2 active:scale-[0.99]"
          style={{ minHeight: 44, fontSize: 12.5 }}
        >
          <span>{dt(`${taskCountLabel(pending)} предложено`, `${pending} task${pending === 1 ? "" : "s"} proposed`)}</span>
          <span className="inline-flex items-center gap-1 text-ink">
            {dt("Разобрать", "Review")}
            <RoyIcon name="cright" size={13} strokeWidth={2.1} />
          </span>
        </button>
      )}

      <TasksHarvestSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        anchorRect={anchorRect}
        tasks={tasks ?? []}
        users={users}
        meId={me?.telegram_id ?? null}
        busy={busy}
        streaming={streaming}
        actions={actions}
      />

      {/* Тот же редактор задачи, что в разделе задач. Открывается из разбора (✎ / «Своя»).
          Приватность/командность и списки — штатными средствами TaskModal. */}
      <TaskModal
        open={!!editing}
        prefill={editing ? {
          title: editing.title,
          description: editing.description,
          country: editing.country,
          due_date: editing.due_date,
        } : undefined}
        meetingId={meetingId ?? null}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
