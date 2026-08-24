"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, SectionLabel, Chip, Segmented } from "../ui";
import { createTask, updateTask, fetchTask, fetchConfig, fetchUsers } from "@/lib/api";
import { matchesLens, matchesList } from "@/lib/smartLists";
import { readSavedTasksView } from "@/components/tasks/useReminderTasks";
import { displayName } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
import type { User } from "@/types";

const PRI = [
  { id: "high", label: "Высокий" },
  { id: "med", label: "Средний" },
  { id: "low", label: "Низкий" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-surface border border-line-2 rounded-[18px] px-4 py-3 text-ink outline-none focus:border-primary";

export function NewTask({ id }: { id?: string }) {
  const { me, pop, setTab, toast, openTasks } = useRoyNav();
  const editing = !!id;
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [priority, setPriority] = useState("med");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [markets, setMarkets] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig().then((c) => setMarkets(c.allowed_markets || [])).catch(() => {});
    fetchUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchTask(id)
      .then((t) => {
        setTitle(t.title);
        setDesc(t.description ?? "");
        setCountry(t.country);
        setPriority(t.priority ?? "med");
        setDue(t.due_date ? t.due_date.slice(0, 10) : "");
        setAssignee(t.assignee_telegram_ids?.[0] ?? null);
        setIsPrivate(t.is_private);
      })
      .catch(() => {});
  }, [id]);

  const submit = async () => {
    if (!title.trim()) {
      toast("Введите название");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      country,
      priority,
      due_date: due || null,
      assignee_telegram_id: assignee,
      is_private: isPrivate,
    };
    try {
      if (editing) {
        await updateTask(id!, payload);
        toast("Сохранено");
        pop();
      } else {
        const created = await createTask(payload);
        toast("Задача создана");
        // Задача, не попадающая в активный вид списка, выглядела как потерянная: создал без
        // срока → вернулся в «Сегодня» → пусто. Проверяем тем же правилом, которым живёт список,
        // и при промахе открываем вид, где задача видна.
        const view = readSavedTasksView();
        const lens = view?.lens ?? "mine";
        const list = view?.activeList ?? "today";
        const lensOk = matchesLens(created, lens, me);
        if (lensOk && matchesList(created, list)) setTab("task");
        else openTasks(lensOk ? lens : "all", "all");
      }
    } catch {
      toast("Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={editing ? "Задача" : "Новая задача"} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-28 pt-1">
        <Field label="Название">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что нужно сделать?" className={inputCls} style={{ fontSize: 15 }} />
        </Field>
        <Field label="Описание">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Детали (необязательно)" className={`${inputCls} resize-none`} style={{ fontSize: 15 }} />
        </Field>
        <Field label="Приоритет">
          <Segmented items={PRI} value={priority} onChange={setPriority} />
        </Field>
        {markets.length > 0 && (
          <Field label="Рынок">
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
        <Field label="Срок">
          <DatePicker value={due} onChange={setDue} className={inputCls} placeholder="Срок" />
        </Field>
        {users.length > 0 && (
          <Field label="Исполнитель">
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
        <button type="button" onClick={() => setIsPrivate((v) => !v)} className="flex w-full items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3.5">
          <span className="font-medium text-ink" style={{ fontSize: 14.5 }}>
            Личная задача
          </span>
          <span className="relative inline-block transition-colors" style={{ width: 44, height: 26, borderRadius: 999, background: isPrivate ? "var(--primary)" : "var(--line-2)" }}>
            <span className="absolute top-0.5 rounded-full bg-white transition-all" style={{ width: 22, height: 22, left: isPrivate ? 20 : 2 }} />
          </span>
        </button>
      </div>
      <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={submit} disabled={saving} className="w-full rounded-[14px] bg-primary py-3.5 font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
          {editing ? "Сохранить" : "Создать задачу"}
        </button>
      </div>
    </div>
  );
}
