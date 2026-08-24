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
} from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { TaskComments } from "@/components/tasks/TaskComments";
import { COUNTRY_NAMES, countryCode } from "@/lib/countries";
import { CountryPopover } from "@/components/tasks/CountryPopover";
import { linkify } from "@/lib/linkify";
import { useDt } from "@/components/roy/nav";

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
// Триггер кастомного Select (в теме проекта) — под общий вид полей (fieldCls): полная ширина,
// та же линия/фон/скругление. Нативный <select> заменён, чтобы выпадашка была не системной.
// min-h-10 — тач-цель: селекты проекта/исполнителя были 32-38px при норме 44.
const selectTriggerCls = "w-full h-auto min-h-10 rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-ink";

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

export function TaskModal({ task, open, onClose, onSaved, prefill, meetingId, projectId }: TaskModalProps) {
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

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    const initialTitle = task?.title ?? prefill?.title ?? "";
    const initialDescription = task?.description ?? prefill?.description ?? "";
    const initialStatus = normStatus(task?.status);
    const initialDue = task?.due_date ?? prefill?.due_date ?? "";
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

  // Текущий снапшот формы (для сравнения с сохранённым) — те же ключи, что в useEffect open.
  const formSnapshot = () =>
    JSON.stringify({ title, description, status, dueDate, country, taskRole, assigneeId, selProject, labelIds });

  // Собрать PATCH из текущих значений формы. null → сохранять нечего/нельзя (пустое название).
  const buildPatch = (): UpdateTaskInput | null => {
    if (!task) return null;
    const t = title.trim();
    if (!t) return null;
    const patch: UpdateTaskInput = {
      title: t,
      description: description.trim() || null,
      due_date: dueDate || null,
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
    if (!open || !isEdit || !task) return;
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
  }, [open, isEdit, title, description, status, dueDate, country, taskRole, assigneeId, selProject, labelIds]);

  // Закрытие: досрочно сохраняем pending-изменения (пока debounce не успел сработать).
  const handleClose = () => {
    if (isEdit && task && title.trim()) {
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
  const saveHint = titleMissing
    ? "Нужно название"
    : saveState === "saving"
      ? "Сохранение…"
      : saveState === "error"
        ? "Не сохранилось"
        : saveState === "saved"
          ? "Сохранено"
          : "";
  const saveHintDanger = titleMissing || saveState === "error";

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

            {/* Правая колонка: настройки */}
            <div className="flex flex-col gap-2.5">
              {isEdit && (
                <div>
                  <span className={labelCls} style={{ fontSize: 12 }}>Статус</span>
                  <div className="flex gap-[3px] rounded-[12px] border border-line bg-surface-2 p-[3px]">
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
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-1.5 font-semibold transition-colors active:scale-[0.97] ${on ? "bg-surface text-ink shadow-[0_1px_4px_rgba(80,60,20,.1)]" : "bg-transparent text-ink-soft hover:text-ink"}`}
                          // Тач-цель: переключатель статуса был 30px при норме 44.
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
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="modal-due" className={labelCls} style={{ fontSize: 12 }}>Срок</label>
                  <DatePicker value={dueDate} onChange={setDueDate} className={fieldCls} placeholder="Срок" />
                </div>
                <div>
                  <span className={labelCls} style={{ fontSize: 12 }}>{dt("Проект", "Project")}</span>
                  <Select value={selProject ?? NONE} onValueChange={(v) => setSelProject(v === NONE ? null : v)}>
                    <SelectTrigger id="modal-project" className={selectTriggerCls}>
                      {/* Подпись считаем САМИ (base-ui Value в этой версии рисует сырое значение/UUID). */}
                      <span className="truncate">{!selProject || selProject === NONE ? "—" : (projects.find((p) => p.id === selProject)?.name ?? "—")}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {SHOW_TASK_ROLE && (
                <div>
                  <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12 }}>Роль</label>
                  <select id="modal-role" className={fieldCls} value={taskRole} onChange={(e) => setTaskRole(e.target.value)}>
                    <option value={NONE}>— Нет —</option>
                    {TASK_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Страна + Исполнитель в один ряд — экономим вертикаль. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls} style={{ fontSize: 12 }}>Страна</span>
                  {/* Выбор страны — контекстное меню: чип-триггер + портал-поповер с сеткой флагов. */}
                  <CountryPopover value={selectedCountryId} codes={countryCodes} onChange={setCountry} />
                </div>
                <div>
                  <span className={labelCls} style={{ fontSize: 12 }}>Исполнитель</span>
                  {/* «Общие» = без конкретного исполнителя → командная задача (видна во вкладке «Команда»). */}
                  <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
                    <SelectTrigger id="modal-assignee" className={selectTriggerCls}>
                      <span className="truncate">{assigneeId === NONE ? "Общие (вся команда)" : (assigneeOptions.find((o) => o.id === assigneeId)?.name ?? `#${assigneeId}`)}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Общие (вся команда)</SelectItem>
                      {assigneeOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Персональные списки-метки. Видны всегда; выбор списка делает задачу личной. */}
              {labels.length > 0 && (
                <div>
                  <span className={labelCls} style={{ fontSize: 12 }}>Списки</span>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map((l) => {
                      const on = labelIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLabelIds((prev) => (prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold transition-colors ${on ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}
                          style={{ fontSize: 12 }}
                        >
                          <RoyIcon name={((l.icon as RoyIconName) || "tag")} size={13} strokeWidth={1.9} />
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                  {labelIds.length > 0 && !task?.is_private && (
                    <p className="mt-1.5 text-ink-mute" style={{ fontSize: 11.5 }}>
                      Список личный — задача станет видна только тебе.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

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
