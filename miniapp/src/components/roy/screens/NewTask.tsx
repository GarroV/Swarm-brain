"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRoyNav, useDt } from "../nav";
import { TaskHydrationNotice } from "@/components/tasks/taskModalPresentation";
import { NavHeader, SectionLabel, Chip, Segmented } from "../ui";
import { createTask, updateTask, fetchTask, fetchConfig, fetchUsers } from "@/lib/api";
import { matchesLens, matchesList, DEFAULT_STATUSES } from "@/lib/smartLists";
import { tomorrowLocalISO } from "@/lib/dateRange";
import { readSavedTasksView } from "@/components/tasks/useReminderTasks";
import { displayName } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
import type { User } from "@/types";

const NEW_TASK_COPY = {
  priorityHigh: { ru: "Высокий", en: "High" },
  priorityMedium: { ru: "Средний", en: "Medium" },
  priorityLow: { ru: "Низкий", en: "Low" },
  titleRequired: { ru: "Введите название", en: "Enter a title" },
  saved: { ru: "Сохранено", en: "Saved" },
  created: { ru: "Задача создана", en: "Task created" },
  saveError: { ru: "Не удалось сохранить", en: "Could not save" },
  task: { ru: "Задача", en: "Task" },
  newTask: { ru: "Новая задача", en: "New task" },
  title: { ru: "Название", en: "Title" },
  titlePlaceholder: { ru: "Что нужно сделать?", en: "What needs to be done?" },
  description: { ru: "Описание", en: "Description" },
  descriptionPlaceholder: { ru: "Детали (необязательно)", en: "Details (optional)" },
  priority: { ru: "Приоритет", en: "Priority" },
  market: { ru: "Рынок", en: "Market" },
  due: { ru: "Срок", en: "Due date" },
  assignee: { ru: "Исполнитель", en: "Assignee" },
  save: { ru: "Сохранить", en: "Save" },
  create: { ru: "Создать задачу", en: "Create task" },
} as const;

