"use client";
import { useState, useEffect } from "react";
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
} from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { Segmented } from "@/components/roy/ui";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { PictogramPicker, type PictoOption } from "@/components/tasks/PictogramPicker";
import { TaskComments } from "@/components/tasks/TaskComments";
import { COUNTRY_NAMES, countryName, countryFlag, countryCode } from "@/lib/countries";
import { useDt } from "@/components/roy/nav";

const TASK_ROLES = [
  { value: "marketing", label: "Marketing" },
  { value: "bd", label: "BD" },
  { value: "rnd", label: "R&D" },
];

const STATUSES = [
  { id: "open", label: "Открыто" },
  { id: "in_progress", label: "В работе" },
  { id: "done", label: "Готово" },
];
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Sentinel for the assignee/role selects — empty string is not a valid select value
const NONE = "__none__";

// Roy-стилизованные нативные контролы (без shadcn): стекло + линия + янтарный фокус.
const fieldCls =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute dark:backdrop-blur-sm";
const labelCls = "mb-1.5 block font-semibold text-ink-soft";

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

export function TaskModal({ task, open, onClose, onSaved, prefill, meetingId, projectId }: TaskModalProps) {
  const isEdit = !!task;
  const confirm = useConfirm();
  const dt = useDt();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("open");
  const [description, setDescription] = useState("");
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? prefill?.title ?? "");
    setStatus(normStatus(task?.status));
    setDescription(task?.description ?? prefill?.description ?? "");
    setDueDate(task?.due_date ?? prefill?.due_date ?? "");
    setCountry(task?.country ?? prefill?.country ?? "");
    setTaskRole(task?.task_role ?? NONE);
    const cur = task?.assignee_telegram_ids?.[0]?.toString() ?? NONE;
    setAssigneeId(cur);
    setInitialAssignee(cur);
    setLabelIds(task?.label_ids ?? []);
    setSelProject(task?.project_id ?? projectId ?? null);
    setError(null);
    fetchUsers().then(setUsers).catch(() => {});
    fetchTaskLabels().then(setLabels).catch(() => {});
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
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
  // Дедуп сверяем через ту же нормализацию, что countryName/countryFlag (countryCode()),
  // иначе легаси-значение вроде "kz" или "Kazakhstan" не матчится с каноническим "KZ"
  // и попадает в список вторым, дублирующим пунктом.
  const countryCodes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  let selectedCountryId = country;
  if (country) {
    const normalizedCountry = countryCode(country);
    const matchedCode = countryCodes.find((code) => countryCode(code) === normalizedCountry);
    if (matchedCode) {
      // Уже есть канонический пункт для этой страны — подсвечиваем его, а не легаси-значение.
      selectedCountryId = matchedCode;
    } else {
      countryCodes.push(country);
    }
  }
  const countryOptions: PictoOption[] = [
    { id: "", label: "Global", icon: "globe" },
    ...countryCodes.map((code) => ({ id: code, label: countryName(code), flag: countryFlag(code) })),
  ];

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Нужно название");
      return;
    }
    setSaving(true);
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
      if (isEdit && task) {
        // Исполнителя шлём только если поменяли — иначе правка других полей затёрла бы
        // назначение, которое нельзя было префиллить (имя без telegram_id).
        const fields: UpdateTaskInput = { ...base, status, project_id: selProject };
        if (assigneeId !== initialAssignee) fields.assignee_telegram_id = assigneeValue;
        // Списки — личные: выбор списка делает задачу личной (метки живут только на личных задачах).
        if (labelIds.length > 0 && !task.is_private) fields.is_private = true;
        if (task.is_private || labelIds.length > 0) fields.label_ids = labelIds;
        await updateTask(task.id, fields);
      } else {
        const fields: CreateTaskInput = { ...base, assignee_telegram_id: assigneeValue, project_id: selProject };
        if (meetingId) fields.meeting_id = meetingId;
        if (labelIds.length > 0) fields.is_private = true;
        const created = await createTask(fields);
        // POST /tasks не принимает label_ids — вешаем метки вторым шагом на уже личную задачу.
        if (labelIds.length > 0) await updateTask(created.id, { label_ids: labelIds });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
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

  const busy = saving || deleting;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 rounded-[20px] border border-line bg-[var(--popover)] p-0 sm:max-w-3xl dark:backdrop-blur-xl"
      >
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-bold text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {isEdit ? "Изменить задачу" : "Новая задача"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex items-center justify-center rounded-[10px] p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <RoyIcon name="x" size={18} />
          </button>
        </div>

        {/* Поля — две колонки: слева название + большое поле редактуры, справа настройки */}
        <div className="max-h-[74vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-[1.4fr_1fr]">
            {/* Левая колонка: название + редактура */}
            <div className="flex flex-col gap-3.5">
              <div>
                <label htmlFor="modal-title" className={labelCls} style={{ fontSize: 12.5 }}>Название *</label>
                <input
                  id="modal-title"
                  className={fieldCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название задачи"
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <label htmlFor="modal-desc" className={labelCls} style={{ fontSize: 12.5 }}>Описание</label>
                <textarea
                  id="modal-desc"
                  className={`${fieldCls} flex-1 resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Подробности, контекст, что именно сделать…"
                  style={{ minHeight: 280, lineHeight: 1.6 }}
                />
              </div>
            </div>

            {/* Правая колонка: настройки */}
            <div className="flex flex-col gap-3.5">
              {isEdit && (
                <div>
                  <span className={labelCls} style={{ fontSize: 12.5 }}>Статус</span>
                  <Segmented items={STATUSES} value={status} onChange={setStatus} />
                </div>
              )}

              <div>
                <label htmlFor="modal-due" className={labelCls} style={{ fontSize: 12.5 }}>Срок</label>
                <DatePicker value={dueDate} onChange={setDueDate} className={fieldCls} placeholder="Срок" />
              </div>

              <div>
                <label htmlFor="modal-project" className={labelCls} style={{ fontSize: 12.5 }}>{dt("Проект", "Project")}</label>
                <select
                  id="modal-project"
                  className={fieldCls}
                  value={selProject ?? NONE}
                  onChange={(e) => setSelProject(e.target.value === NONE ? null : e.target.value)}
                >
                  <option value={NONE}>—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12.5 }}>Роль</label>
                <select id="modal-role" className={fieldCls} value={taskRole} onChange={(e) => setTaskRole(e.target.value)}>
                  <option value={NONE}>— Нет —</option>
                  {TASK_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <span className={labelCls} style={{ fontSize: 12.5 }}>Страна</span>
                <PictogramPicker
                  ariaLabel="Страна"
                  multi={false}
                  options={countryOptions}
                  selected={selectedCountryId ? [selectedCountryId] : [""]}
                  onToggle={(code) => setCountry(code)}
                  trigger={
                    <span className={`${fieldCls} flex items-center justify-between`}>
                      <span className="flex items-center gap-2 truncate">
                        <span style={{ fontSize: 15 }}>{country ? countryFlag(country) : "🌐"}</span>
                        <span className="truncate">{country ? countryName(country) : "Global"}</span>
                      </span>
                      <RoyIcon name="cright" size={16} strokeWidth={1.9} className="shrink-0 text-ink-soft" />
                    </span>
                  }
                />
              </div>

              <div>
                <label htmlFor="modal-assignee" className={labelCls} style={{ fontSize: 12.5 }}>Исполнитель</label>
                <select id="modal-assignee" className={fieldCls} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {/* «Общие» = без конкретного исполнителя → командная задача (видна во вкладке «Команда»). */}
                  <option value={NONE}>Общие (вся команда)</option>
                  {assigneeOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              {/* Персональные списки-метки. Видны всегда; выбор списка делает задачу личной. */}
              {labels.length > 0 && (
                <div>
                  <span className={labelCls} style={{ fontSize: 12.5 }}>Списки</span>
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
            <div className="mt-1 border-t border-line pt-4">
              <TaskComments taskId={task.id} />
            </div>
          )}

          {error && <p className="mt-3 font-semibold" style={{ fontSize: 13, color: "var(--pri-high)" }}>{error}</p>}
        </div>

        {/* Действия */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          {isEdit ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-[12px] px-3 py-2 font-semibold transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14, color: "var(--pri-high)" }}
            >
              {deleting ? "Удаление…" : "Удалить"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-[12px] border border-line bg-surface px-4 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-[12px] bg-primary px-4 py-2 font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 14 }}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
