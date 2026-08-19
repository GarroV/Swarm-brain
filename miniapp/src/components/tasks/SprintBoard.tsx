"use client";
import { useCallback, useEffect, useState } from "react";
import {
  fetchTasks, updateTask, fetchSprints, createSprint,
  removeTasksFromSprint, deleteSprint,
  fetchProjects, createProject, createTask, updateProject, deleteProject,
} from "@/lib/api";
import type { Task, Sprint, Project } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { Button } from "@/components/ui/button";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";
import { useDt } from "@/components/roy/nav";

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

// Рабочие колонки пространства подпроекта (без бэклога — бэклог общий на проект, слева).
const WORK_COLUMNS = COLUMNS.filter((c) => c.status !== "backlog");
const isBacklogStatus = (s: string) => s !== "open" && s !== "in_progress" && s !== "done";

const ALL = "__all__";            // селектор вкладок: показать проекты ВСЕХ вкладок (обзор)
const EXPANDED_KEY = "swarm.board.expandedProjects"; // localStorage: какие проекты раскрыты (персонально)
// Подпроекты по умолчанию РАЗВЁРНУТЫ (обратная полярность к EXPANDED_KEY — так поведение для
// уже существующих пользователей не меняется молча: пустой localStorage = как раньше, всё видно).
const COLLAPSED_SUBS_KEY = "swarm.board.collapsedSubprojects";
const NO_SECTION = "__none__";    // секция для задач без проекта

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

type DragInfo = { id: string } | null;