const PRI = [
  { id: "high", label: NEW_TASK_COPY.priorityHigh },
  { id: "med", label: NEW_TASK_COPY.priorityMedium },
  { id: "low", label: NEW_TASK_COPY.priorityLow },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

const HYDRATION_COPY = { loading: { ru: "Загружаем задачу…", en: "Loading task…" } } as const;

const inputCls = "w-full bg-surface border border-line-2 rounded-[8px] px-4 py-3 text-ink outline-none focus:border-primary";

export function NewTask({ id }: { id?: string }) {
  const { me, pop, setTab, toast, openTasks } = useRoyNav();
  const editing = !!id;
  const dt = useDt();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [priority, setPriority] = useState("med");
  // Срок обязателен и по умолчанию завтрашний (решение владельца 21.09.2026): пустое поле
  // рождало задачу без срока, а такая не попадала ни в «Сегодня», ни в «Ближайшие» (#440).
  const [due, setDue] = useState(tomorrowLocalISO());
  const [assignee, setAssignee] = useState<number | null>(null);
  const [markets, setMarkets] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [hydratedTaskId, setHydratedTaskId] = useState<string | null>(null);
  const [hydrateFailed, setHydrateFailed] = useState(false);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  // A new id is blocked immediately, before its loading effect runs.
  const ready = !editing || hydratedTaskId === id;

  useEffect(() => {
    fetchConfig().then((c) => setMarkets(c.allowed_markets || [])).catch(() => {});
    fetchUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setHydratedTaskId(null);
    setHydrateFailed(false);
    fetchTask(id)
      .then((t) => {
        if (cancelled) return;
        // The same full-task discriminator as TaskModal (#145): null is a valid
        // empty description, but an omitted description is a list projection.
        if (t.description === undefined) throw new Error("Incomplete task response");
        setTitle(t.title);
        setDesc(t.description ?? "");
        setCountry(t.country);
        setPriority(t.priority ?? "med");
        setDue(t.due_date ? t.due_date.slice(0, 10) : "");
        setAssignee(t.assignee_telegram_ids?.[0] ?? null);
        setHydratedTaskId(id);
      })
      .catch(() => { if (!cancelled) setHydrateFailed(true); });
    return () => { cancelled = true; };
  }, [id, hydrateAttempt]);

  const submit = async () => {
    // Keep the write guard here as well as in the DOM: defaults must never replace
    // the existing task while its initial GET is pending or has failed (#600).
    if (!ready || saving) return;
    if (!title.trim()) {
      toast(dt(NEW_TASK_COPY.titleRequired.ru, NEW_TASK_COPY.titleRequired.en));
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      country,
      priority,
      due_date: due || tomorrowLocalISO(),
      assignee_telegram_id: assignee,
    };
    try {
      if (editing) {
        await updateTask(id!, payload);
        toast(dt(NEW_TASK_COPY.saved.ru, NEW_TASK_COPY.saved.en));
        pop();
      } else {
        const created = await createTask(payload);
        toast(dt(NEW_TASK_COPY.created.ru, NEW_TASK_COPY.created.en));
        // Задача, не попадающая в активный вид списка, выглядела как потерянная: создал без
        // срока → вернулся в «Сегодня» → пусто. Проверяем тем же правилом, которым живёт список,
        // и при промахе открываем вид, где задача видна.
        const view = readSavedTasksView();
        const lens = view?.lens ?? "mine";
        const list = view?.activeList ?? "today";
        const statuses = view?.statuses ? new Set(view.statuses) : DEFAULT_STATUSES;
        const lensOk = matchesLens(created, lens, me);
        // Период тоже учитываем: с включённой «Этой неделей» задача вне диапазона так же
        // невидима, и «пропала» вернулось бы ровно тем же способом (фича периода пришла из main).
        if (lensOk && matchesList(created, list, new Date(), view?.range ?? null, statuses)) setTab("task");
        else openTasks(lensOk ? lens : "all", "all");
      }
    } catch {
      toast(dt(NEW_TASK_COPY.saveError.ru, NEW_TASK_COPY.saveError.en));
      setSaving(false);
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={editing ? dt(NEW_TASK_COPY.task.ru, NEW_TASK_COPY.task.en) : dt(NEW_TASK_COPY.newTask.ru, NEW_TASK_COPY.newTask.en)} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-28 pt-1">
        {!ready && hydrateFailed && <TaskHydrationNotice setHydrateAttempt={setHydrateAttempt} />}
        {!ready && !hydrateFailed && (
          <div role="status" className="text-sm text-ink-soft">{dt(HYDRATION_COPY.loading.ru, HYDRATION_COPY.loading.en)}</div>
        )}
        <fieldset disabled={!ready} aria-busy={!ready && !hydrateFailed} className="m-0 min-w-0 space-y-5 border-0 p-0 disabled:opacity-60">
        <Field label={dt(NEW_TASK_COPY.title.ru, NEW_TASK_COPY.title.en)}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={dt(NEW_TASK_COPY.titlePlaceholder.ru, NEW_TASK_COPY.titlePlaceholder.en)} className={inputCls} style={{ fontSize: 15 }} />
        </Field>
        <Field label={dt(NEW_TASK_COPY.description.ru, NEW_TASK_COPY.description.en)}>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder={dt(NEW_TASK_COPY.descriptionPlaceholder.ru, NEW_TASK_COPY.descriptionPlaceholder.en)} className={`${inputCls} resize-none`} style={{ fontSize: 15 }} />
        </Field>
        <Field label={dt(NEW_TASK_COPY.priority.ru, NEW_TASK_COPY.priority.en)}>
          <Segmented items={PRI.map(({ id, label }) => ({ id, label: dt(label.ru, label.en) }))} value={priority} onChange={setPriority} />
        </Field>
        {markets.length > 0 && (
          <Field label={dt(NEW_TASK_COPY.market.ru, NEW_TASK_COPY.market.en)}>
            <div className="flex flex-wrap gap-2">
              <Chip active={country === null} onClick={() => setCountry(null)}>
                —
              </Chip>
              {markets.map((m) => (
                <Chip key={m} active={country === m} onClick={() => setCountry(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </Field>
        )}
        <Field label={dt(NEW_TASK_COPY.due.ru, NEW_TASK_COPY.due.en)}>
          <DatePicker value={due} onChange={setDue} className={inputCls} placeholder={dt(NEW_TASK_COPY.due.ru, NEW_TASK_COPY.due.en)} />
        </Field>
        {users.length > 0 && (
          <Field label={dt(NEW_TASK_COPY.assignee.ru, NEW_TASK_COPY.assignee.en)}>
            <div className="flex flex-wrap gap-2">
              <Chip active={assignee === null} onClick={() => setAssignee(null)}>
                —
              </Chip>
              {users.map((u) => (
                <Chip key={u.telegram_id} active={assignee === u.telegram_id} onClick={() => setAssignee(u.telegram_id)}>
                  {displayName(u.name)}
                </Chip>
              ))}
            </div>
          </Field>
        )}
        </fieldset>
      </div>
      <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={submit} disabled={saving || !ready} className="w-full rounded-full bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
          {editing ? dt(NEW_TASK_COPY.save.ru, NEW_TASK_COPY.save.en) : dt(NEW_TASK_COPY.create.ru, NEW_TASK_COPY.create.en)}
        </button>
      </div>
    </div>
  );
}
