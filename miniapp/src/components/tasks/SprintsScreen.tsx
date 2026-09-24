"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptSprintCycle,
  addTasksToSprintCycle,
  createSprintCycle,
  createTask,
  deleteSprintCycle,
  fetchProjects,
  fetchSprintCycle,
  fetchSprintCycles,
  fetchSprints,
  fetchTasks,
  fetchUsers,
  patchSprintCycleItem,
  removeTaskFromSprintCycle,
  startSprintCycle,
  updateProject,
  updateSprintCycle,
  updateTask,
} from "@/lib/api";
import type {
  Project,
  Sprint,
  SprintCycle,
  SprintCycleDetail,
  SprintCycleItem,
  Task,
  User,
} from "@/types";
import {
  buildBoard,
  buildPeopleBoard,
  checksDue,
  spaceProjects,
  sprintKpi,
} from "@/lib/initiatives";
import { KanbanColumn } from "@/components/tasks/TaskKanban";
import type {
  KanbanDrag,
  KanbanHandlers,
  KanbanQuickAdd,
} from "@/components/tasks/TaskKanban";
import { SprintTaskPool } from "@/components/tasks/SprintTaskPool";
import { SprintReport } from "@/components/tasks/SprintReport";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";
import { buildQuickAddInput } from "@/lib/quickAddTask";
import { poolCandidates, projectLabel } from "@/lib/sprintPool";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import {
  AcceptDialog,
  type AcceptSubmit,
} from "@/components/tasks/sprints/AcceptDialog";
import { AnalyticsScreen } from "@/components/tasks/sprints/AnalyticsScreen";
import { JournalScreen } from "@/components/tasks/sprints/JournalScreen";
import {
  BoardSkeleton,
  InitiativeList,
} from "@/components/tasks/sprints/InitiativeList";
import { SpaceSwitcher } from "@/components/tasks/sprints/SpaceSwitcher";
import { SprintBar } from "@/components/tasks/sprints/SprintBar";
import { SprintPulse } from "@/components/tasks/sprints/SprintPulse";
import { NotificationsBell } from "@/components/roy/NotificationsBell";
import {
  GroupingToggle,
  useSprintGrouping,
  useSprintView,
  SprintTabs,
} from "@/components/tasks/sprints/ViewToggle";
import { fmtDay } from "@/components/tasks/sprints/format";

// Экран «Спринты» — период работы команды с датами, планом и приёмкой (issue #267).
// ⚠️ Не путать с доской «Проекты» (SprintBoard.tsx): там таблица `sprints` = ВКЛАДКИ доски,
// имя историческое. Спринты живут в `sprint_cycles` и ходят через /sprint-cycles.
//
// Канбан — общий (TaskKanban.tsx), но колонок три: «Бэклога» в спринте нет, его роль играет
// пул слева. Карточки внутри колонки сгруппированы заголовками проектов — это группировка,
// а не копии проектов (в отличие от доски, где у каждого проекта своя полоса колонок).

const SPRINT_SECTION = "__sprint__"; // канбан спринта — одна секция, drop меняет только статус
const CLOSED = new Set(["done", "cancelled"]);
const DEFAULT_LENGTH_DAYS = 13; // двухнедельный спринт: старт + 13 = ровно 14 дней

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
}