export function SprintBoard() {
  const confirm = useConfirm();
  const dt = useDt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>(ALL);
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
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // быстрый ввод задачи: ключ `${sectionId}` → черновик заголовка
  const [quickAdd, setQuickAdd] = useState<{ section: string; status: string; title: string } | null>(null);
  const drag = useState<DragInfo>(null); const dragRef = drag[0]; const setDrag = drag[1];
  // Проекты — плитки: по умолчанию свёрнуты, двойной клик разворачивает. Состояние ПЕРСОНАЛЬНОЕ
  // (localStorage, не общее): раскрыл проект у себя — у других он остаётся свёрнутым.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [addingSubOf, setAddingSubOf] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  // Подпроекты — своё персональное сворачивание, отдельное от EXPANDED_KEY (см. коммент выше).
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_SUBS_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  // Drag подпроекта между проектами верхнего уровня (reparent) — отдельно от drag задачи (dragRef),
  // чтобы drop-зоны колонок и drop-зоны заголовков проектов не путали события друг друга.
  const [dragProj, setDragProj] = useState<string | null>(null);
  const [dragOverProject, setDragOverProject] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, s, p] = await Promise.all([fetchTasks(), fetchSprints(), fetchProjects()]);
      setTasks(t); setSprints(s); setProjects(p);
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Вкладка ВЛАДЕЕТ проектами (решение владельца 2026-08-09): выбранная вкладка → её проекты
  // (project.sprint_id === selected), а задача принадлежит вкладке ЧЕРЕЗ свой проект. ALL — обзор
  // проектов всех вкладок. Дерево: верхний уровень = проекты без parent_id; подпроект наследует вкладку.
  const topLevel = projects.filter((p) => !p.parent_id && (selected === ALL || p.sprint_id === selected));
  const childrenOf = (id: string) => projects.filter((p) => p.parent_id === id);

  // inScope — задачи выбранной вкладки (через проекты вкладки): нужны для прогресс-бара.
  const tabProjectIds = new Set(
    (selected === ALL ? projects : projects.filter((p) => p.sprint_id === selected)).map((p) => p.id),
  );
  const inScope = tasks.filter((t) => t.project_id != null && tabProjectIds.has(t.project_id));
  const doneCount = inScope.filter((t) => t.status === "done").length;
  // Доска показывает ТОЛЬКО задачи с проектом (решение владельца 2026-08-07): задачи без
  // проекта на спринт-доску не сыпятся — проект задаче назначается в её карточке.
  const boardEmpty = topLevel.length === 0;

  async function applyDrop(taskId: string, sectionId: string, status: string) {
    const project_id = sectionId === NO_SECTION ? null : sectionId;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, project_id } : t)));
    try { await updateTask(taskId, { status, project_id }); } catch { load(); }
  }

  async function addSection() {
    const name = sectionName.trim();
    if (!name) return;
    setSectionName(""); setAddingSection(false);
    // Проект создаётся в ТЕКУЩЕЙ вкладке; на ALL кнопка «+ Проект» скрыта (нужен выбор вкладки).
    if (selected === ALL) return;
    try { const p = await createProject({ name, sprint_id: selected }); setProjects((prev) => [...prev, p]); } catch { load(); }
  }

  async function submitSubproject(parentId: string) {
    const name = subName.trim();
    if (!name) return;
    setSubName(""); setAddingSubOf(null);
    // Подпроект наследует вкладку родителя.
    const parentSprint = projects.find((p) => p.id === parentId)?.sprint_id ?? (selected === ALL ? null : selected);
    try { const p = await createProject({ name, parent_id: parentId, sprint_id: parentSprint }); setProjects((prev) => [...prev, p]); } catch { load(); }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* приватный режим/квота — не критично */ }
      return next;
    });
  }

  function toggleCollapsedSub(id: string) {
    setCollapsedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(COLLAPSED_SUBS_KEY, JSON.stringify([...next])); } catch { /* приватный режим/квота — не критично */ }
      return next;
    });
  }

  // Перенос подпроекта в другой проект верхнего уровня (drag-n-drop). Бэкенд уже валидирует
  // вложенность (validateParent: не глубже 2 уровней, нельзя подпроектом сделать проект со
  // своими детьми) — здесь только очевидные короткие замыкания + синхронизация sprint_id
  // (подпроект наследует вкладку НОВОГО родителя — тот же инвариант, что и при создании).
  async function moveSubproject(kidId: string, newParentId: string) {
    const kid = projects.find((p) => p.id === kidId);
    const newParent = projects.find((p) => p.id === newParentId);
    if (!kid || !newParent || kid.id === newParentId || kid.parent_id === newParentId) return;
    if (newParent.parent_id) return; // цель сама подпроект — нельзя вкладывать глубже 2 уровней
    const sprint_id = newParent.sprint_id;
    setProjects((prev) => prev.map((p) => (p.id === kidId ? { ...p, parent_id: newParentId, sprint_id } : p)));
    try { await updateProject(kidId, { parent_id: newParentId, sprint_id }); } catch { load(); }
  }

  async function renameSection(id: string, name: string) {
    const n = name.trim(); setRenaming(null);
    if (!n) return;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: n } : p)));
    try { await updateProject(id, { name: n }); } catch { load(); }
  }

  async function removeSection(id: string, name: string) {
    if (!(await confirm({ title: `Удалить проект «${name}»?`, description: "Задачи проекта не удалятся — просто останутся без проекта.", confirmText: "Удалить проект" }))) return;
    // Дети группы промоутятся в верхний уровень (совпадает с ON DELETE SET NULL на FK в БД);
    // без этого локально они бы «пропали» до полного reload — parent_id указывал бы на удалённый id.
    setProjects((prev) => prev.filter((p) => p.id !== id).map((p) => (p.parent_id === id ? { ...p, parent_id: null } : p)));
    setTasks((prev) => prev.map((t) => (t.project_id === id ? { ...t, project_id: null } : t)));
    try { await deleteProject(id); } catch { load(); }
  }

  async function addTask(sectionId: string, status: string, title: string) {
    const t = title.trim();
    if (!t) { setQuickAdd(null); return; }
    setQuickAdd(null);
    const project_id = sectionId === NO_SECTION ? null : sectionId;
    const sprint_id = selected === ALL ? null : selected;
    // Оптимистично: карточка появляется МГНОВЕННО (без ожидания сети), createTask — в фоне,
    // ответом заменяем временную на реальную; при ошибке — откат. Раньше ждали create+полный
    // рефетч → задержка появления.
    const tempId = "temp-" + Date.now();
    const optimistic: Task = {
      id: tempId, title: t, description: null, assignees: [], assignee_telegram_ids: [],
      due_date: null, tags: [], country: null, task_role: null, priority: null, source: "mini_app",
      status, created_at: new Date().toISOString(), updated_at: null, meeting_id: null,
      url: null, group_id: null, created_by_name: null, is_private: false, owner_id: null,
      start_date: null, timeline_position: null, sprint_id, label_ids: [], project_id,
      project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    };
    setTasks((prev) => [optimistic, ...prev]);
    try {
      const created = await createTask({ title: t, status, project_id: project_id ?? undefined, sprint_id: sprint_id ?? undefined });
      // заменяем временную на реальную; фильтруем и temp, и возможный дубль created.id (страховка)
      setTasks((prev) => [created, ...prev.filter((x) => x.id !== tempId && x.id !== created.id)]);
    } catch {
      setTasks((prev) => prev.filter((x) => x.id !== tempId)); // откат
    }
  }

  async function submitSprint() {
    if (!form.name.trim()) { setFormErr("Введите название вкладки"); return; }
    setSaving(true); setFormErr(null);
    // Вкладка — просто именованный фильтр; даты не нужны, но схема спринта их требует —
    // подставляем сегодняшнюю (пользователь их не видит).
    const today = new Date().toISOString().slice(0, 10);
    try {
      const created = await createSprint({ name: form.name.trim(), start_date: today, end_date: today });
      setForm({ name: "", start_date: "", end_date: "" }); setCreating(false);
      await load(); setSelected(created.id);
    } catch (e) { setFormErr(e instanceof Error ? e.message : "Не удалось создать вкладку"); }
    finally { setSaving(false); }
  }

  async function handleDeleteSprint() {
    if (selected === ALL || deletingSprint) return;
    const sprint = sprints.find((s) => s.id === selected);
    if (!sprint) return;
    if (!(await confirm({ title: `Удалить вкладку «${sprint.name}»?`, description: "Задачи из вкладки не удалятся — они просто выйдут из неё.", confirmText: "Удалить вкладку" }))) return;
    setDeletingSprint(true);
    try {
      const ids = tasks.filter((t) => t.sprint_id === selected).map((t) => t.id);
      if (ids.length) await removeTasksFromSprint(selected, ids);
      await deleteSprint(selected); setSelected(ALL); await load();
    } catch { load(); } finally { setDeletingSprint(false); }
  }

  // Один ряд «4 колонки для набора задач» — переиспользуется для обычной секции, ряда
  // подпроекта и ряда «Общее»/«General». sectionId — id (под)проекта или NO_SECTION,
  // на нём завязаны applyDrop/quickAdd/renaming (как и раньше). real=false скрывает
  // переименовать/удалить (для «Общее» и «Без секции» — это не отдельная сущность-проект).
  // 4 колонки статусов (Бэклог/Открыто/В работе/Готово) для набора задач одного (под)проекта.
  // Заголовок проекта — снаружи (плитка), поэтому здесь только колонки. Клик по колонке добавляет задачу.
  function renderColumns(projectId: string, tasks: Task[]) {
    return (
      <div className="flex gap-3 p-3 overflow-x-auto">
        {COLUMNS.map((col) => renderStatusColumn(
          projectId, col,
          col.status === "backlog" ? tasks.filter((t) => isBacklogStatus(t.status)) : tasks.filter((t) => t.status === col.status),
        ))}
      </div>
    );
  }

  // Блок «+ Подпроект» (кнопка + инлайн-инпут). Один и тот же у обычной секции (создать
  // ПЕРВЫЙ подпроект → секция становится группой) и у уже-группы — DRY, чтобы вход в
  // подпроекты был доступен всегда, а не только когда дети уже есть.
  function renderAddSubproject(secId: string) {
    if (addingSubOf === secId) {
      return (
        <div className="flex items-center gap-2 p-3 border-t border-line">
          <input autoFocus value={subName} onChange={(e) => setSubName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSubproject(secId); if (e.key === "Escape") { setAddingSubOf(null); setSubName(""); } }}
            placeholder={dt("Название подпроекта", "Subproject name")}
            className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary/50" />
          <Button size="sm" className="h-9 text-xs" onClick={() => submitSubproject(secId)}>{dt("Добавить", "Add")}</Button>
          <button onClick={() => { setAddingSubOf(null); setSubName(""); }} className="text-xs text-ink-soft px-2">{dt("Отмена", "Cancel")}</button>
        </div>
      );
    }
    return (
      <div className="border-t border-line p-2">
        <button onClick={() => setAddingSubOf(secId)} className="flex items-center gap-1.5 rounded-full bg-surface border border-dashed border-line-2 px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2">
          <RoyIcon name="plus" size={13} strokeWidth={2} /> {dt("Подпроект", "Subproject")}
        </button>
      </div>
    );
  }

  // Одна статус-колонка: заголовок + быстрый ввод + drop-зона + карточки. Клик по пустому полю
  // колонки создаёт карточку задачи В ЭТОЙ колонке (её статус). badgeFor — бейдж подпроекта.
  function renderStatusColumn(
    projectId: string,
    col: { status: string; label: string; bar: string },
    colTasks: Task[],
    badgeFor?: (t: Task) => string | undefined,
  ) {
    const adding = quickAdd?.section === projectId && quickAdd?.status === col.status;
    return (
      <div key={col.status}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (dragRef) { applyDrop(dragRef.id, projectId, col.status); setDrag(null); } }}
        className="w-64 shrink-0 flex flex-col rounded-xl bg-surface-2 border border-line p-2 dark:backdrop-blur-lg">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="size-2.5 rounded-full" style={{ background: col.bar }} />
          <span className="text-xs font-semibold text-ink">{col.label}</span>
          <span className="ml-auto text-xs text-ink-soft">{colTasks.length}</span>
        </div>
        {adding && (
          <input autoFocus value={quickAdd!.title}
            onChange={(e) => setQuickAdd({ section: projectId, status: col.status, title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") addTask(projectId, col.status, quickAdd!.title); if (e.key === "Escape") setQuickAdd(null); }}
            onBlur={() => addTask(projectId, col.status, quickAdd!.title)}
            placeholder="Новая задача, Enter"
            className="mx-1 mb-1 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary/50" />
        )}
        <div className="flex-1 overflow-y-auto space-y-2 pt-1 min-h-[56px] cursor-text"
          onClick={(e) => { if (e.target === e.currentTarget && !adding) setQuickAdd({ section: projectId, status: col.status, title: "" }); }}
          title="Кликни по пустому полю — добавить задачу">
          {colTasks.map((t) => {
            const badge = badgeFor?.(t);
            return (
              <div key={t.id} draggable
                onDragStart={(e) => { setDrag({ id: t.id }); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDrag(null)}
                onClick={(e) => { e.stopPropagation(); setEditing(t); }}
                className="rounded-lg bg-card border border-line shadow-sm p-2.5 cursor-pointer hover:border-primary/40 active:cursor-grabbing dark:backdrop-blur-sm">
                {badge && <span className="inline-block mb-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft bg-surface-2 border border-line">{badge}</span>}
                <p className="text-sm font-medium leading-snug text-ink">{t.title}</p>
                <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-soft">
                  {t.due_date && <span className="inline-flex items-center gap-1"><RoyIcon name="cal" size={11} /> {fmtDay(t.due_date)}</span>}
                  {t.assignees.length > 0 && <span className="ml-auto font-bold">{initials(t.assignees)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (loading) return <p className="text-center text-ink-soft py-12 text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок-h1 убран — таб навигации уже называется «Проекты» (дубль не нужен). */}
      {/* Вкладки (общие; создавать может любой). Дефолтной «Бэклог»-вкладки нет — без выбора видно всё;
          клик по активной вкладке снимает фильтр (снова все задачи). */}
      <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto shrink-0 items-center">
        {sprints.map((s) => {
          const active = selected === s.id;
          return (
            <button key={s.id} onClick={() => setSelected(active ? ALL : s.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm"}`}>
              {s.name}{s.status === "active" ? " ·" : ""}
            </button>
          );
        })}
        <button onClick={() => setCreating((v) => !v)} className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm shrink-0" title={dt("Новая вкладка", "New tab")}>
          <RoyIcon name="plus" size={14} strokeWidth={2} />
        </button>
        {selected !== ALL && (
          <button onClick={handleDeleteSprint} disabled={deletingSprint} title={dt("Удалить вкладку", "Delete tab")}
            className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 hover:text-destructive disabled:opacity-50 dark:backdrop-blur-sm shrink-0">
            <RoyIcon name="trash" size={14} />
          </button>
        )}
      </div>

      {creating && (
        <div className="mx-4 mb-2 p-3 rounded-lg border border-line space-y-2">
          <input autoFocus className="w-full text-sm bg-transparent border-b border-line py-1 outline-none"
            placeholder={dt("Название вкладки", "Tab name")} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") submitSprint(); if (e.key === "Escape") setCreating(false); }} />
          {formErr && <p className="text-xs text-destructive">{formErr}</p>}
          <Button size="sm" className="w-full h-8 text-xs" onClick={submitSprint} disabled={saving}>{saving ? "Создание…" : dt("Создать вкладку", "Create tab")}</Button>
        </div>
      )}

      {selected !== ALL && inScope.length > 0 && (
        <div className="px-5 pb-2">
          <div className="flex justify-between text-xs text-ink-soft mb-1"><span>Прогресс</span><span className="font-semibold">{doneCount}/{inScope.length}</span></div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / inScope.length) * 100}%`, background: "var(--status-done)" }} /></div>
        </div>
      )}

      {/* Доска проектов: свёрнутые проекты — плитки (flex-wrap, несколько в ряд); раскрытый проект
          занимает всю ширину (w-full → своя строка), остальные плитки съезжают ниже. */}
      <div className="flex-1 overflow-auto px-4 pb-4 flex flex-wrap gap-3 content-start">
        {boardEmpty && (
          <p className="w-full text-center text-sm text-ink-soft/70 py-10">
            {selected === ALL
              ? "Проектов пока нет. Выберите вкладку сверху (или создайте) и добавьте в неё проект."
              : "В этой вкладке проектов пока нет. Добавьте проект кнопкой ниже и накидывайте в него задачи."}
          </p>
        )}
        {topLevel.map((sec) => {
          const kids = childrenOf(sec.id);
          // Проект целиком принадлежит вкладке → берём ВСЕ его задачи по project_id (без фильтра по вкладке).
          const secDirectTasks = tasks.filter((t) => t.project_id === sec.id);
          const kidsWithTasks = kids.map((kid) => ({ kid, tasks: tasks.filter((t) => t.project_id === kid.id) }));
          const total = secDirectTasks.length + kidsWithTasks.reduce((sum, k) => sum + k.tasks.length, 0);
          const open = expanded.has(sec.id);

          // Свёрнутый проект — компактная ПЛИТКА-карточка. Одиночный клик открывает (раньше был
          // onDoubleClick — на тач-устройствах двойной тап ненадёжен и путает: стрелка-шеврон
          // визуально обещает «нажми», а срабатывало только с двух касаний).
          // Тоже drop-зона для переноса подпроекта (#30) — раскрывать цель не нужно.
          if (!open) {
            return (
              <button key={sec.id} type="button" onClick={() => toggleExpanded(sec.id)}
                onDragOver={(e) => { if (dragProj) { e.preventDefault(); setDragOverProject(sec.id); } }}
                onDragLeave={() => setDragOverProject((p) => (p === sec.id ? null : p))}
                onDrop={(e) => { if (dragProj) { e.preventDefault(); moveSubproject(dragProj, sec.id); setDragProj(null); setDragOverProject(null); } }}
                className={`roy-pop w-56 shrink-0 self-start rounded-2xl border p-3 text-left select-none cursor-pointer transition-colors dark:backdrop-blur-sm ${dragOverProject === sec.id ? "border-primary bg-primary/10" : "border-line bg-surface/40 hover:border-line-2"}`}
                title={dt("Открыть проект", "Open project")}>
                <div className="flex items-center gap-2">
                  <RoyIcon name="board" size={15} strokeWidth={1.9} />
                  <span className="flex-1 truncate text-sm font-bold text-ink">{sec.name}</span>
                  <RoyIcon name="cright" size={12} className="text-ink-soft" />
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                  <span>{total} {dt("задач", "tasks")}</span>
                  {kids.length > 0 && <span>· {kids.length} {dt("подпр.", "sub")}</span>}
                </div>
              </button>
            );
          }

          // Раскрытый проект — на всю ширину (w-full → своя строка в flex-wrap).
          return (
            <section key={sec.id} className="roy-pop w-full rounded-2xl border border-line bg-surface/40 dark:backdrop-blur-sm">
              {/* Заголовок раскрытого проекта. Двойной клик — свернуть обратно в плитку.
                  Тоже drop-зона для переноса подпроекта (#30). */}
              <div onDoubleClick={() => toggleExpanded(sec.id)}
                onDragOver={(e) => { if (dragProj) { e.preventDefault(); setDragOverProject(sec.id); } }}
                onDragLeave={() => setDragOverProject((p) => (p === sec.id ? null : p))}
                onDrop={(e) => { if (dragProj) { e.preventDefault(); moveSubproject(dragProj, sec.id); setDragProj(null); setDragOverProject(null); } }}
                className={`flex items-center gap-2 px-3 py-2 select-none cursor-pointer border-b ${dragOverProject === sec.id ? "border-primary bg-primary/10" : "border-line"}`}
                title={dt("Двойной клик — свернуть", "Double-click to collapse")}>
                <button onClick={(e) => { e.stopPropagation(); toggleExpanded(sec.id); }} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={open ? dt("Свернуть", "Collapse") : dt("Развернуть", "Expand")}>
                  <RoyIcon name="cright" size={12} style={{ transform: open ? "rotate(90deg)" : undefined }} />
                </button>
                <RoyIcon name="board" size={14} strokeWidth={1.9} />
                {renaming?.id === sec.id ? (
                  <input autoFocus value={renaming.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: sec.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") renameSection(sec.id, renaming.name); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={() => renameSection(sec.id, renaming.name)}
                    className="text-sm font-bold text-ink bg-card border border-line rounded px-2 py-0.5 outline-none focus:border-primary/50" />
                ) : (
                  <span className="text-sm font-bold text-ink">{sec.name}</span>
                )}
                <span className="text-xs text-ink-soft">{total}</span>
                <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                  {/* Прямая задача проекта/группы (project_id = sec.id) в бэклог — иначе у группы
                      с подпроектами и без прямых задач не было точки создания первой (issue #12). */}
                  <button onClick={() => { if (!open) toggleExpanded(sec.id); setQuickAdd({ section: sec.id, status: "backlog", title: "" }); }} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Добавить задачу в проект", "Add task to project")}>
                    <RoyIcon name="task" size={14} strokeWidth={1.9} />
                  </button>
                  <button onClick={() => { if (!open) toggleExpanded(sec.id); setAddingSubOf(sec.id); }} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Добавить подпроект", "Add subproject")}>
                    <RoyIcon name="plus" size={14} strokeWidth={2} />
                  </button>
                  <button onClick={() => setRenaming({ id: sec.id, name: sec.name })} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Переименовать проект", "Rename project")}>
                    <RoyIcon name="pencil" size={13} />
                  </button>
                  <button onClick={() => removeSection(sec.id, sec.name)} className="rounded-full p-1 text-ink-soft hover:bg-surface-2 hover:text-destructive" title={dt("Удалить проект", "Delete project")}>
                    <RoyIcon name="trash" size={13} />
                  </button>
                </div>
              </div>

              {open && (kids.length === 0 ? (
                <div>
                  {renderColumns(sec.id, secDirectTasks)}
                  {renderAddSubproject(sec.id)}
                </div>
              ) : (
                <div className="flex gap-3 p-3 overflow-x-auto">
                  {/* Общий бэклог проекта: backlog-задачи группы И подпроектов (с бейджем подпроекта). */}
                  {renderStatusColumn(
                    sec.id, COLUMNS[0],
                    [...secDirectTasks, ...kidsWithTasks.flatMap((k) => k.tasks)].filter((t) => isBacklogStatus(t.status)),
                    (t) => (t.project_id !== sec.id ? kids.find((k) => k.id === t.project_id)?.name : undefined),
                  )}
                  {/* Пространства подпроектов: у каждого только рабочие колонки. */}
                  <div className="flex-1 min-w-0 space-y-3">
                    {kidsWithTasks.map(({ kid, tasks: kidTasks }) => {
                      const subOpen = !collapsedSubs.has(kid.id);
                      return (
                      <div key={kid.id}>
                        {/* Заголовок подпроекта: draggable (перенос в другой проект, #30) +
                            сворачивание (#29, та же семантика, что у проекта верхнего уровня). */}
                        <div draggable={renaming?.id !== kid.id}
                          onDragStart={(e) => { setDragProj(kid.id); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setDragProj(null); setDragOverProject(null); }}
                          className="flex items-center gap-2 px-1 pb-1.5 cursor-grab active:cursor-grabbing">
                          <button onClick={() => toggleCollapsedSub(kid.id)} className="rounded-full p-0.5 text-ink-soft hover:bg-surface-2" title={subOpen ? dt("Свернуть", "Collapse") : dt("Развернуть", "Expand")}>
                            <RoyIcon name="cright" size={11} className="transition-transform duration-200" style={{ transform: subOpen ? "rotate(90deg)" : undefined }} />
                          </button>
                          {renaming?.id === kid.id ? (
                            <input autoFocus value={renaming.name}
                              onChange={(e) => setRenaming({ id: kid.id, name: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") renameSection(kid.id, renaming.name); if (e.key === "Escape") setRenaming(null); }}
                              onBlur={() => renameSection(kid.id, renaming.name)}
                              className="text-xs font-bold text-ink bg-card border border-line rounded px-2 py-0.5 outline-none focus:border-primary/50" />
                          ) : (
                            <span className="text-xs font-bold text-ink">{kid.name}</span>
                          )}
                          <span className="text-[11px] text-ink-soft">{kidTasks.filter((t) => !isBacklogStatus(t.status)).length}</span>
                          <div className="ml-auto flex items-center gap-0.5">
                            <button onClick={() => setRenaming({ id: kid.id, name: kid.name })} className="rounded-full p-1 text-ink-soft hover:bg-surface-2" title={dt("Переименовать", "Rename")}><RoyIcon name="pencil" size={12} /></button>
                            <button onClick={() => removeSection(kid.id, kid.name)} className="rounded-full p-1 text-ink-soft hover:bg-surface-2 hover:text-destructive" title={dt("Удалить", "Delete")}><RoyIcon name="trash" size={12} /></button>
                          </div>
                        </div>
                        {/* Плавное сворачивание: grid-template-rows 0fr↔1fr — анимируемая высота
                            без измерения scrollHeight, overflow-hidden клипует контент во время
                            перехода (иначе колонки на миг просвечивали бы поверх соседей). */}
                        <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: subOpen ? "1fr" : "0fr" }}>
                          <div className="overflow-hidden">
                            <div className="flex gap-3 overflow-x-auto">
                              {WORK_COLUMNS.map((col) => renderStatusColumn(kid.id, col, kidTasks.filter((t) => t.status === col.status)))}
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                    {renderAddSubproject(sec.id)}
                  </div>
                </div>
              ))}
            </section>
          );
        })}

        {/* Добавить проект — на своей строке (w-full в flex-wrap контейнере). Проект создаётся
            в ВЫБРАННОЙ вкладке; на ALL просим сначала выбрать вкладку сверху. */}
        <div className="w-full">
        {selected === ALL ? (
          <p className="text-xs text-ink-soft/70">{dt("Выберите вкладку сверху, чтобы создать в ней проект", "Pick a tab above to create a project in it")}</p>
        ) : addingSection ? (
          <div className="flex items-center gap-2 max-w-sm">
            <input autoFocus value={sectionName} onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSection(); if (e.key === "Escape") setAddingSection(false); }}
              placeholder="Название проекта (напр. «Vibe Coding»)"
              className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary/50" />
            <Button size="sm" className="h-9 text-xs" onClick={addSection}>Добавить</Button>
            <button onClick={() => setAddingSection(false)} className="text-xs text-ink-soft px-2">Отмена</button>
          </div>
        ) : (
          <button onClick={() => setAddingSection(true)} className="flex items-center gap-1.5 rounded-full bg-surface border border-dashed border-line-2 px-4 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-2">
            <RoyIcon name="plus" size={14} strokeWidth={2} /> Проект
          </button>
        )}
        </div>
      </div>

      {/* onSaved — ТОЛЬКО обновление списка, БЕЗ закрытия: автосейв дёргает onSaved на каждый тик,
          и setEditing(null) здесь схлопывал бы карточку прямо во время печати. Закрытие — через onClose
          (крестик) и внутри модалки после создания/удаления. */}
      <TaskModal task={editing ?? undefined} open={!!editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}
