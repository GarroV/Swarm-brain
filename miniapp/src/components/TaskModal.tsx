"use client";
import { useState, useEffect, useRef } from "react";
import type { Task, User, Project } from "@/types";
import { displayName } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
import {
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskLabel,
  createTask,
  updateTask,
  deleteTask,
  fetchUsers,
  fetchTaskLabels,
  fetchConfig,
  fetchProjects,
  fetchMe,
  fetchTask,
} from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PropertyRow, PropertyLabel, PropertyValue, propertySelectCls } from "@/components/ui/PropertyRow";
import { useConfirm } from "@/components/ui/confirm";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { TaskComments } from "@/components/tasks/TaskComments";
import { COUNTRY_NAMES, countryCode } from "@/lib/countries";
import { CountryPopover } from "@/components/tasks/CountryPopover";
import { linkify } from "@/lib/linkify";
import { useDt } from "@/components/roy/nav";
import { recurrenceOptions } from "@/lib/recurrenceLabels";

// Функционал ролей пока не используется командой — поле скрыто в UI, но не удалено
// (данные task_role продолжают сохраняться на уже размеченных задачах).
const SHOW_TASK_ROLE = false;

const TASK_ROLES = [
  { value: "marketing", label: "Marketing" },
  { value: "bd", label: "BD" },
  { value: "rnd", label: "R&D" },
];

// Статусы пиктограммами: открыто — пустой круг, в работе — часы, готово — галочка.
// Иконка "circle" рисуется CSS-бордером (в наборе RoyIcon кружка нет).
const STATUSES: { id: string; label: string; icon: RoyIconName | "circle" }[] = [
  { id: "open", label: "Открыто", icon: "circle" },
  { id: "in_progress", label: "В работе", icon: "clock" },
  { id: "done", label: "Готово", icon: "check" },
];
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Sentinel for the assignee/role selects — empty string is not a valid select value
const NONE = "__none__";

// Автосохранение правок (edit-режим): debounce после остановки ввода — кнопки «Сохранить» нет.
const AUTOSAVE_DELAY = 550;

// Roy-стилизованные нативные контролы (без shadcn): стекло + линия + янтарный фокус.
// min-h-10 — тач-цель полей на телефоне (было 38px при норме 44).
const fieldCls =
  "w-full min-h-10 rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute dark:backdrop-blur-sm";
const labelCls = "mb-1 block font-semibold text-ink-soft";

interface TaskModalProps {
  task?: Task;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  // Создание с префиллом (напр. задача из встречи): начальные значения формы. Игнорируются
  // в режиме правки (когда передан task). assignee не префиллим — GPT даёт имя, не telegram_id.
  prefill?: { title?: string; description?: string | null; country?: string | null; due_date?: string | null };
  // Привязка создаваемой задачи к встрече-источнику (entry.id) → попадает в блок «Задачи из встречи».
  meetingId?: string | null;
  // Префилл проекта при создании (напр. из карточки/облака проекта). Игнорируется в режиме правки.
  projectId?: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

// Происхождение задачи: когда заведена и кем (владелец 2026-08-20: «не ясно, когда задача была
// закинута, и кто её создал»). Подвал под комментариями — там же, где обычно ищут историю.
// Дата полная (день-месяц-год): задачи живут дольше встреч, «10 авг.» без года двусмысленно.
// Автора может не быть у старых задач и у пришедших из встреч/бота — тогда молчим, а не пишем
// «неизвестно»: пустая строка честнее выдуманной.
function TaskOrigin({ task }: { task: Task }) {
  const created = (() => {
    if (!task.created_at) return null;
    const d = new Date(task.created_at);
    if (isNaN(d.getTime())) return null;
    // ru-RU с year:numeric добавляет « г.» — в интерфейсе это канцелярит, режем.
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  })();
  if (!created && !task.created_by_name) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2.5 text-ink-mute" style={{ fontSize: 11.5 }}>
      <RoyIcon name="clock" size={12} strokeWidth={1.9} className="shrink-0" />
      {created && <span>Создана {created}</span>}
      {created && task.created_by_name && <span aria-hidden>·</span>}
      {task.created_by_name && <span>автор: <span className="text-ink-soft font-medium">{task.created_by_name}</span></span>}
    </div>
  );
}