/** Имя по умолчанию — «Спринт 10.09 — 23.09»: так их называют в переписке. */
function defaultCycleName(from: Date, to: Date): string {
  const dm = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }`;
  return `Спринт ${dm(from)} — ${dm(to)}`;
}

/**
 * Карточка принятого спринта — из клона (`frozen_*`), живой задачи за ней может уже не быть.
 * Канбан рисует `Task`, поэтому собираем задачу-пустышку: она только для чтения (readOnly),
 * ни перетащить, ни открыть её нельзя.
 */
function frozenCard(item: SprintCycleItem): Task {
  return {
    id: item.id,
    title: item.title,
    description: null,
    assignees: item.assignees,
    assignee_telegram_ids: [],
    due_date: null,
    remind_date: null,
    reminded_at: null,
    tags: [],
    country: null,
    task_role: null,
    priority: null,
    source: "sprint_archive",
    status: item.status,
    created_at: item.added_at,
    updated_at: null,
    meeting_id: null,
    url: null,
    group_id: null,
    created_by_name: null,
    is_private: false,
    owner_id: null,
    start_date: null,
    timeline_position: null,
    sprint_id: null,
    label_ids: [],
    project_id: item.project_id,
    project_linked: false,
    parent_id: null,
    tree_x: null,
    tree_y: null,
    recur_freq: null,
    recur_anchor_dom: null,
  };
}

export function SprintsScreen() {
  const dt = useDt();

  const confirm = useConfirm();
  const { me } = useRoyNav();
  const isAdmin = me?.is_admin ?? false;

  const isDesktop = useIsDesktop();
  const [view, setView] = useSprintView();
  const [grouping, setGrouping] = useSprintGrouping();
  // Вкладка «Спринт» возвращает тот вид состава, с которого ушли на «Аналитику»/«Журнал»:
  // канбанщик не должен каждый раз переключаться обратно.
  const [lastBoard, setLastBoard] = useState<"list" | "kanban">("list");
  useEffect(() => {
    if (view === "list" || view === "kanban") setLastBoard(view);
  }, [view]);

  const [cycles, setCycles] = useState<SprintCycle[]>([]);
  const [spaces, setSpaces] = useState<Sprint[]>([]);
  // Инициатива, в которую заводят задачу стандартной карточкой. null — карточка закрыта.
  // Своё поле ввода в строке было короче, но заводило второй способ создания задачи
  // (владелец 19.09.2026: «давай вызывать нашу стандартную менюшку»).
  const [addingTo, setAddingTo] = useState<string | null | undefined>(
    undefined,
  );
  // Панель «Задачи» слева: нужна только при наборе состава. Выбор помнится между заходами —
  // как у переключателя видов (замечание владельца 19.09.2026).
  // Бэклог живёт в ШТОРКЕ, а не в постоянной колонке (владелец 19.09.2026: «добавление задач
  // громоздко»): половина ширины экрана под список, из которого берут раз в неделю, — плохой
  // размен. Открывается кнопкой и закрывается по Esc и клику вне.
  const [poolOpen, setPoolOpen] = useState(false);
  // Режим правки прячет СТРУКТУРНЫЕ кнопки (завести пространство, переименовать, удалить,
  // взять из бэклога, «+ задача»). Ежедневные отметки — «готово», «к переносу», «как идут
  // дела» — остаются всегда: прятать их за тумблер значит требовать два клика на действие,
  // которое делают по десять раз в день.
  const [editMode, setEditMode] = useState(false);
  // Esc закрывает шторку: открытая поверх экрана панель обязана закрываться клавишей, иначе
  // человек ищет крестик глазами.
  useEffect(() => {
    if (!poolOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPoolOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [poolOpen]);
  // Переименование спринта: null — не правим, иначе черновик имени. Спринт, названный датами
  // при создании, со временем получает смысл («Запуск Эстонии»), и менять имя должно быть
  // можно, не пересоздавая период (#403).
  const [renaming, setRenaming] = useState<string | null>(null);
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
  const [acceptOpen, setAcceptOpen] = useState(false);

  const COLUMNS = useMemo(() => [
    { status: "open", label: dt("Открыто", "Open"), bar: "#8C8475" },
    {
      status: "in_progress",
      label: dt("В работе", "In progress"),
      bar: "var(--status-prog)",
    },
    { status: "done", label: dt("Готово", "Done"), bar: "var(--status-done)" },
  ], [dt]);

  const load = useCallback(async () => {
    try {
      const [c, t, p, sp, u] = await Promise.all([
        fetchSprintCycles(),
        fetchTasks(),
        fetchProjects(),
        fetchSprints("space"),
        fetchUsers(),
      ]);
      setCycles(c);
      setTasks(t);
      setProjects(p);
      setSpaces(sp);
      setUsers(u);
      setErr(null);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось загрузить спринты", "Failed to load sprints"),
      );
    } finally {
      setLoading(false);
    }
  }, [dt]);

  useEffect(() => {
    load();
  }, [load]);

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
  const spaceCycles = useMemo(() => cycles.filter((c) => c.tab_id === space), [
    cycles,
    space,
  ]);

  // Автовыбор внутри пространства: активный спринт, иначе ближайший черновик, иначе последний.
  useEffect(() => {
    if (spaceCycles.some((c) => c.id === selectedId)) return;
    const pick = spaceCycles.find((c) => c.status === "active") ??
      [...spaceCycles].reverse().find((c) => c.status === "draft") ??
      spaceCycles[0];
    setSelectedId(pick?.id ?? null);
  }, [spaceCycles, selectedId]);

  const reloadDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await fetchSprintCycle(id));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

  const accepted = detail?.status === "accepted";
  const items = detail?.items ?? [];
  const inSprint = useMemo(
    () => new Set(items.map((i) => i.task_id).filter(Boolean) as string[]),
    [items],
  );

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
      const liveProject = live
        ? projects.find((p) => p.id === live.project_id)
        : undefined;
      // Полная подпись «Группа › Подпроект»: у подпроектов бывают тёзки, а по голому имени
      // не видно, к какой группе относится полоса (в пуле подпись такая же).
      labels.set(
        card.id,
        it.project ??
          (liveProject ? projectLabel(liveProject, projects) : null),
      );
    }
    return { cards: out, groupLabels: labels };
  }, [items, tasks, projects]);

  // Пул слева. Правило отбора — `poolCandidates` в lib/sprintPool.ts (под тестами): не взятые
  // в спринт, не закрытые, не приватные.
  const poolTasks = useMemo(() => poolCandidates(tasks, inSprint), [
    tasks,
    inSprint,
  ]);

  const plan = items.filter((i) => i.in_plan);
  // Цифры шапки и дерево доски считает lib/initiatives — то же правило, что у серверных
  // итогов. Считать их здесь значило бы завести второй ответ на вопрос «сколько сделано».
  const kpi = useMemo(() => sprintKpi(items), [items]);
  const board = useMemo(() => buildBoard(items, projects), [items, projects]);
  // Вторая группировка того же состава — по людям. Ради неё был отдельный экран сверки;
  // после переезда отметок в строку (владелец 19.09.2026) это переключатель внутри списка:
  // на встрече идут по человеку, в работе — по инициативе.
  const peopleBoard = useMemo(() => buildPeopleBoard(items), [items]);
  const byPeople = grouping === "people";
  // «Не отмечено» показываем с дня сверки (D013): до него молчание — норма, а не сигнал.
  // Само правило — в lib/initiatives (под тестами): в двух экранах «с какого дня» разъедется.
  const unchecked = checksDue(detail?.check_date ?? null);

  async function applyDrop(taskId: string, _section: string, status: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t))
    );
    try {
      await updateTask(taskId, { status });
    } catch {
      load();
    }
    reloadDetail(selectedId);
  }

  // «+» в колонке: задача создаётся и сразу попадает в спринт — иначе кнопка обещала бы
  // добавление в спринт, а задача оказывалась бы только в общем списке.
  async function addTaskToColumn(
    _section: string,
    status: string,
    title: string,
  ) {
    setQuickAdd(null);
    const input = buildQuickAddInput(title, me, { status });
    if (!input || !detail) return;
    try {
      const created = await createTask(input);
      setTasks((prev) => [created, ...prev]);
      await addTasksToSprintCycle(detail.id, [created.id]);
      await reloadDetail(detail.id);
    } catch {
      load();
    }
  }

  // Задача, созданная карточкой, сразу попадает в текущий спринт — иначе «+ задача» внутри
  // спринта завела бы её мимо него, в общий список.
  async function onTaskCreated(created?: Task) {
    load();
    if (!created || !detail) {
      if (detail) reloadDetail(detail.id);
      return;
    }
    try {
      await addTasksToSprintCycle(detail.id, [created.id]);
    } catch { /* задача создана; в спринт её можно взять из панели слева */ }
    await reloadDetail(detail.id);
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
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось добавить", "Failed to add"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeFromSprint(task: Task) {
    if (!detail) return;
    try {
      await removeTaskFromSprintCycle(detail.id, task.id);
      await reloadDetail(detail.id);
    } catch {
      load();
    }
  }

  async function submitCycle() {
    const name = form.name.trim();
    if (!name) {
      setErr(dt("Введите название спринта", "Enter a sprint name"));
      return;
    }
    setBusy(true);
    try {
      // Спринт заводится В ПРОСТРАНСТВЕ, которое сейчас открыто: спринт без вкладки не
      // виден нигде, кроме «Без пространства», и на второй день его ищут всей командой.
      const created = await createSprintCycle({
        name,
        start_date: form.start_date,
        end_date: form.end_date,
        tab_id: space,
      });
      setCreating(false);
      setErr(null);
      await load();
      setSelectedId(created.id);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось создать спринт", "Failed to create the sprint"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!detail) return;
    // Старт с пустым составом фиксирует ПУСТОЙ план: процент считать будет не от чего, и всё
    // набранное потом пойдёт «сверх плана». Владелец наступил на это на первом же спринте
    // (09.09.2026: «тестовый» уехал в active с нулём задач), поэтому предупреждение явное.
    if (
      !(await confirm({
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
      }))
    ) return;
    setBusy(true);
    try {
      await startSprintCycle(detail.id);
      await Promise.all([load(), reloadDetail(detail.id)]);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось начать", "Failed to start"),
      );
    } finally {
      setBusy(false);
    }
  }

  // Приёмка идёт через своё окно: в нём видно, ЧТО уедет, и можно вписать причину переноса
  // (D011). Подтверждение в одну строку этого места не давало, и таблица причин стояла пустой.
  async function submitAccept({ summary, reasons }: AcceptSubmit) {
    if (!detail) return;
    setBusy(true);
    try {
      // Причины пишем ДО приёмки: после неё состав заморожен, и строка правке не поддаётся.
      // Ошибка одной причины не должна отменять приёмку — но и молчать о ней нельзя.
      const failed: string[] = [];
      for (const [taskId, carry_reason] of Object.entries(reasons)) {
        try {
          await patchSprintCycleItem(detail.id, taskId, { carry_reason });
        } catch {
          failed.push(taskId);
        }
      }
      const result = await acceptSprintCycle(detail.id, { summary });
      setAcceptOpen(false);
      await load();
      setSelectedId(result.next?.id ?? detail.id);
      setErr(
        failed.length > 0
          ? dt(
            `Спринт принят, но ${failed.length} причин(ы) не сохранились — их можно вписать в следующем спринте.`,
            `The sprint is accepted, but ${failed.length} reason(s) were not saved — you can add them in the next sprint.`,
          )
          : null,
      );
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось принять", "Failed to accept"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeCycle() {
    if (!detail) return;
    if (
      !(await confirm({
        title: dt(`Удалить «${detail.name}»?`, `Delete “${detail.name}”?`),
        description: dt(
          "Задачи не удалятся — они просто выйдут из спринта.",
          "Tasks are not deleted — they just leave the sprint.",
        ),
        confirmText: dt("Удалить спринт", "Delete sprint"),
      }))
    ) return;
    setBusy(true);
    try {
      await deleteSprintCycle(detail.id);
      setSelectedId(null);
      await load();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось удалить", "Failed to delete"),
      );
    } finally {
      setBusy(false);
    }
  }

  // Отметка сверки: сначала на экране, потом на сервере. Ритуал — разговор на десять минут,
  // и ждать ответа сети на каждое нажатие значит его растянуть; отказ откатывает строку и
  // говорит вслух, а не оставляет отметку, которой на сервере нет.
  // «✓» в строке: закрывает задачу и возвращает обратно. Статус живёт в самой задаче, а не в
  // строке спринта, поэтому правим задачу и перечитываем состав (#407 — быстрые действия).
  async function toggleDone(item: SprintCycleItem) {
    if (!detail || !item.task_id) return;
    const next = CLOSED.has(item.status) ? "open" : "done";
    try {
      await updateTask(item.task_id, { status: next });
      await reloadDetail(detail.id);
      load();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось отметить", "Failed to mark"),
      );
    }
  }

  // «→» в строке: та же пометка «к переносу», что на сверке, — без захода на отдельный экран.
  function toggleCarry(item: SprintCycleItem) {
    return markItem(item, { to_carry: !item.to_carry });
  }

  async function markItem(
    item: SprintCycleItem,
    patch: Partial<
      Pick<
        SprintCycleItem,
        "check_status" | "check_note" | "to_carry" | "carry_reason"
      >
    >,
  ) {
    if (!detail || !item.task_id) return;
    const before = detail;
    setDetail({
      ...detail,
      items: detail.items.map((
        i,
      ) => (i.id === item.id ? { ...i, ...patch } : i)),
    });
    try {
      await patchSprintCycleItem(detail.id, item.task_id, patch);
    } catch (e) {
      setDetail(before);
      setErr(
        e instanceof Error
          ? e.message
          : dt("Отметка не сохранилась", "The mark was not saved"),
      );
    }
  }

  const kanban: KanbanHandlers = {
    drag,
    onDragChange: setDrag,
    onDropTask: applyDrop,
    quickAdd,
    onQuickAddChange: setQuickAdd,
    onQuickAddSubmit: addTaskToColumn,
    onOpenTask: (t) => setEditing(t),
  };

  // Хвосты приёмки: незакрытое и не упоминание. Через useMemo, чтобы окно приёмки получало
  // один и тот же массив между рендерами — новый массив на каждый рендер оно читает как
  // изменение состава.
  const carrying = useMemo(
    () => items.filter((i) => !CLOSED.has(i.status) && !i.removed),
    [items],
  );

  // Канбан — только на компьютере (D003), поэтому на телефоне список показывается всегда,
  // независимо от запомненного вида.
  const effectiveView = view === "kanban" && !isDesktop ? "list" : view;
  const showList = effectiveView === "list";
  const showAnalytics = effectiveView === "analytics";
  const showJournal = effectiveView === "journal";

  // Задачи пространства — для «Всех инициатив»: правило принадлежности в lib/initiatives
  // под тестами, потому что ошибка тут молчит и показывает чужую стройку как свою.
  const spaceTasks = useMemo(() => {
    const ids = spaceProjects(projects, space);
    return tasks.filter((t) => t.project_id && ids.has(t.project_id));
  }, [tasks, projects, space]);

  // Живой спринт пространства — в него берут задачи с «Всех инициатив».
  const liveCycle = useMemo(
    () =>
      spaceCycles.find((c) => c.status === "active") ?? spaceCycles.find((c) =>
        c.status === "draft"
      ) ?? null,
    [spaceCycles],
  );

  async function saveInitiative(
    id: string,
    patch: {
      owner_telegram_id: number | null;
      start_date: string | null;
      end_date: string | null;
    },
  ) {
    try {
      await updateProject(id, patch);
      setProjects(await fetchProjects());
      setErr(null);
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : dt(
          "Не удалось сохранить инициативу",
          "Failed to save the initiative",
        ),
      );
    }
  }

  /* Пустой спринт объясняет ровно следующее действие: «наберите из пула» не говорит, ЧЕМ
     набирают, и человек упирается в экран (владелец 09.09.2026). */
  const emptyComposition = (
    <div className="py-10 text-sm text-ink-soft/80 space-y-1.5">
      <p className="font-semibold text-ink">
        {dt("В спринте пока нет задач", "The sprint is empty")}
      </p>
      {isDesktop
        ? (
          <>
            <p>
              {dt(
                "1. Нажмите «Набрать состав» в полосе сверху и отметьте задачи галочками — появится «Добавить в спринт».",
                "1. Press “Pick tasks” in the bar above and tick the tasks — an “Add to sprint” button appears.",
              )}
            </p>
            <p>
              {dt(
                "2. Одну задачу быстрее добавить кнопкой «+» в её строке.",
                "2. A single task is faster to add with the “+” on its row.",
              )}
            </p>
          </>
        )
        : (
          <p>
            {dt(
              "Состав спринта набирают с компьютера — на телефоне спринт только смотрят и отмечают.",
              "A sprint is filled from a computer — on a phone you read it and mark progress.",
            )}
          </p>
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
  if (loading) {
    return (
      <div className="px-4 py-6">
        <BoardSkeleton />
      </div>
    );
  }

  const newSprint = () => {
    const today = new Date();
    const end = new Date();
    end.setDate(end.getDate() + DEFAULT_LENGTH_DAYS);
    // Имя предзаполнено датами: пустое поле упиралось в ошибку «введите название»
    // на первом же клике, а имя по датам — то, как спринты и называют.
    setForm({
      name: defaultCycleName(today, end),
      start_date: iso(today),
      end_date: iso(end),
    });
    setCreating((v) => !v);
  };

  async function moveCycle(next: string | null) {
    if (!detail || next === (detail.tab_id ?? null)) return;
    setErr(null);
    try {
      await updateSprintCycle(detail.id, { tab_id: next });
      setSpace(next);
      setSpacePicked(true);
      await load();
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось перенести спринт", "Could not move the sprint"),
      );
    }
  }

  const editable = !!detail && !accepted;
  const sprintTab = !showAnalytics && !showJournal;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Заголовок раздела с вкладками (стенд): на десктопе шапку оболочки заменяет эта строка,
          на телефоне остаются одни вкладки. */}
      <div className="flex shrink-0 items-stretch gap-5 border-b border-line px-4 lg:px-5" style={{ minHeight: 44 }}>
        {isDesktop && (
          <h1 className="self-center font-semibold text-ink" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            {dt("Спринты", "Sprints")}
          </h1>
        )}
        <SprintTabs
          value={view}
          onChange={(v) => setView(v === "list" ? lastBoard : v)}
        />
        {isDesktop && <NotificationsBell className="ml-auto self-center" />}
      </div>

      <SprintBar
        spaceMenu={
          <SpaceSwitcher
            spaces={spaces}
            value={space}
            showOrphans={hasOrphans}
            counts={new Map(
              [
                ...spaces.map((s) =>
                  [
                    s.id as string | null,
                    cycles.filter((c) => c.tab_id === s.id).length,
                  ] as const
                ),
                [null, cycles.filter((c) => c.tab_id === null).length] as const,
              ],
            )}
            canManage={isAdmin && editMode}
            onChanged={load}
            onChange={(id) => {
              setSpace(id);
              setSpacePicked(true);
              setSelectedId(null);
            }}
          />
        }
        live={live}
        archive={archive}
        selectedId={selectedId}
        onSelect={setSelectedId}
        detail={detail}
        sprintTab={sprintTab}
        view={isDesktop ? view : "list"}
        onView={setView}
        kanbanDisabled={!isDesktop}
        poolCount={poolTasks.length}
        onPool={editable ? () => setPoolOpen(true) : undefined}
        editMode={editMode}
        onEditMode={() => setEditMode((v) => !v)}
        busy={busy}
        // Пустое пространство правкой не защищаем: там нечего сломать, а спрятанная за
        // тумблер первая кнопка превращает экран в тупик.
        onNewSprint={editMode || spaceCycles.length === 0 ? newSprint : undefined}
        onRename={isAdmin && editMode && editable ? () => setRenaming(detail!.name) : undefined}
        onDelete={isAdmin && editable ? removeCycle : undefined}
        move={isAdmin && editMode && editable && spaces.length > 0
          ? { spaces, onMove: moveCycle }
          : undefined}
        onStart={start}
        onAccept={() => setAcceptOpen(true)}
        reportOpen={reportOpen}
        onReport={() => setReportOpen((v) => !v)}
        renameField={renaming !== null && detail
          ? (
            <input
              autoFocus
              value={renaming}
              disabled={busy}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => setRenaming(null)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") setRenaming(null);
                if (e.key === "Enter" && renaming.trim()) {
                  await updateSprintCycle(detail.id, { name: renaming.trim() });
                  setRenaming(null);
                  await load();
                }
              }}
              className="h-[28px] w-56 rounded-[7px] border border-accent-line bg-surface px-2.5 font-semibold text-ink outline-none"
              style={{ fontSize: 12.5 }}
            />
          )
          : undefined}
      />

      {creating && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 pb-2 lg:px-5">
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCycle();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={dt("Название спринта", "Sprint name")}
            className="h-[28px] w-52 rounded-[7px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12.5 }}
          />
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            className="h-[28px] rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12.5 }}
          />
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className="h-[28px] rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12.5 }}
          />
          <button
            type="button"
            onClick={submitCycle}
            disabled={busy}
            className="h-[28px] rounded-[7px] bg-primary px-3 font-semibold text-white disabled:opacity-50"
            style={{ fontSize: 12.5 }}
          >
            {busy ? dt("Создание…", "Creating…") : dt("Создать", "Create")}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="px-2 text-ink-soft hover:text-ink"
            style={{ fontSize: 12.5 }}
          >
            {dt("Отмена", "Cancel")}
          </button>
        </div>
      )}

      {err && (
        <p className="mx-4 mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive lg:mx-5">
          {err}
        </p>
      )}

      {!detail
        ? (
          <p className="px-4 py-10 text-center text-sm text-ink-soft/70">
            {spaceCycles.length === 0
              ? dt(
                "В этом пространстве спринтов пока нет. Создайте первый: меню спринта в полосе сверху → «＋ Новый спринт» — это может любой участник.",
                "No sprints in this space yet. Create the first one: the sprint menu in the bar above → “＋ New sprint” — any participant can.",
              )
              : dt("Выберите спринт в полосе сверху.", "Pick a sprint in the bar above.")}
          </p>
        )
        : (
          <>
            {sprintTab && (
              <SprintPulse
                kpi={kpi}
                showUnchecked={unchecked}
                extra={plan.length > 0 ? items.length - plan.length : 0}
              />
            )}

            {accepted && sprintTab && (
              <p className="mx-4 mt-2.5 rounded-[8px] border border-dashed border-line px-3 py-2 text-ink-soft lg:mx-5" style={{ fontSize: 12.5 }}>
                {dt(
                  `Архив: карточки — слепок на момент приёмки ${
                    detail.accepted_at ? fmtDay(detail.accepted_at) : ""
                  }, изменить их нельзя.`,
                  `Archive: cards are a snapshot taken at acceptance${
                    detail.accepted_at
                      ? ` on ${fmtDay(detail.accepted_at)}`
                      : ""
                  } and cannot be changed.`,
                )}
              </p>
            )}

            <div className="flex-1 min-h-0 flex gap-3 px-4 pb-4 pt-3 lg:px-5">
              {
                /* Пул — способ набрать состав, поэтому он нужен обоим видам; на телефоне его
                нет (D003): выбор галочками в узкой колонке нечитаем. */
              }
              {accepted && reportOpen && <SprintReport cycle={detail} />}
              {showJournal
                ? <JournalScreen space={space} />
                : showAnalytics
                ? (
                  <AnalyticsScreen
                    cycles={spaceCycles}
                    current={detail}
                    projects={projects}
                    tasks={spaceTasks}
                    users={users}
                    space={space}
                    spaceName={spaces.find((s) => s.id === space)?.name ??
                      dt("Без пространства", "No space")}
                  />
                )
                : showList
                ? (
                  <div className="flex-1 min-w-0 overflow-auto">
                    {items.length === 0 ? emptyComposition : (
                      <div className="min-w-[640px]">
                        {/* «Состав · N» и тихая группировка справа (стенд: `.shead`). */}
                        <div className="mb-2 flex items-center gap-3 px-0.5">
                          <span className="font-semibold text-ink" style={{ fontSize: 13 }}>
                            {dt("Состав", "Tasks")} · <span className="font-mono">{items.length}</span>
                          </span>
                          <GroupingToggle
                            value={grouping}
                            onChange={setGrouping}
                          />
                        </div>
                        <InitiativeList
                          board={byPeople ? peopleBoard : board}
                          noneLabel={byPeople
                            ? dt("Без исполнителя", "Unassigned")
                            : undefined}
                          unchecked={unchecked}
                          showExtra={plan.length > 0}
                          marketOf={(item) =>
                            item.frozen || !item.task_id
                              ? null
                              : tasks.find((t) => t.id === item.task_id)?.country ?? null}
                          parentOf={(item) =>
                            item.task_id ? tasks.find((t) => t.id === item.task_id)?.parent_id ?? null : null}
                          users={users}
                          // Принятый спринт — слепок: в него не дописывают. В группировке по
                          // людям «+ задача» нет: группа — человек, а не проект, и класть
                          // задачу «в человека» некуда.
                          onAdd={accepted || byPeople || !editMode
                            ? undefined
                            : (projectId) => setAddingTo(projectId)}
                          onDone={accepted ? undefined : toggleDone}
                          onCarry={accepted ? undefined : toggleCarry}
                          onCheck={accepted
                            ? undefined
                            : (item, status) =>
                              markItem(item, {
                                check_status: status,
                                // Сняли отметку — убираем и причину: висящая причина от снятого
                                // риска читается как живая.
                                ...(status === null
                                  ? { check_note: null }
                                  : {}),
                              })}
                          onNote={accepted
                            ? undefined
                            : (item, patch) => markItem(item, patch)}
                          onOpen={(item) => {
                            // Открываем ЖИВУЮ задачу: строка спринта — это её отражение, и править
                            // надо задачу. У упоминания и приватной чужой открывать нечего — такие
                            // строки список кликабельными и не делает.
                            const live = item.task_id
                              ? tasks.find((t) => t.id === item.task_id)
                              : undefined;
                            if (live) setEditing(live);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
                : (
                  <div className="flex-1 min-w-0 flex gap-3 overflow-x-auto">
                    {items.length === 0
                      ? emptyComposition
                      : COLUMNS.map((col) => (
                        <KanbanColumn
                          key={col.status}
                          sectionId={SPRINT_SECTION}
                          column={col}
                          tasks={cards.filter((t) => (col.status === "done"
                            ? CLOSED.has(t.status)
                            : t.status === col.status)
                          )}
                          groupOf={(t) => groupLabels.get(t.id) ?? null}
                          readOnly={accepted}
                          onRemoveCard={accepted ? undefined : removeFromSprint}
                          removeTitle={dt(
                            "Убрать из спринта",
                            "Remove from sprint",
                          )}
                          kanban={kanban}
                        />
                      ))}
                  </div>
                )}
            </div>
          </>
        )}

      {/* Шторка бэклога. Поверх экрана, а не колонкой: набор состава — редкое действие, и
          отдавать ему половину ширины каждый день незачем (#407). Подложка закрывает по клику
          вне, Esc — клавишей. */}
      {poolOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label={dt("Закрыть", "Close")}
            onClick={() => setPoolOpen(false)}
            className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
          />
          <aside className="relative flex h-full w-full max-w-[420px] flex-col border-l border-line bg-background p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-bold text-ink">
                {dt("Взять из бэклога", "Take from the backlog")}
              </h3>
              <button
                type="button"
                onClick={() => setPoolOpen(false)}
                title={dt("Закрыть", "Close")}
                className="ml-auto rounded-lg p-1.5 text-ink-soft hover:bg-surface-2 hover:text-ink"
              >
                <RoyIcon name="x" size={14} />
              </button>
            </div>
            <SprintTaskPool
              tasks={poolTasks}
              projects={projects}
              users={users}
              adding={busy}
              onAdd={addToSprint}
            />
          </aside>
        </div>
      )}

      <AcceptDialog
        open={acceptOpen && !!detail}
        cycleName={detail?.name ?? ""}
        busy={busy}
        carrying={carrying}
        onCancel={() => setAcceptOpen(false)}
        onAccept={submitAccept}
      />

      <TaskModal
        open={addingTo !== undefined}
        projectId={addingTo ?? null}
        onClose={() => setAddingTo(undefined)}
        onSaved={onTaskCreated}
      />
      <TaskModal
        task={editing ?? undefined}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          load();
          reloadDetail(selectedId);
        }}
      />
    </div>
  );
}
