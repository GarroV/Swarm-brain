"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptSprintCycle, addTasksToSprintCycle, createSprintCycle, createTask,
  deleteSprintCycle, fetchProjects, fetchSprintCycle, fetchSprintCycles, fetchTasks,
  removeTaskFromSprintCycle, startSprintCycle, updateTask,
} from "@/lib/api";
import type { Project, SprintCycle, SprintCycleDetail, SprintCycleItem, Task } from "@/types";
import { KanbanColumn } from "@/components/tasks/TaskKanban";
import type { KanbanDrag, KanbanHandlers, KanbanQuickAdd } from "@/components/tasks/TaskKanban";
import { SprintTaskPool } from "@/components/tasks/SprintTaskPool";
import { TaskModal } from "@/components/TaskModal";
import { Button } from "@/components/ui/button";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";
import { buildQuickAddInput } from "@/lib/quickAddTask";
import { useDt, useRoyNav } from "@/components/roy/nav";

// Экран «Спринты» — период работы команды с датами, планом и приёмкой (issue #267).
// ⚠️ Не путать с доской «Проекты» (SprintBoard.tsx): там таблица `sprints` = ВКЛАДКИ доски,
// имя историческое. Спринты живут в `sprint_cycles` и ходят через /sprint-cycles.
//
// Канбан — общий (TaskKanban.tsx), но колонок три: «Бэклога» в спринте нет, его роль играет
// пул слева. Карточки внутри колонки сгруппированы заголовками проектов — это группировка,
// а не копии проектов (в отличие от доски, где у каждого проекта своя полоса колонок).

