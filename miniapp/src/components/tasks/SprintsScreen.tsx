"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptSprintCycle, addTasksToSprintCycle, createSprintCycle, createTask,
  deleteSprintCycle, fetchProjects, fetchSprintCycle, fetchSprintCycles, fetchSprints,
  fetchTasks, fetchUsers, removeTaskFromSprintCycle, startSprintCycle, updateTask,
} from "@/lib/api";
import type { Project, Sprint, SprintCycle, SprintCycleDetail, SprintCycleItem, Task, User } from "@/types";
import { buildBoard, sprintKpi } from "@/lib/initiatives";
import { KanbanColumn } from "@/components/tasks/TaskKanban";
import type { KanbanDrag, KanbanHandlers, KanbanQuickAdd } from "@/components/tasks/TaskKanban";
import { SprintTaskPool } from "@/components/tasks/SprintTaskPool";
import { SprintReport } from "@/components/tasks/SprintReport";
import { TaskModal } from "@/components/TaskModal";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";
import { buildQuickAddInput } from "@/lib/quickAddTask";
import { poolCandidates, projectLabel } from "@/lib/sprintPool";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { BoardSkeleton, InitiativeList } from "@/components/tasks/sprints/InitiativeList";
import { SpaceSwitcher } from "@/components/tasks/sprints/SpaceSwitcher";
import { SprintKpiHeader } from "@/components/tasks/sprints/SprintKpiHeader";
import { useSprintView, ViewToggle } from "@/components/tasks/sprints/ViewToggle";
import { daysLeft, fmtDay, fmtRange } from "@/components/tasks/sprints/format";

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
const ARCHIVE_NONE = "__archive__";   // «архив не выбран»: у ui/select пустая строка не значение

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Имя по умолчанию — «Спринт 10.09 — 23.09»: так их называют в переписке. */
function defaultCycleName(from: Date, to: Date): string {
  const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `Спринт ${dm(from)} — ${dm(to)}`;
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

  const isDesktop = useIsDesktop();
  const [view, setView] = useSprintView();

  const [cycles, setCycles] = useState<SprintCycle[]>([]);
  const [spaces, setSpaces] = useState<Sprint[]>([]);
  const [space, setSpace] = useState<string | null>(null);
  const [spacePicked, setSpacePicked] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
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
  const [reportOpen, setReportOpen] = useState(true);
  const [quickAdd, setQuickAdd] = useState<KanbanQuickAdd>(null);

  const COLUMNS = useMemo(() => [
    { status: "open", label: dt("Открыто", "Open"), bar: "#8C8475" },
    { status: "in_progress", label: dt("В работе", "In progress"), bar: "var(--status-prog)" },
    { status: "done", label: dt("Готово", "Done"), bar: "var(--status-done)" },
  ], [dt]);

  const load = useCallback(async () => {
    try {
      const [c, t, p, sp, u] = await Promise.all([
        fetchSprintCycles(), fetchTasks(), fetchProjects(), fetchSprints(), fetchUsers(),
      ]);
      setCycles(c); setTasks(t); setProjects(p); setSpaces(sp); setUsers(u); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось загрузить спринты", "Failed to load sprints"));
    } finally {
      setLoading(false);
    }
  }, [dt]);

  useEffect(() => { load(); }, [load]);

  // Пространство выбирается один раз за заход: там, где идёт живой спринт, иначе первое.
  // `spacePicked` нужен, чтобы не переставлять выбор человека на каждой перезагрузке данных —
  // иначе переключился на соседнее пространство, сохранил задачу, и тебя вернуло обратно.
  useEffect(() => {
    if (spacePicked || cycles.length === 0) return;
    const live = cycles.find((c) => c.status === "active") ?? cycles[0];
    setSpace(live.tab_id);
    setSpacePicked(true);
  }, [cycles, spacePicked]);

  // Спринты пространства: у каждого пространства своя череда, чужие тут не показываются.
  const spaceCycles = useMemo(() => cycles.filter((c) => c.tab_id === space), [cycles, space]);

  // Автовыбор внутри пространства: активный спринт, иначе ближайший черновик, иначе последний.
  useEffect(() => {
    if (spaceCycles.some((c) => c.id === selectedId)) return;
    const pick = spaceCycles.find((c) => c.status === "active")
      ?? [...spaceCycles].reverse().find((c) => c.status === "draft")
      ?? spaceCycles[0];
    setSelectedId(pick?.id ?? null);
  }, [spaceCycles, selectedId]);

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
      const liveProject = live ? projects.find((p) => p.id === live.project_id) : undefined;
      // Полная подпись «Группа › Подпроект»: у подпроектов бывают тёзки, а по голому имени
      // не видно, к какой группе относится полоса (в пуле подпись такая же).
      labels.set(card.id, it.project ?? (liveProject ? projectLabel(liveProject, projects) : null));
    }
    return { cards: out, groupLabels: labels };
  }, [items, tasks, projects]);

  // Пул слева. Правило отбора — `poolCandidates` в lib/sprintPool.ts (под тестами): не взятые
  // в спринт, не закрытые, не приватные.
  const poolTasks = useMemo(() => poolCandidates(tasks, inSprint), [tasks, inSprint]);

  const plan = items.filter((i) => i.in_plan);
  // Цифры шапки и дерево доски считает lib/initiatives — то же правило, что у серверных
  // итогов. Считать их здесь значило бы завести второй ответ на вопрос «сколько сделано».
  const kpi = useMemo(() => sprintKpi(items), [items]);
  const board = useMemo(() => buildBoard(items, projects), [items, projects]);
  // «Не отмечено» показываем с дня сверки (D013): до него молчание — норма, а не сигнал.
  const unchecked = !!detail?.check_date && daysLeft(detail.check_date) <= 0;

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
      // Спринт заводится В ПРОСТРАНСТВЕ, которое сейчас открыто: спринт без вкладки не
      // виден нигде, кроме «Без пространства», и на второй день его ищут всей командой.
      const created = await createSprintCycle({
        name, start_date: form.start_date, end_date: form.end_date, tab_id: space,
      });
      setCreating(false); setErr(null);
      await load();
      setSelectedId(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось создать спринт", "Failed to create the sprint"));
    } finally { setBusy(false); }
  }

  async function start() {
    if (!detail) return;
    // Старт с пустым составом фиксирует ПУСТОЙ план: процент считать будет не от чего, и всё
    // набранное потом пойдёт «сверх плана». Владелец наступил на это на первом же спринте
    // (09.09.2026: «тестовый» уехал в active с нулём задач), поэтому предупреждение явное.
    if (!(await confirm({
      title: dt(`Начать «${detail.name}»?`, `Start “${detail.name}”?`),
      description: items.length === 0
        ? dt(
          "Состав пуст — план будет пустым: процент выполнения считать будет не от чего, а всё набранное после старта пойдёт «сверх плана». Обычно сначала набирают задачи, потом стартуют.",
          "The sprint is empty, so the plan will be empty too: there is nothing to measure the percentage against, and everything added after the start counts as extra. Usually you pick the tasks first and start afterwards.",
        )
        : dt(
          `Состав спринта (${items.length}) станет планом, от которого считается процент. Добавленное позже пойдёт «сверх плана».`,
          `The current ${items.length} task(s) become the plan the percentage is measured against. Anything added later counts as extra.`,
        ),
      confirmText: items.length === 0
        ? dt("Всё равно начать", "Start anyway")
        : dt("Начать спринт", "Start sprint"),
    }))) return;
    setBusy(true);
    try { await startSprintCycle(detail.id); await Promise.all([load(), reloadDetail(detail.id)]); }
    catch (e) { setErr(e instanceof Error ? e.message : dt("Не удалось начать", "Failed to start")); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!detail) return;
    // Следующий спринт создаёт сама приёмка — одной транзакцией с переносом хвостов. Искать,
    // «куда бы переложить», больше не нужно: раньше без готового черновика работа просто
    // оставалась в принятом спринте и пропадала из виду.
    const open = items.filter((i) => !CLOSED.has(i.status)).length;
    if (!(await confirm({
      title: dt(`Принять «${detail.name}»?`, `Accept “${detail.name}”?`),
      description: dt(
        `Состав замрёт слепком на момент приёмки, итоги посчитаются один раз. Незакрытые (${open}) уедут в следующий спринт — он создастся сам, встык. Отменить приёмку нельзя.`,
        `The composition freezes as a snapshot and the results are computed once. ${open} unfinished task(s) move to the next sprint, which is created automatically right after this one. Accepting cannot be undone.`,
      ),
      confirmText: dt("Принять спринт", "Accept sprint"),
    }))) return;
    setBusy(true);
    try {
      await acceptSprintCycle(detail.id);
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

  // Канбан — только на компьютере (D003), поэтому на телефоне список показывается всегда,
  // независимо от запомненного вида.
  const showList = view === "list" || !isDesktop;

  /* Пустой спринт объясняет ровно следующее действие: «наберите из пула» не говорит, ЧЕМ
     набирают, и человек упирается в экран (владелец 09.09.2026). */
  const emptyComposition = (
    <div className="py-10 text-sm text-ink-soft/80 space-y-1.5">
      <p className="font-semibold text-ink">{dt("В спринте пока нет задач", "The sprint is empty")}</p>
      {isDesktop ? (
        <>
          <p>{dt("1. Слева отметьте задачи галочками — сверху появится «Добавить в спринт».",
                 "1. Tick the tasks on the left — an “Add to sprint” button appears above the list.")}</p>
          <p>{dt("2. Одну задачу быстрее добавить кнопкой «+» в её строке.",
                 "2. A single task is faster to add with the “+” on its row.")}</p>
        </>
      ) : (
        <p>{dt("Состав спринта набирают с компьютера — на телефоне спринт только смотрят и отмечают.",
               "A sprint is filled from a computer — on a phone you read it and mark progress.")}</p>
      )}
    </div>
  );

  const live = spaceCycles.filter((c) => c.status !== "accepted");
  const archive = spaceCycles.filter((c) => c.status === "accepted");
  // «Без пространства» показываем только если такие спринты есть: пустая вкладка-обрубок
  // на доске, где все спринты разложены, — лишний вопрос «а что там».
  const hasOrphans = cycles.some((c) => c.tab_id === null);

  // Пустой экран и «ещё не загрузилось» обязаны выглядеть по-разному, иначе человек
  // читает медленную сеть как «задач нет» и заводит их заново.
  if (loading) return <div className="px-4 py-6"><BoardSkeleton /></div>;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Пространство — первый вопрос («какой проект»), спринт — второй. */}
      <SpaceSwitcher spaces={spaces} value={space} showOrphans={hasOrphans}
        counts={new Map(
          [...spaces.map((s) => [s.id as string | null, cycles.filter((c) => c.tab_id === s.id).length] as const),
            [null, cycles.filter((c) => c.tab_id === null).length] as const],
        )}
        onChange={(id) => { setSpace(id); setSpacePicked(true); setSelectedId(null); }} />

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
          /* Архив принятых спринтов, сгруппированный по годам. Общий ui/select, не нативный:
             системное меню macOS выглядит чужеродно поверх интерфейса (владелец 09.09.2026). */
          <Select value={archive.some((c) => c.id === selectedId) ? selectedId ?? ARCHIVE_NONE : ARCHIVE_NONE}
            onValueChange={(v) => { const id = String(v); if (id !== ARCHIVE_NONE) setSelectedId(id); }}>
            <SelectTrigger size="sm" aria-label={dt("Архив спринтов", "Sprint archive")}
              className="h-7 shrink-0 rounded-full border-line bg-surface px-2.5 text-xs font-semibold text-ink-soft dark:bg-surface dark:backdrop-blur-sm">
              <SelectValue>
                {(v) => archive.find((c) => c.id === String(v))?.name ?? dt("Архив", "Archive")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ARCHIVE_NONE}>{dt("Архив", "Archive")}</SelectItem>
              {[...new Set(archive.map((c) => c.start_date.slice(0, 4)))].sort().reverse().map((year) => (
                <SelectGroup key={year}>
                  <SelectLabel>{year}</SelectLabel>
                  {archive.filter((c) => c.start_date.startsWith(year)).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} · {fmtRange(c.start_date, c.end_date)}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}
        {(
          <button onClick={() => {
            const today = new Date();
            const end = new Date(); end.setDate(end.getDate() + DEFAULT_LENGTH_DAYS);
            // Имя предзаполнено датами: пустое поле упиралось в ошибку «введите название»
            // на первом же клике, а имя по датам — то, как спринты и называют.
            setForm({ name: defaultCycleName(today, end), start_date: iso(today), end_date: iso(end) });
            setCreating((v) => !v);
          }}
            className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm shrink-0"
            title={dt("Новый спринт", "New sprint")}>
            <RoyIcon name="plus" size={14} strokeWidth={2} />
          </button>
        )}

        {/* Вид запоминается у человека; канбан — только на компьютере (D003). */}
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={isDesktop ? view : "list"} onChange={setView} kanbanDisabled={!isDesktop} />
        </div>
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
          {spaceCycles.length === 0
            ? dt(
              "В этом пространстве спринтов пока нет. Создайте первый кнопкой «+» сверху — это может любой участник.",
              "No sprints in this space yet. Create the first one with “+” above — any participant can.",
            )
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

            <SprintKpiHeader kpi={kpi} showUnchecked={unchecked} />
            {plan.length > 0 && items.length > plan.length && (
              <span className="text-xs text-ink-soft">
                {dt(`сверх плана ${items.length - plan.length}`, `extra ${items.length - plan.length}`)}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {detail.status === "draft" && (
                <Button size="sm" className="h-9 text-xs" onClick={start} disabled={busy}>{dt("Начать спринт", "Start sprint")}</Button>
              )}
              {detail.status === "active" && (
                <Button size="sm" className="h-9 text-xs" onClick={accept} disabled={busy}>{dt("Принять спринт", "Accept sprint")}</Button>
              )}
              {accepted && (
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => setReportOpen((v) => !v)}>
                  {reportOpen ? dt("Скрыть отчёт", "Hide report") : dt("Открыть отчёт", "Open report")}
                </Button>
              )}
              {isAdmin && !accepted && (
                <button onClick={removeCycle} disabled={busy} title={dt("Удалить спринт", "Delete sprint")}
                  className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 hover:text-destructive disabled:opacity-50 dark:backdrop-blur-sm">
                  <RoyIcon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>

          {accepted && (
            <p className="mx-4 mb-2 text-xs text-ink-soft/70">
              {dt(
                `Архив: карточки — слепок на момент приёмки ${detail.accepted_at ? fmtDay(detail.accepted_at) : ""}, изменить их нельзя.`,
                `Archive: cards are a snapshot taken at acceptance${detail.accepted_at ? ` on ${fmtDay(detail.accepted_at)}` : ""} and cannot be changed.`,
              )}
            </p>
          )}

          <div className="flex-1 min-h-0 flex gap-3 px-4 pb-4">
            {/* Пул — способ набрать состав, поэтому он нужен обоим видам; на телефоне его
                нет (D003): выбор галочками в узкой колонке нечитаем. */}
            {accepted
              ? (reportOpen && <SprintReport cycle={detail} />)
              : isDesktop && <SprintTaskPool tasks={poolTasks} projects={projects} adding={busy} onAdd={addToSprint} />}
            {showList ? (
              <div className="flex-1 min-w-0 overflow-y-auto">
                {items.length === 0 ? emptyComposition : (
                  <InitiativeList board={board} unchecked={unchecked} users={users}
                    onOpen={(item) => {
                      // Открываем ЖИВУЮ задачу: строка спринта — это её отражение, и править
                      // надо задачу. У упоминания и приватной чужой открывать нечего — такие
                      // строки список кликабельными и не делает.
                      const live = item.task_id ? tasks.find((t) => t.id === item.task_id) : undefined;
                      if (live) setEditing(live);
                    }} />
                )}
              </div>
            ) : (
            <div className="flex-1 min-w-0 flex gap-3 overflow-x-auto">
              {items.length === 0 ? emptyComposition : COLUMNS.map((col) => (
                <KanbanColumn key={col.status} sectionId={SPRINT_SECTION} column={col}
                  tasks={cards.filter((t) => (col.status === "done" ? CLOSED.has(t.status) : t.status === col.status))}
                  groupOf={(t) => groupLabels.get(t.id) ?? null}
                  readOnly={accepted}
                  onRemoveCard={accepted ? undefined : removeFromSprint}
                  removeTitle={dt("Убрать из спринта", "Remove from sprint")}
                  kanban={kanban} />
              ))}
            </div>
            )}
          </div>
        </>
      )}

      <TaskModal task={editing ?? undefined} open={!!editing} onClose={() => setEditing(null)}
        onSaved={() => { load(); reloadDetail(selectedId); }} />
    </div>
  );
}