export function TaskModal({ task: taskProp, open, onClose, onSaved, prefill, meetingId, projectId }: TaskModalProps) {
  // Догрузка полной задачи живёт ЗДЕСЬ, а не в вызывающем экране. Раньше это было требованием
  // к вызывающей стороне («открыл задачу из списка — догрузи по id»), и из пяти точек входа его
  // соблюдала одна: список, доска, таймлайн и облако проекта отдавали объект из проекции
  // TASK_LIST_COLUMNS, карточка навсегда застревала в «Загружаем…» и МОЛЧА теряла все правки
  // (issue #145, владелец 2026-08-28: «нажимал что она выполнена, но нифига не сработало»).
  // Теперь любой вызывающий корректен по построению.
  const [hydrated, setHydrated] = useState<Task | null>(null);
  const [hydrateFailed, setHydrateFailed] = useState(false);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  const task = hydrated && taskProp && hydrated.id === taskProp.id ? hydrated : taskProp;
  const isEdit = !!task;
  const confirm = useConfirm();
  const dt = useDt();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("open");
  const [description, setDescription] = useState("");
  // Пока в описании есть сохранённый текст — показываем его как read-only с кликабельными
  // ссылками (linkify); textarea появляется по клику. Пустое описание — сразу editable.
  const [descEditing, setDescEditing] = useState(true);
  const [dueDate, setDueDate] = useState("");
  // Цикличность: null — обычная задача. Производная от срока (день недели/число берутся из
  // него), поэтому без срока включить нельзя.
  const [recurFreq, setRecurFreq] = useState<string | null>(null);
  // Чипы частоты раскрыты? Свёрнуты по умолчанию: в сводке видно значение, детали — по клику.
  const [recurOpen, setRecurOpen] = useState(false);
  // Пинг — ручное напоминание, живёт рядом со сроком и независимо от него.
  const [remindDate, setRemindDate] = useState("");
  const [remindedAt, setRemindedAt] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [taskRole, setTaskRole] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  // Исходный исполнитель: чтобы при правке других полей не затирать его (PATCH шлём только при изменении).
  const [initialAssignee, setInitialAssignee] = useState(NONE);
  const [users, setUsers] = useState<User[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selProject, setSelProject] = useState<string | null>(task?.project_id ?? projectId ?? null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Снапшот последних сохранённых значений формы (JSON) — чтобы автосейв слал PATCH только при реальном изменении.
  const savedSnapRef = useRef("");

  // Задача из СПИСОЧНОГО ответа приходит БЕЗ description и task_role — их не тянет проекция
  // TASK_LIST_COLUMNS (issue #116). А buildPatch() ниже собирает PATCH из ВСЕХ полей формы, а не
  // только изменённых, поэтому автосейв на такой задаче отправил бы пустые description/task_role
  // и стёр реальные значения. undefined = «не загружено» (null — это «пусто», законное значение).
  // Пока полная версия не доехала, запись запрещена, а форма выключена — иначе кнопки
  // переключались бы, ничего не сохраняя, и врали бы человеку и скринридеру.
  const isPartial = isEdit && task?.description === undefined;

  // Догружаем ровно один раз на задачу: taskProp меняет идентичность при каждом обновлении
  // списка, поэтому сторожим по id, а не по ссылке. hydrateAttempt — ручной повтор из строки
  // ошибки.
  useEffect(() => {
    if (!open || !taskProp || taskProp.description !== undefined) return;
    if (hydrated?.id === taskProp.id) return;
    let cancelled = false;
    setHydrateFailed(false);
    fetchTask(taskProp.id)
      .then((full) => { if (!cancelled) setHydrated(full); })
      .catch(() => { if (!cancelled) setHydrateFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskProp?.id, taskProp?.description, hydrateAttempt]);

  // Закрыли карточку — забываем догруженное, иначе следующая откроется с чужими данными,
  // пока сторож по id не сработает.
  useEffect(() => {
    if (!open) { setHydrated(null); setHydrateFailed(false); }
  }, [open]);

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    const initialTitle = task?.title ?? prefill?.title ?? "";
    const initialDescription = task?.description ?? prefill?.description ?? "";
    const initialStatus = normStatus(task?.status);
    const initialDue = task?.due_date ?? prefill?.due_date ?? "";
    const initialRemind = task?.remind_date ?? "";
    const initialRecur = task?.recur_freq ?? null;
    const initialCountry = task?.country ?? prefill?.country ?? "";
    const initialRole = task?.task_role ?? NONE;
    const cur = task?.assignee_telegram_ids?.[0]?.toString() ?? NONE;
    const initialLabels = task?.label_ids ?? [];
    const initialProject = task?.project_id ?? projectId ?? null;

    setTitle(initialTitle);
    setStatus(initialStatus);
    setDescription(initialDescription);
    setDescEditing(!initialDescription.trim());
    setDueDate(initialDue);
    setRemindDate(initialRemind);
    setRecurFreq(initialRecur);
    setRecurOpen(false);
    setRemindedAt(task?.reminded_at ?? null);
    setCountry(initialCountry);
    setTaskRole(initialRole);
    setAssigneeId(cur);
    setInitialAssignee(cur);
    setLabelIds(initialLabels);
    setSelProject(initialProject);
    setSaveState("idle");
    setError(null);
    // Снапшот исходных значений — ключи ДОЛЖНЫ совпадать с formSnapshot(), иначе автосейв
    // сработает вхолостую сразу при открытии.
    savedSnapRef.current = JSON.stringify({
      title: initialTitle,
      description: initialDescription,
      status: initialStatus,
      dueDate: initialDue,
      remindDate: initialRemind,
      recurFreq: initialRecur,
      country: initialCountry,
      taskRole: initialRole,
      assigneeId: cur,
      selProject: initialProject,
      labelIds: initialLabels,
    });

    fetchUsers().then(setUsers).catch(() => {});
    fetchTaskLabels().then(setLabels).catch(() => {});
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
    // Новая задача — по умолчанию исполнитель = текущий пользователь (обычно чаще правит своё же).
    if (!task) {
      fetchMe().then((me) => setAssigneeId(me.telegram_id.toString())).catch(() => {});
    }
  }, [open, task, projectId]);

  // Список проектов для селекта — грузим один раз при монтировании модалки.
  useEffect(() => {
    void fetchProjects().then(setProjects);
  }, []);

  // Опции исполнителя = пользователи воркспейса + текущий исполнитель, если его нет в списке
  // (иначе select не показал бы его, а сохранение затёрло бы назначение).
  const assigneeOptions: { id: string; name: string }[] = [
    ...users.map((u) => ({ id: u.telegram_id.toString(), name: displayName(u.name) })),
  ];
  if (assigneeId !== NONE && !assigneeOptions.some((o) => o.id === assigneeId)) {
    const curName = task?.assignees?.[0];
    assigneeOptions.unshift({
      id: assigneeId,
      name: curName && !/^\d+$/.test(curName) ? curName : `#${assigneeId}`,
    });
  }

  // Опции страны: рынки воркспейса + «Global» (пусто) + легаси-фолбэк (страна задачи вне
  // текущего allowed_markets — чтобы при редактировании не потерять её).
  const countryCodes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  let selectedCountryId = country;
  if (country) {
    const normalizedCountry = countryCode(country);
    const matchedCode = countryCodes.find((code) => countryCode(code) === normalizedCountry);
    if (matchedCode) {
      selectedCountryId = matchedCode;
    } else {
      countryCodes.push(country);
    }
  }

  // Варианты цикличности зависят только от срока — считаем один раз на рендер.
  // Якорь показываем, только пока срок не тронут: изменил дату — подпись идёт за новой,
  // потому что сервер пересчитает якорь по тому же правилу (recurrencePatchFor).
  const recurOptions = recurrenceOptions(
    dueDate,
    dueDate === (task?.due_date ?? "") ? task?.recur_anchor_dom : null,
  );

  // Значение строки «Повторять»: сама частота словами. Без срока строка выключена и честно
  // говорит почему — раньше это была приписка мелким шрифтом рядом с чекбоксом.
  const recurValueLabel = !recurOptions
    ? dt("нужен срок", "needs a due date")
    : recurFreq
      ? (() => { const o = recurOptions.find((x) => x.freq === recurFreq); return o ? dt(o.ru, o.en) : "—"; })()
      : "—";

  // Текущий снапшот формы (для сравнения с сохранённым) — те же ключи, что в useEffect open.
  const formSnapshot = () =>
    JSON.stringify({ title, description, status, dueDate, remindDate, recurFreq, country, taskRole, assigneeId, selProject, labelIds });

  // Собрать PATCH из текущих значений формы. null → сохранять нечего/нельзя (пустое название).
  const buildPatch = (): UpdateTaskInput | null => {
    if (!task) return null;
    const t = title.trim();
    if (!t) return null;
    const patch: UpdateTaskInput = {
      title: t,
      description: description.trim() || null,
      due_date: dueDate || null,
      remind_date: remindDate || null,
      recur_freq: recurFreq,
      country: country || null,
      task_role: taskRole === NONE ? null : taskRole,
      status,
      project_id: selProject,
    };
    // Исполнителя шлём только если поменяли — иначе правка других полей затёрла бы назначение,
    // которое нельзя было префиллить (имя без telegram_id).
    if (assigneeId !== initialAssignee) patch.assignee_telegram_id = assigneeId === NONE ? null : parseInt(assigneeId, 10);
    // Списки — личные: выбор списка делает задачу личной (метки живут только на личных задачах).
    if (labelIds.length > 0 && !task.is_private) patch.is_private = true;
    if (task.is_private || labelIds.length > 0) patch.label_ids = labelIds;
    return patch;
  };

  // Автосохранение (edit): при любом изменении формы — debounce → PATCH. Кнопки «Сохранить» нет.
  useEffect(() => {
    if (!open || !isEdit || !task || isPartial) return;
    const snap = formSnapshot();
    if (snap === savedSnapRef.current) return; // ничего не менялось
    if (!title.trim()) return; // пустое название не сохраняем (обязательное поле)
    const patch = buildPatch();
    if (!patch) return;
    const h = setTimeout(async () => {
      setSaveState("saving");
      try {
        await updateTask(task.id, patch);
        savedSnapRef.current = snap;
        setSaveState("saved");
        onSaved();
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, isPartial, title, description, status, dueDate, remindDate, recurFreq, country, taskRole, assigneeId, selProject, labelIds]);

  // Закрытие: досрочно сохраняем pending-изменения (пока debounce не успел сработать).
  const handleClose = () => {
    if (isEdit && task && !isPartial && title.trim()) {
      const snap = formSnapshot();
      if (snap !== savedSnapRef.current) {
        const patch = buildPatch();
        if (patch) {
          savedSnapRef.current = snap;
          updateTask(task.id, patch).then(onSaved).catch(() => {});
        }
      }
    }
    onClose();
  };

  // Создание новой задачи — единственная точка с явной кнопкой (в edit сохранение автоматом).
  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Нужно название");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const base = {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        remind_date: remindDate || null,
        recur_freq: recurFreq,
        country: country || null,
        task_role: taskRole === NONE ? null : taskRole,
      };
      const assigneeValue = assigneeId === NONE ? null : parseInt(assigneeId, 10);
      const fields: CreateTaskInput = { ...base, assignee_telegram_id: assigneeValue, project_id: selProject };
      if (meetingId) fields.meeting_id = meetingId;
      if (labelIds.length > 0) fields.is_private = true;
      const created = await createTask(fields);
      // POST /tasks не принимает label_ids — вешаем метки вторым шагом на уже личную задачу.
      if (labelIds.length > 0) await updateTask(created.id, { label_ids: labelIds });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!(await confirm({ title: `Удалить «${task.title}»?`, description: "Задача будет удалена без возможности восстановления." }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const titleMissing = isEdit && !title.trim();
  const saveHint = hydrateFailed
    ? "Не загрузилось"
    : isPartial
    ? "Загружаем…"
    : titleMissing
    ? "Нужно название"
    : saveState === "saving"
      ? "Сохранение…"
      : saveState === "error"
        ? "Не сохранилось"
        : saveState === "saved"
          ? "Сохранено"
          : "";
  const saveHintDanger = titleMissing || saveState === "error" || hydrateFailed;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 rounded-[20px] border border-line bg-[var(--popover)] p-0 sm:max-w-5xl dark:backdrop-blur-xl"
      >
        {/* Шапка: заголовок + индикатор автосейва (edit) + удалить (edit) + закрыть */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="shrink-0 font-bold text-ink" style={{ fontSize: 17, letterSpacing: "-0.01em" }}>
              {isEdit ? "Изменить задачу" : "Новая задача"}
            </h2>
            {isEdit && saveHint && (
              <span
                className="truncate"
                style={{ fontSize: 12, color: saveHintDanger ? "var(--pri-high)" : "var(--ink-mute)" }}
              >
                {saveHint}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Удалить задачу"
                title="Удалить задачу"
                // Тач-цель 40x40: на телефоне кнопка была 29x29 при норме 44 — и это удаление.
                className="flex size-10 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-[var(--pri-high)] active:scale-[0.95] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RoyIcon name="trash" size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Закрыть"
              className="flex size-10 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <RoyIcon name="x" size={18} />
            </button>
          </div>
        </div>

        {/* Поля — две колонки: слева название + большое поле редактуры, справа настройки */}
        <div className="max-h-[80vh] overflow-y-auto px-5 py-3">
          {/* Отказ догрузки — ГРОМКИЙ. Раньше это был один тост и навсегда мёртвая форма:
              человек правил задачу, ничего не сохранялось, и никто ему об этом не говорил. */}
          {hydrateFailed && (
            <div
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border px-3 py-2"
              style={{
                borderColor: "color-mix(in srgb, var(--pri-high) 40%, transparent)",
                background: "color-mix(in srgb, var(--pri-high) 8%, transparent)",
              }}
            >
              <RoyIcon name="warn" size={15} className="shrink-0 text-[var(--pri-high)]" />
              <span className="min-w-0 flex-1 text-ink" style={{ fontSize: 12.5 }}>
                {dt(
                  "Не удалось загрузить задачу целиком. Правки заблокированы, чтобы не стереть описание.",
                  "Could not load the full task. Editing is blocked so the description isn't wiped.",
                )}
              </span>
              <button
                type="button"
                onClick={() => setHydrateAttempt((n) => n + 1)}
                className="shrink-0 rounded-[10px] border border-line bg-surface px-3 font-semibold text-ink transition-colors hover:bg-surface-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                style={{ fontSize: 12, minHeight: 32 }}
              >
                {dt("Повторить", "Retry")}
              </button>
            </div>
          )}
          {/* Пока задача неполная, форма ВЫКЛЮЧЕНА: fieldset[disabled] гасит и поля, и кнопки.
              Иначе статус «нажимается», значение в форме меняется, PATCH не уходит — и интерфейс
              врёт человеку и скринридеру (aria-pressed переключался на несохранённом). */}
          <fieldset
            disabled={isPartial}
            aria-busy={isPartial && !hydrateFailed}
            className={`m-0 min-w-0 border-0 p-0 ${isPartial ? "opacity-60" : ""}`}
          >
          <div className="grid items-start gap-x-5 gap-y-3 sm:grid-cols-[1.4fr_1fr]">
            {/* Левая колонка: название + редактура */}
            <div className="flex flex-col gap-2.5">
              <div>
                <label htmlFor="modal-title" className={labelCls} style={{ fontSize: 12 }}>Название *</label>
                <input
                  id="modal-title"
                  className={fieldCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название задачи"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="modal-desc" className={labelCls} style={{ fontSize: 12 }}>Описание</label>
                {descEditing ? (
                  <textarea
                    id="modal-desc"
                    autoFocus={isEdit}
                    className={`${fieldCls} resize-y`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => { if (description.trim()) setDescEditing(false); }}
                    placeholder="Подробности, контекст, что именно сделать…"
                    style={{ height: 160, minHeight: 100, lineHeight: 1.55 }}
                  />
                ) : (
                  <div
                    id="modal-desc"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDescEditing(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDescEditing(true);
                      }
                    }}
                    className={`${fieldCls} max-h-[320px] cursor-text overflow-y-auto whitespace-pre-wrap`}
                    style={{ minHeight: 100, lineHeight: 1.55 }}
                  >
                    {linkify(description)}
                  </div>
                )}
              </div>
            </div>

            {/* Правая колонка: сводка свойств. Тихие строки «иконка · подпись · значение»
                вместо десяти боксов с подписями сверху — владелец 2026-08-28: «очень все крупно,
                хочется минимализма в интерфейсе задач». Механика строки — ui/PropertyRow.tsx. */}
            <div className="flex flex-col gap-0.5">
              {/* Статус — единственный акцент колонки: меняется чаще всего и должен ловиться
                  взглядом сразу. Внешний бокс-контейнер убран, выбранный держится янтарной
                  пилюлей. 40px оставляем на всех ширинах: это главная кнопка карточки. */}
              {isEdit && (
                <div className="mb-1.5 flex gap-1">
                  {STATUSES.map((s) => {
                    const on = s.id === status;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStatus(s.id)}
                        aria-label={s.label}
                        aria-pressed={on}
                        title={s.label}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"}`}
                        style={{ fontSize: 12.5, minHeight: 40 }}
                      >
                        {s.icon === "circle" ? (
                          <span className="rounded-full border-2 border-current" style={{ width: 13, height: 13 }} />
                        ) : (
                          <RoyIcon name={s.icon} size={15} strokeWidth={2} />
                        )}
                        {on && <span>{s.label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              <DatePicker
                variant="row"
                value={dueDate}
                // Сняли срок — цикличность гаснет вместе с ним: без срока считать следующее
                // вхождение не от чего, а тихо оставленная частота молча перестала бы работать.
                onChange={(iso) => { setDueDate(iso); if (!iso) setRecurFreq(null); }}
                ariaLabel={dt("Срок", "Due date")}
                placeholder="—"
              />

              <DatePicker
                variant="row"
                value={remindDate}
                onChange={(iso) => { setRemindDate(iso); setRemindedAt(null); }}
                icon="bell"
                ariaLabel={dt("Пинг", "Ping")}
                placeholder="—"
                clearLabel={dt("Убрать пинг", "Clear ping")}
              />
              {/* Подсказка молчит, пока пинга нет: постоянная строка под полем занимала вертикаль
                  ни за чем. «Уже напомнили» показываем всегда — она объясняет, почему дата стоит,
                  а звонка больше не будет. */}
              {remindDate && (
                <p className="px-2 pb-1 text-right text-ink-mute" style={{ fontSize: 11 }}>
                  {remindedAt
                    ? dt("Уже напомнили — выбери новый день, чтобы напомнить снова", "Already sent — pick a new day to be reminded again")
                    : dt("Напомним в этот день, один раз", "One reminder on this day")}
                </p>
              )}

              {/* Цикличность. Подписи вариантов считаются от срока («По средам», «26-го числа»)
                  — день недели и число отдельно не хранятся, это и есть срок задачи.
                  Нативного чекбокса тут больше нет: в тёмной теме браузер рисовал его системным
                  белым квадратом, чужим всему остальному. Теперь это обычная строка свойства,
                  а выбор частоты (включая «не повторять») живёт в чипах под ней. */}
              <PropertyRow
                icon="repeat"
                label={dt("Повторять", "Repeat")}
                value={recurValueLabel}
                muted={!recurFreq}
                disabled={!recurOptions}
                expanded={recurOpen}
                onClick={() => setRecurOpen((o) => !o)}
              />
              {recurOpen && recurOptions && (
                <div className="px-2 pb-1">
                  <div className="flex flex-wrap gap-1.5">
                    {[{ freq: null as string | null, ru: "Не повторять", en: "Never" }, ...recurOptions].map((o) => {
                      const on = o.freq === recurFreq;
                      return (
                        <button
                          key={o.freq ?? "none"}
                          type="button"
                          onClick={() => setRecurFreq(o.freq)}
                          // Тот же чип, что в «Списках» — сплошной primary кричал громче статуса,
                          // хотя «не повторять» это отсутствие настройки, а не главное в карточке.
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}
                          style={{ fontSize: 11.5 }}
                        >
                          {dt(o.ru, o.en)}
                        </button>
                      );
                    })}
                  </div>
                  {recurFreq && (
                    <p className="mt-1.5 text-ink-mute" style={{ fontSize: 11 }}>
                      {dt(
                        "Отметишь готовой — задача не закроется, а перенесётся на следующий раз",
                        "Marking it done rolls the task to its next occurrence instead of closing it",
                      )}
                    </p>
                  )}
                </div>
              )}

              <Select value={selProject ?? NONE} onValueChange={(v) => setSelProject(v === NONE ? null : v)}>
                <SelectTrigger id="modal-project" aria-label={dt("Проект", "Project")} className={propertySelectCls}>
                  <PropertyLabel icon="board">{dt("Проект", "Project")}</PropertyLabel>
                  {/* Подпись считаем САМИ (base-ui Value в этой версии рисует сырое значение/UUID). */}
                  <PropertyValue muted={!selProject || selProject === NONE}>
                    {!selProject || selProject === NONE ? "—" : (projects.find((p) => p.id === selProject)?.name ?? "—")}
                  </PropertyValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Выбор страны — контекстное меню: строка-триггер + портал-поповер с сеткой флагов. */}
              <CountryPopover
                value={selectedCountryId}
                codes={countryCodes}
                onChange={setCountry}
                variant="row"
                label={dt("Страна", "Country")}
              />

              {/* «Общие» = без конкретного исполнителя → командная задача (вкладка «Команда»). */}
              <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
                <SelectTrigger id="modal-assignee" aria-label={dt("Исполнитель", "Assignee")} className={propertySelectCls}>
                  <PropertyLabel icon="team">{dt("Исполнитель", "Assignee")}</PropertyLabel>
                  <PropertyValue muted={assigneeId === NONE}>
                    {assigneeId === NONE ? dt("Общие", "Unassigned") : (assigneeOptions.find((o) => o.id === assigneeId)?.name ?? `#${assigneeId}`)}
                  </PropertyValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{dt("Общие (вся команда)", "Unassigned (whole team)")}</SelectItem>
                  {assigneeOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {SHOW_TASK_ROLE && (
                <div className="px-2 pt-1">
                  <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12 }}>Роль</label>
                  <select id="modal-role" className={fieldCls} value={taskRole} onChange={(e) => setTaskRole(e.target.value)}>
                    <option value={NONE}>— Нет —</option>
                    {TASK_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Персональные списки-метки. Единственное многозначное свойство — строкой его не
                  выразить, поэтому остаётся чипами, но уезжает под линию, ниже сводки. */}
              {labels.length > 0 && (
                <div className="mt-1.5 border-t border-line pt-2.5">
                  <span className="mb-1.5 block px-2 text-ink-mute" style={{ fontSize: 11 }}>{dt("Списки", "Lists")}</span>
                  <div className="flex flex-wrap gap-1.5 px-2">
                    {labels.map((l) => {
                      const on = labelIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLabelIds((prev) => (prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}
                          style={{ fontSize: 12 }}
                        >
                          <RoyIcon name={((l.icon as RoyIconName) || "tag")} size={13} strokeWidth={1.9} />
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                  {labelIds.length > 0 && !task?.is_private && (
                    <p className="mt-1.5 px-2 text-ink-mute" style={{ fontSize: 11.5 }}>
                      Список личный — задача станет видна только тебе.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          </fieldset>

          {isEdit && task && (
            <div className="mt-1 border-t border-line pt-3">
              <TaskComments taskId={task.id} />
              <TaskOrigin task={task} />
            </div>
          )}

          {error && <p className="mt-3 font-semibold" style={{ fontSize: 13, color: "var(--pri-high)" }}>{error}</p>}
        </div>

        {/* Нижняя панель действий — только при создании (в edit сохранение автоматическое). */}
        {!isEdit && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="rounded-[12px] border border-line bg-surface px-4 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-[12px] bg-primary px-4 py-2 font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              {creating ? "Создание…" : "Создать"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