const SPRINT_SECTION = "__sprint__";  // канбан спринта — одна секция, drop меняет только статус
const CLOSED = new Set(["done", "cancelled"]);
const DEFAULT_LENGTH_DAYS = 13;       // двухнедельный спринт: старт + 13 = ровно 14 дней

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDay(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function fmtRange(from: string, to: string): string {
  return `${fmtDay(from)} — ${fmtDay(to)}`;
}

/** Осталось дней до конца спринта; отрицательное — просрочен. */
function daysLeft(endDate: string): number {
  const end = new Date(`${endDate}T23:59:59`);
  return Math.ceil((end.getTime() - Date.now()) / 86_400_000);
}

/**
 * Карточка принятого спринта — из клона (`frozen_*`), живой задачи за ней может уже не быть.
 * Канбан рисует `Task`, поэтому собираем задачу-пустышку: она только для чтения (readOnly),
 * ни перетащить, ни открыть её нельзя.
 */
function frozenCard(item: SprintCycleItem): Task {
  return {
    id: item.id, title: item.title, description: null,
    assignees: item.assignees, assignee_telegram_ids: [],
    due_date: null, remind_date: null, reminded_at: null,
    tags: [], country: null, task_role: null, priority: null, source: "sprint_archive",
    status: item.status, created_at: item.added_at, updated_at: null, meeting_id: null,
    url: null, group_id: null, created_by_name: null, is_private: false, owner_id: null,
    start_date: null, timeline_position: null, sprint_id: null, label_ids: [],
    project_id: item.project_id, project_linked: false, parent_id: null, tree_x: null, tree_y: null,
    recur_freq: null, recur_anchor_dom: null,
  };
}

export function SprintsScreen() {
  const dt = useDt();
  const confirm = useConfirm();
  const { me } = useRoyNav();
  const isAdmin = me?.is_admin ?? false;

  const [cycles, setCycles] = useState<SprintCycle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SprintCycleDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const [editing, setEditing] = useState<Task | null>(null);
  const [drag, setDrag] = useState<KanbanDrag>(null);
  const [quickAdd, setQuickAdd] = useState<KanbanQuickAdd>(null);

  const COLUMNS = useMemo(() => [
    { status: "open", label: dt("Открыто", "Open"), bar: "#8C8475" },
    { status: "in_progress", label: dt("В работе", "In progress"), bar: "var(--status-prog)" },
    { status: "done", label: dt("Готово", "Done"), bar: "var(--status-done)" },
  ], [dt]);

  const load = useCallback(async () => {
    try {
      const [c, t, p] = await Promise.all([fetchSprintCycles(), fetchTasks(), fetchProjects()]);
      setCycles(c); setTasks(t); setProjects(p); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось загрузить спринты", "Failed to load sprints"));
    } finally {
      setLoading(false);
    }
  }, [dt]);

  useEffect(() => { load(); }, [load]);

  // Автовыбор: активный спринт, иначе ближайший черновик, иначе последний по дате.
  useEffect(() => {
    if (selectedId || cycles.length === 0) return;
    const pick = cycles.find((c) => c.status === "active")
      ?? [...cycles].reverse().find((c) => c.status === "draft")
      ?? cycles[0];
    setSelectedId(pick.id);
  }, [cycles, selectedId]);

  const reloadDetail = useCallback(async (id: string | null) => {
    if (!id) { setDetail(null); return; }
    try { setDetail(await fetchSprintCycle(id)); } catch { setDetail(null); }
  }, []);

  useEffect(() => { reloadDetail(selectedId); }, [selectedId, reloadDetail]);

  const accepted = detail?.status === "accepted";
  const items = detail?.items ?? [];
  const inSprint = useMemo(() => new Set(items.map((i) => i.task_id).filter(Boolean) as string[]), [items]);

  // Карточки канбана: у живого спринта — те же строки, что на доске проектов (одна задача,
  // одна правда), у принятого — клон из архива.
  const { cards, groupLabels } = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const labels = new Map<string, string | null>();
    const out: Task[] = [];
    for (const it of items) {
      const live = it.frozen || !it.task_id ? undefined : byId.get(it.task_id);
      const card = live ?? frozenCard(it);
      out.push(card);
      labels.set(card.id, it.project ?? (live ? projects.find((p) => p.id === live.project_id)?.name ?? null : null));
    }
    return { cards: out, groupLabels: labels };
  }, [items, tasks, projects]);

  // Пул слева: не взятые в спринт и не закрытые. Закрытую задачу в спринт добавлять смысла нет —
  // она бы сразу легла в «Готово» и накрутила процент выполнения задним числом.
  const poolTasks = useMemo(
    () => tasks.filter((t) => !inSprint.has(t.id) && !CLOSED.has(t.status)),
    [tasks, inSprint],
  );

  const plan = items.filter((i) => i.in_plan);
  const planDone = plan.filter((i) => CLOSED.has(i.status)).length;
  const doneTotal = items.filter((i) => CLOSED.has(i.status)).length;
  const percent = detail?.stats?.planPercent ?? (plan.length === 0 ? 0 : Math.round((planDone / plan.length) * 100));

  async function applyDrop(taskId: string, _section: string, status: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try { await updateTask(taskId, { status }); } catch { load(); }
    reloadDetail(selectedId);
  }

  // «+» в колонке: задача создаётся и сразу попадает в спринт — иначе кнопка обещала бы
  // добавление в спринт, а задача оказывалась бы только в общем списке.
  async function addTaskToColumn(_section: string, status: string, title: string) {
    setQuickAdd(null);
    const input = buildQuickAddInput(title, me, { status });
    if (!input || !detail) return;
    try {
      const created = await createTask(input);
      setTasks((prev) => [created, ...prev]);
      await addTasksToSprintCycle(detail.id, [created.id]);
      await reloadDetail(detail.id);
    } catch { load(); }
  }

  async function addToSprint(taskIds: string[]) {
    if (!detail) return;
    setBusy(true);
    try {
      const added = await addTasksToSprintCycle(detail.id, taskIds);
      // Сервер молча отсекает приватные и уже добавленные — говорим правду, если взял не всё.
      if (added < taskIds.length) {
        setErr(dt(
          `Добавлено ${added} из ${taskIds.length}: приватные задачи в спринт не берутся`,
          `Added ${added} of ${taskIds.length}: private tasks are not taken into a sprint`,
        ));
      } else setErr(null);
      await Promise.all([load(), reloadDetail(detail.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось добавить", "Failed to add"));
    } finally { setBusy(false); }
  }

  async function removeFromSprint(task: Task) {
    if (!detail) return;
    try {
      await removeTaskFromSprintCycle(detail.id, task.id);
      await reloadDetail(detail.id);
    } catch { load(); }
  }

  async function submitCycle() {
    const name = form.name.trim();
    if (!name) { setErr(dt("Введите название спринта", "Enter a sprint name")); return; }
    setBusy(true);
    try {
      const created = await createSprintCycle({ name, start_date: form.start_date, end_date: form.end_date });
      setCreating(false); setErr(null);
      await load();
      setSelectedId(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось создать спринт", "Failed to create the sprint"));
    } finally { setBusy(false); }
  }

  async function start() {
    if (!detail) return;
    if (!(await confirm({
      title: dt(`Начать «${detail.name}»?`, `Start “${detail.name}”?`),
      description: dt(
        `Состав спринта (${items.length}) станет планом, от которого считается процент. Добавленное позже пойдёт «сверх плана».`,
        `The current ${items.length} task(s) become the plan the percentage is measured against. Anything added later counts as extra.`,
      ),
      confirmText: dt("Начать спринт", "Start sprint"),
    }))) return;
    setBusy(true);
    try { await startSprintCycle(detail.id); await Promise.all([load(), reloadDetail(detail.id)]); }
    catch (e) { setErr(e instanceof Error ? e.message : dt("Не удалось начать", "Failed to start")); }
    finally { setBusy(false); }
  }

  // Куда уедут незакрытые: ближайший черновик после этого спринта, иначе любой черновик.
  const carryTarget = useMemo(() => {
    if (!detail) return null;
    const drafts = cycles.filter((c) => c.status === "draft" && c.id !== detail.id);
    return drafts.filter((c) => c.start_date >= detail.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
      ?? drafts[0] ?? null;
  }, [cycles, detail]);

  async function accept() {
    if (!detail) return;
    const open = items.filter((i) => !CLOSED.has(i.status)).length;
    const carry = carryTarget
      ? dt(`Незакрытые (${open}) уедут в «${carryTarget.name}».`, `${open} unfinished task(s) will move to “${carryTarget.name}”.`)
      : dt(`Незакрытых ${open} — переносить некуда, черновика следующего спринта нет.`, `${open} unfinished — nowhere to move them, there is no next draft sprint.`);
    if (!(await confirm({
      title: dt(`Принять «${detail.name}»?`, `Accept “${detail.name}”?`),
      description: dt(
        `Состав замрёт слепком на момент приёмки, итоги посчитаются один раз. ${carry} Отменить приёмку нельзя.`,
        `The composition freezes as a snapshot and the results are computed once. ${carry} Accepting cannot be undone.`,
      ),
      confirmText: dt("Принять спринт", "Accept sprint"),
    }))) return;
    setBusy(true);
    try {
      await acceptSprintCycle(detail.id, { next_cycle_id: carryTarget?.id ?? null });
      await Promise.all([load(), reloadDetail(detail.id)]);
    } catch (e) { setErr(e instanceof Error ? e.message : dt("Не удалось принять", "Failed to accept")); }
    finally { setBusy(false); }
  }

  async function removeCycle() {
    if (!detail) return;
    if (!(await confirm({
      title: dt(`Удалить «${detail.name}»?`, `Delete “${detail.name}”?`),
      description: dt("Задачи не удалятся — они просто выйдут из спринта.", "Tasks are not deleted — they just leave the sprint."),
      confirmText: dt("Удалить спринт", "Delete sprint"),
    }))) return;
    setBusy(true);
    try { await deleteSprintCycle(detail.id); setSelectedId(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : dt("Не удалось удалить", "Failed to delete")); }
    finally { setBusy(false); }
  }

  const kanban: KanbanHandlers = {
    drag, onDragChange: setDrag, onDropTask: applyDrop,
    quickAdd, onQuickAddChange: setQuickAdd, onQuickAddSubmit: addTaskToColumn,
    onOpenTask: (t) => setEditing(t),
  };

  const live = cycles.filter((c) => c.status !== "accepted");
  const archive = cycles.filter((c) => c.status === "accepted");

  if (loading) return <p className="text-center text-ink-soft py-12 text-sm">{dt("Загрузка…", "Loading…")}</p>;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Селектор: живые спринты чипами, принятые — архивом (их со временем станет много) */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 overflow-x-auto shrink-0">
        {live.map((c) => {
          const active = selectedId === c.id;
          return (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm"}`}>
              {c.name}{c.status === "active" ? " ·" : ""}
            </button>
          );
        })}
        {archive.length > 0 && (
          <select value={archive.some((c) => c.id === selectedId) ? selectedId ?? "" : ""}
            onChange={(e) => e.target.value && setSelectedId(e.target.value)}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-soft outline-none dark:backdrop-blur-sm">
            <option value="">{dt("Архив", "Archive")}</option>
            {[...new Set(archive.map((c) => c.start_date.slice(0, 4)))].sort().reverse().map((year) => (
              <optgroup key={year} label={year}>
                {archive.filter((c) => c.start_date.startsWith(year)).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {fmtRange(c.start_date, c.end_date)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {isAdmin && (
          <button onClick={() => {
            const today = new Date();
            const end = new Date(); end.setDate(end.getDate() + DEFAULT_LENGTH_DAYS);
            setForm({ name: "", start_date: iso(today), end_date: iso(end) });
            setCreating((v) => !v);
          }}
            className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm shrink-0"
            title={dt("Новый спринт", "New sprint")}>
            <RoyIcon name="plus" size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {creating && (
        <div className="mx-4 mb-2 flex flex-wrap items-center gap-2">
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") submitCycle(); if (e.key === "Escape") setCreating(false); }}
            placeholder={dt("Название спринта", "Sprint name")}
            className="w-44 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary/50" />
          <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink outline-none focus:border-primary/50" />
          <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink outline-none focus:border-primary/50" />
          <Button size="sm" className="h-9 text-xs" onClick={submitCycle} disabled={busy}>
            {busy ? dt("Создание…", "Creating…") : dt("Создать", "Create")}
          </Button>
          <button onClick={() => setCreating(false)} className="text-xs text-ink-soft px-2">{dt("Отмена", "Cancel")}</button>
        </div>
      )}

      {err && (
        <p className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{err}</p>
      )}

      {!detail ? (
        <p className="px-4 py-10 text-center text-sm text-ink-soft/70">
          {cycles.length === 0
            ? (isAdmin
              ? dt("Спринтов пока нет. Создайте первый кнопкой «+» сверху.", "No sprints yet. Create the first one with “+” above.")
              : dt("Спринтов пока нет — их создаёт админ.", "No sprints yet — an admin creates them."))
            : dt("Выберите спринт сверху.", "Pick a sprint above.")}
        </p>
      ) : (
        <>
          {/* Шапка: даты, состояние, прогресс, действие по состоянию */}
          <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-line bg-surface/40 px-3 py-2 dark:backdrop-blur-sm">
            <span className="text-sm font-bold text-ink">{detail.name}</span>
            <span className="text-xs text-ink-soft">{fmtRange(detail.start_date, detail.end_date)}</span>
            {detail.status === "active" && (
              <span className={`text-xs ${daysLeft(detail.end_date) < 0 ? "text-destructive" : "text-ink-soft"}`}>
                {daysLeft(detail.end_date) < 0
                  ? dt(`просрочен на ${-daysLeft(detail.end_date)} дн.`, `${-daysLeft(detail.end_date)} day(s) overdue`)
                  : dt(`осталось ${daysLeft(detail.end_date)} дн.`, `${daysLeft(detail.end_date)} day(s) left`)}
              </span>
            )}
            {accepted && (
              <span className="rounded-full bg-surface-2 border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                {dt("принят", "accepted")} {detail.accepted_at ? fmtDay(detail.accepted_at) : ""}
              </span>
            )}

            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-xs text-ink-soft">
                {plan.length > 0
                  ? dt(`план ${planDone}/${plan.length} · ${percent}%`, `plan ${planDone}/${plan.length} · ${percent}%`)
                  : dt(`закрыто ${doneTotal}/${items.length}`, `done ${doneTotal}/${items.length}`)}
              </span>
              {items.length > plan.length && plan.length > 0 && (
                <span className="text-xs text-ink-soft">
                  {dt(`сверх плана ${items.length - plan.length}`, `extra ${items.length - plan.length}`)}
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {isAdmin && detail.status === "draft" && (
                <Button size="sm" className="h-9 text-xs" onClick={start} disabled={busy}>{dt("Начать спринт", "Start sprint")}</Button>
              )}
              {isAdmin && detail.status === "active" && (
                <Button size="sm" className="h-9 text-xs" onClick={accept} disabled={busy}>{dt("Принять спринт", "Accept sprint")}</Button>
              )}
              {accepted && (
                // Отчёт принятого спринта — этап 4; пока честная подпись вместо кнопки в никуда.
                <span className="text-xs text-ink-soft/70">{dt("Отчёт — в работе", "Report — coming soon")}</span>
              )}
              {isAdmin && !accepted && (
                <button onClick={removeCycle} disabled={busy} title={dt("Удалить спринт", "Delete sprint")}
                  className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 hover:text-destructive disabled:opacity-50 dark:backdrop-blur-sm">
                  <RoyIcon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>

          {accepted && detail.summary && (
            <p className="mx-4 mb-2 text-xs text-ink-soft">{detail.summary}</p>
          )}

          <div className="flex-1 min-h-0 flex gap-3 px-4 pb-4">
            {!accepted && (
              <SprintTaskPool tasks={poolTasks} projects={projects} adding={busy} onAdd={addToSprint} />
            )}
            <div className="flex-1 min-w-0 flex gap-3 overflow-x-auto">
              {items.length === 0 ? (
                <p className="py-10 text-sm text-ink-soft/70">
                  {dt("В спринте пока нет задач — наберите их из пула слева.", "The sprint is empty — pick tasks from the pool on the left.")}
                </p>
              ) : COLUMNS.map((col) => (
                <KanbanColumn key={col.status} sectionId={SPRINT_SECTION} column={col}
                  tasks={cards.filter((t) => (col.status === "done" ? CLOSED.has(t.status) : t.status === col.status))}
                  groupOf={(t) => groupLabels.get(t.id) ?? null}
                  readOnly={accepted}
                  onRemoveCard={accepted ? undefined : removeFromSprint}
                  removeTitle={dt("Убрать из спринта", "Remove from sprint")}
                  kanban={kanban} />
              ))}
            </div>
          </div>
        </>
      )}

      <TaskModal task={editing ?? undefined} open={!!editing} onClose={() => setEditing(null)}
        onSaved={() => { load(); reloadDetail(selectedId); }} />
    </div>
  );
}
