"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  fetchTasks, updateTask, fetchSprints, createSprint, fetchMe,
  addTasksToSprint, removeTasksFromSprint,
} from "@/lib/api";
import type { Task, Sprint } from "@/types";
import { statusColor } from "@/lib/timeline";
import { Button } from "@/components/ui/button";

const COLUMNS = [
  { status: "open", label: "Открыто" },
  { status: "in_progress", label: "В работе" },
  { status: "done", label: "Готово" },
] as const;

const BACKLOG = "backlog";

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function SprintBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selected, setSelected] = useState<string>(BACKLOG);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });

  const load = useCallback(async () => {
    try {
      const [t, s, me] = await Promise.all([fetchTasks(), fetchSprints(), fetchMe()]);
      setTasks(t);
      setSprints(s);
      setIsAdmin(me.is_admin);
      setSelected((cur) => (cur === BACKLOG && s.some((x) => x.status === "active") ? s.find((x) => x.status === "active")!.id : cur));
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const inScope = tasks.filter((t) => (selected === BACKLOG ? !t.sprint_id : t.sprint_id === selected));
  const doneCount = inScope.filter((t) => t.status === "done").length;

  async function moveStatus(taskId: string, status: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try { await updateTask(taskId, { status }); } catch { load(); }
  }

  async function moveToSprint(taskId: string, sprintId: string) {
    const target = sprintId === BACKLOG ? null : sprintId;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, sprint_id: target } : t)));
    try {
      if (target) await addTasksToSprint(target, [taskId]);
      else {
        const cur = tasks.find((t) => t.id === taskId)?.sprint_id;
        if (cur) await removeTasksFromSprint(cur, [taskId]);
      }
    } catch { load(); }
  }

  async function submitSprint() {
    if (!form.name.trim()) { setFormErr("Введите название спринта"); return; }
    if (!form.start_date || !form.end_date) { setFormErr("Укажите даты начала и конца"); return; }
    if (form.start_date > form.end_date) { setFormErr("Дата начала позже даты конца"); return; }
    setSaving(true);
    setFormErr(null);
    try {
      const created = await createSprint(form);
      setForm({ name: "", start_date: "", end_date: "" });
      setCreating(false);
      await load();
      setSelected(created.id);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Не удалось создать спринт");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-4 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">Спринты</h1>
      </header>

      {/* Селектор спринтов */}
      <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto shrink-0 items-center">
        {[
          { id: BACKLOG, name: "Бэклог", isActive: false },
          ...sprints.map((s) => ({ id: s.id, name: s.name, isActive: s.status === "active" })),
        ].map((chip) => {
          const active = selected === chip.id;
          return (
            <button
              key={chip.id}
              onClick={() => setSelected(chip.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {chip.name}{chip.isActive ? " ·" : ""}
            </button>
          );
        })}
        {isAdmin && (
          <button onClick={() => setCreating((v) => !v)} className="rounded-full p-1.5 bg-secondary text-secondary-foreground shrink-0">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Форма создания спринта */}
      {creating && (
        <div className="mx-4 mb-2 p-3 rounded-lg border border-border space-y-2">
          <input className="w-full text-sm bg-transparent border-b border-border py-1 outline-none"
            placeholder="Название спринта" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            <input type="date" className="flex-1 text-sm bg-transparent border-b border-border py-1 outline-none"
              value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <input type="date" className="flex-1 text-sm bg-transparent border-b border-border py-1 outline-none"
              value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          {formErr && <p className="text-xs text-destructive">{formErr}</p>}
          <Button size="sm" className="w-full h-8 text-xs" onClick={submitSprint} disabled={saving}>
            {saving ? "Создание…" : "Создать спринт"}
          </Button>
        </div>
      )}

      {/* Прогресс выбранного спринта */}
      {selected !== BACKLOG && inScope.length > 0 && (
        <div className="px-5 pb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Прогресс</span>
            <span className="font-semibold">{doneCount}/{inScope.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(doneCount / inScope.length) * 100}%`, background: "oklch(0.72 0.16 155)" }} />
          </div>
        </div>
      )}

      {/* Колонки */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {COLUMNS.map((col) => {
            const colTasks = inScope.filter((t) => t.status === col.status);
            const c = statusColor(col.status);
            return (
              <div
                key={col.status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) moveStatus(id, col.status); }}
                className="w-72 shrink-0 flex flex-col rounded-xl bg-muted/40 p-2"
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: c.bar }} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pt-1">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
                      className="rounded-lg bg-card border border-border shadow-sm p-3 cursor-grab active:cursor-grabbing"
                    >
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                        {t.due_date && <span>📅 {t.due_date}</span>}
                        {t.assignees.length > 0 && <span className="ml-auto font-bold">{initials(t.assignees)}</span>}
                      </div>
                      <select
                        value={t.sprint_id ?? BACKLOG}
                        onChange={(e) => moveToSprint(t.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 w-full text-[11px] bg-transparent text-muted-foreground border-t border-border pt-1.5 outline-none"
                      >
                        <option value={BACKLOG}>Бэклог</option>
                        {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <p className="text-center text-xs text-muted-foreground/60 py-6">пусто</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
