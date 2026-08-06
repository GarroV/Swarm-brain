"use client";
import { useCallback, useEffect, useState } from "react";
import {
  fetchTasks, updateTask, fetchSprints, createSprint, fetchMe,
  addTasksToSprint, removeTasksFromSprint, deleteSprint,
  fetchProjects, createProject, createTask,
} from "@/lib/api";
import type { Task, Sprint, Project } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { Button } from "@/components/ui/button";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";

function fmtDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// Колонки по статусу. Бэклог — куда копятся задачи/идеи; оттуда тянутся в работу.
const COLUMNS = [
  { status: "backlog", label: "Бэклог", bar: "var(--status-open)" },
  { status: "open", label: "Открыто", bar: "#8C8475" },
  { status: "in_progress", label: "В работе", bar: "var(--status-prog)" },
  { status: "done", label: "Готово", bar: "var(--status-done)" },
] as const;

const BACKLOG = "backlog";        // sprint-селектор: задачи вне спринтов
const NO_SECTION = "__none__";    // секция для задач без проекта

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

type DragInfo = { id: string } | null;

export function SprintBoard() {
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>(BACKLOG);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const [editing, setEditing] = useState<Task | null>(null);
  const [deletingSprint, setDeletingSprint] = useState(false);
  // добавление секции (= проекта)
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  // быстрый ввод задачи: ключ `${sectionId}` → черновик заголовка
  const [quickAdd, setQuickAdd] = useState<{ section: string; title: string } | null>(null);
  const drag = useState<DragInfo>(null); const dragRef = drag[0]; const setDrag = drag[1];

  const load = useCallback(async () => {
    try {
      const [t, s, me, p] = await Promise.all([fetchTasks(), fetchSprints(), fetchMe(), fetchProjects()]);
      setTasks(t); setSprints(s); setIsAdmin(me.is_admin); setProjects(p);
      setSelected((cur) => (cur === BACKLOG && s.some((x) => x.status === "active") ? s.find((x) => x.status === "active")!.id : cur));
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const inScope = tasks.filter((t) => (selected === BACKLOG ? !t.sprint_id : t.sprint_id === selected));
  const doneCount = inScope.filter((t) => t.status === "done").length;

  // Секции = пользовательские проекты (владелец задаёт сам) + «Без секции» (если есть неразложенные).
  const sections: Array<{ id: string; name: string; real: boolean }> = [
    ...projects.map((p) => ({ id: p.id, name: p.name, real: true })),
  ];
  if (inScope.some((t) => !t.project_id)) sections.push({ id: NO_SECTION, name: "Без секции", real: false });

  async function applyDrop(taskId: string, sectionId: string, status: string) {
    const project_id = sectionId === NO_SECTION ? null : sectionId;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, project_id } : t)));
    try { await updateTask(taskId, { status, project_id }); } catch { load(); }
  }

  async function moveToSprint(taskId: string, sprintId: string) {
    const target = sprintId === BACKLOG ? null : sprintId;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, sprint_id: target } : t)));
    try {
      if (target) await addTasksToSprint(target, [taskId]);
      else { const cur = tasks.find((t) => t.id === taskId)?.sprint_id; if (cur) await removeTasksFromSprint(cur, [taskId]); }
    } catch { load(); }
  }

  async function addSection() {
    const name = sectionName.trim();
    if (!name) return;
    setSectionName(""); setAddingSection(false);
    try { const p = await createProject({ name }); setProjects((prev) => [...prev, p]); } catch { load(); }
  }

  async function addTask(sectionId: string, title: string) {
    const t = title.trim();
    if (!t) { setQuickAdd(null); return; }
    setQuickAdd(null);
    const project_id = sectionId === NO_SECTION ? undefined : sectionId;
    const sprint_id = selected === BACKLOG ? undefined : selected;
    try { await createTask({ title: t, status: "backlog", project_id, sprint_id }); await load(); }
    catch { load(); }
  }

  async function submitSprint() {
    if (!form.name.trim()) { setFormErr("Введите название спринта"); return; }
    if (!form.start_date || !form.end_date) { setFormErr("Укажите даты начала и конца"); return; }
    if (form.start_date > form.end_date) { setFormErr("Дата начала позже даты конца"); return; }
    setSaving(true); setFormErr(null);
    try {
      const created = await createSprint(form);
      setForm({ name: "", start_date: "", end_date: "" }); setCreating(false);
      await load(); setSelected(created.id);
    } catch (e) { setFormErr(e instanceof Error ? e.message : "Не удалось создать спринт"); }
    finally { setSaving(false); }
  }

  async function handleDeleteSprint() {
    if (selected === BACKLOG || deletingSprint) return;
    const sprint = sprints.find((s) => s.id === selected);
    if (!sprint) return;
    if (!(await confirm({ title: `Удалить спринт «${sprint.name}»?`, description: "Задачи спринта вернутся в бэклог — они не будут удалены.", confirmText: "Удалить спринт" }))) return;
    setDeletingSprint(true);
    try {
      const ids = tasks.filter((t) => t.sprint_id === selected).map((t) => t.id);
      if (ids.length) await removeTasksFromSprint(selected, ids);
      await deleteSprint(selected); setSelected(BACKLOG); await load();
    } catch { load(); } finally { setDeletingSprint(false); }
  }

  if (loading) return <p className="text-center text-ink-soft py-12 text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-4 pb-2">
        <h1 className="font-bold leading-[1.1] text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Спринты</h1>
      </header>

      {/* Селектор спринтов */}
      <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto shrink-0 items-center">
        {[{ id: BACKLOG, name: "Бэклог", isActive: false }, ...sprints.map((s) => ({ id: s.id, name: s.name, isActive: s.status === "active" }))].map((chip) => {
          const active = selected === chip.id;
          return (
            <button key={chip.id} onClick={() => setSelected(chip.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm"}`}>
              {chip.name}{chip.isActive ? " ·" : ""}
            </button>
          );
        })}
        {isAdmin && (
          <button onClick={() => setCreating((v) => !v)} className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm shrink-0" title="Новый спринт">
            <RoyIcon name="plus" size={14} strokeWidth={2} />
          </button>
        )}
        {isAdmin && selected !== BACKLOG && (
          <button onClick={handleDeleteSprint} disabled={deletingSprint} title="Удалить спринт"
            className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 hover:text-destructive disabled:opacity-50 dark:backdrop-blur-sm shrink-0">
            <RoyIcon name="trash" size={14} />
          </button>
        )}
      </div>

      {creating && (
        <div className="mx-4 mb-2 p-3 rounded-lg border border-line space-y-2">
          <input className="w-full text-sm bg-transparent border-b border-line py-1 outline-none" placeholder="Название спринта" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            <input type="date" className="flex-1 text-sm bg-transparent border-b border-line py-1 outline-none" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <input type="date" className="flex-1 text-sm bg-transparent border-b border-line py-1 outline-none" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          {formErr && <p className="text-xs text-destructive">{formErr}</p>}
          <Button size="sm" className="w-full h-8 text-xs" onClick={submitSprint} disabled={saving}>{saving ? "Создание…" : "Создать спринт"}</Button>
        </div>
      )}

      {selected !== BACKLOG && inScope.length > 0 && (
        <div className="px-5 pb-2">
          <div className="flex justify-between text-xs text-ink-soft mb-1"><span>Прогресс</span><span className="font-semibold">{doneCount}/{inScope.length}</span></div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / inScope.length) * 100}%`, background: "var(--status-done)" }} /></div>
        </div>
      )}

      {/* Доска: секции (проекты) по вертикали × колонки статусов по горизонтали */}
      <div className="flex-1 overflow-auto px-4 pb-4 space-y-4">
        {sections.length === 0 && (
          <p className="text-center text-sm text-ink-soft/70 py-10">Секций пока нет. Добавьте секцию (проект) кнопкой ниже и накидывайте в неё задачи.</p>
        )}
        {sections.map((sec) => {
          const secTasks = inScope.filter((t) => (sec.id === NO_SECTION ? !t.project_id : t.project_id === sec.id));
          return (
            <section key={sec.id} className="rounded-2xl border border-line bg-surface/40 dark:backdrop-blur-sm">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                <RoyIcon name="board" size={14} strokeWidth={1.9} />
                <span className="text-sm font-bold text-ink">{sec.name}</span>
                <span className="text-xs text-ink-soft">{secTasks.length}</span>
                <button onClick={() => setQuickAdd({ section: sec.id, title: "" })} className="ml-auto rounded-full p-1 text-ink-soft hover:bg-surface-2" title="Добавить задачу в бэклог секции">
                  <RoyIcon name="plus" size={14} strokeWidth={2} />
                </button>
              </div>
              <div className="flex gap-3 p-3 overflow-x-auto">
                {COLUMNS.map((col) => {
                  const colTasks = secTasks.filter((t) => (col.status === "backlog" ? (t.status === "backlog" || (t.status !== "open" && t.status !== "in_progress" && t.status !== "done")) : t.status === col.status));
                  return (
                    <div key={col.status}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); if (dragRef) { applyDrop(dragRef.id, sec.id, col.status); setDrag(null); } }}
                      className="w-64 shrink-0 flex flex-col rounded-xl bg-surface-2 border border-line p-2 dark:backdrop-blur-lg">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: col.bar }} />
                        <span className="text-xs font-semibold text-ink">{col.label}</span>
                        <span className="ml-auto text-xs text-ink-soft">{colTasks.length}</span>
                      </div>
                      {/* быстрый ввод — в колонке Бэклог */}
                      {col.status === "backlog" && quickAdd?.section === sec.id && (
                        <input autoFocus value={quickAdd.title}
                          onChange={(e) => setQuickAdd({ section: sec.id, title: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") addTask(sec.id, quickAdd.title); if (e.key === "Escape") setQuickAdd(null); }}
                          onBlur={() => addTask(sec.id, quickAdd.title)}
                          placeholder="Новая задача, Enter"
                          className="mx-1 mb-1 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary/50" />
                      )}
                      <div className="flex-1 overflow-y-auto space-y-2 pt-1 min-h-[40px]">
                        {colTasks.map((t) => (
                          <div key={t.id} draggable
                            onDragStart={(e) => { setDrag({ id: t.id }); e.dataTransfer.effectAllowed = "move"; }}
                            onDragEnd={() => setDrag(null)}
                            onClick={() => setEditing(t)}
                            className="rounded-lg bg-card border border-line shadow-sm p-2.5 cursor-pointer hover:border-primary/40 active:cursor-grabbing dark:backdrop-blur-sm">
                            <p className="text-sm font-medium leading-snug text-ink">{t.title}</p>
                            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-soft">
                              {t.due_date && <span className="inline-flex items-center gap-1"><RoyIcon name="cal" size={11} /> {fmtDay(t.due_date)}</span>}
                              {t.assignees.length > 0 && <span className="ml-auto font-bold">{initials(t.assignees)}</span>}
                            </div>
                            <select value={t.sprint_id ?? BACKLOG} onChange={(e) => moveToSprint(t.id, e.target.value)} onClick={(e) => e.stopPropagation()}
                              className="mt-2 w-full text-[11px] bg-transparent text-ink-soft border-t border-line pt-1.5 outline-none">
                              <option value={BACKLOG}>Вне спринта</option>
                              {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Добавить секцию (= проект), задаёт владелец */}
        {addingSection ? (
          <div className="flex items-center gap-2 max-w-sm">
            <input autoFocus value={sectionName} onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSection(); if (e.key === "Escape") setAddingSection(false); }}
              placeholder="Название секции (напр. «Бот по стройкам»)"
              className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary/50" />
            <Button size="sm" className="h-9 text-xs" onClick={addSection}>Добавить</Button>
            <button onClick={() => setAddingSection(false)} className="text-xs text-ink-soft px-2">Отмена</button>
          </div>
        ) : (
          <button onClick={() => setAddingSection(true)} className="flex items-center gap-1.5 rounded-full bg-surface border border-dashed border-line-2 px-4 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-2">
            <RoyIcon name="plus" size={14} strokeWidth={2} /> Секция
          </button>
        )}
      </div>

      <TaskModal task={editing ?? undefined} open={!!editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </div>
  );
}
