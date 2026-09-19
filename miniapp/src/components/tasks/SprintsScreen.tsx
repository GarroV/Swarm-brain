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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AllInitiatives } from "@/components/tasks/sprints/AllInitiatives";
import { AnalyticsScreen } from "@/components/tasks/sprints/AnalyticsScreen";
import { JournalScreen } from "@/components/tasks/sprints/JournalScreen";
import {
  BoardSkeleton,
  InitiativeList,
} from "@/components/tasks/sprints/InitiativeList";
import { SpaceSwitcher } from "@/components/tasks/sprints/SpaceSwitcher";
import { SprintKpiHeader } from "@/components/tasks/sprints/SprintKpiHeader";
import {
  GroupingToggle,
  useSprintGrouping,
  useSprintView,
  ViewToggle,
} from "@/components/tasks/sprints/ViewToggle";
import { daysLeft, fmtDay, fmtRange } from "@/components/tasks/sprints/format";

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
const ARCHIVE_NONE = "__archive__"; // «архив не выбран»: у ui/select пустая строка не значение

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
  const [poolOpen, setPoolOpen] = useState(true);
  useEffect(() => {
    try {
      setPoolOpen(localStorage.getItem("swarm.sprints.pool") !== "0");
    } catch { /* приватное окно — просто оставляем открытой */ }
  }, []);
  function togglePool(next: boolean) {
    setPoolOpen(next);
    try {
      localStorage.setItem("swarm.sprints.pool", next ? "1" : "0");
    } catch { /* приватное окно — панель просто не запомнится */ }
  }
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
        fetchSprints(),
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
  const showInitiatives = effectiveView === "initiatives";
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
                "1. Слева отметьте задачи галочками — сверху появится «Добавить в спринт».",
                "1. Tick the tasks on the left — an “Add to sprint” button appears above the list.",
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Пространство — первый вопрос («какой проект»), спринт — второй. */}
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
        canManage={isAdmin}
        onChanged={load}
        onChange={(id) => {
          setSpace(id);
          setSpacePicked(true);
          setSelectedId(null);
        }}
      />

      {/* Селектор: живые спринты чипами, принятые — архивом (их со временем станет много) */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 overflow-x-auto shrink-0">
        {live.map((c) => {
          const active = selectedId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm"
              }`}
            >
              {c.name}
              {c.status === "active" ? " ·" : ""}
            </button>
          );
        })}
        {archive.length > 0 && (
          /* Архив принятых спринтов, сгруппированный по годам. Общий ui/select, не нативный:
             системное меню macOS выглядит чужеродно поверх интерфейса (владелец 09.09.2026). */
          <Select
            value={archive.some((c) => c.id === selectedId)
              ? selectedId ?? ARCHIVE_NONE
              : ARCHIVE_NONE}
            onValueChange={(v) => {
              const id = String(v);
              if (id !== ARCHIVE_NONE) setSelectedId(id);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={dt("Архив спринтов", "Sprint archive")}
              className="h-7 shrink-0 rounded-full border-line bg-surface px-2.5 text-xs font-semibold text-ink-soft dark:bg-surface dark:backdrop-blur-sm"
            >
              <SelectValue>
                {(v) =>
                  archive.find((c) => c.id === String(v))?.name ??
                    dt("Архив", "Archive")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ARCHIVE_NONE}>
                {dt("Архив", "Archive")}
              </SelectItem>
              {[...new Set(archive.map((c) => c.start_date.slice(0, 4)))].sort()
                .reverse().map((year) => (
                  <SelectGroup key={year}>
                    <SelectLabel>{year}</SelectLabel>
                    {archive.filter((c) => c.start_date.startsWith(year)).map((
                      c,
                    ) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {fmtRange(c.start_date, c.end_date)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
            </SelectContent>
          </Select>
        )}
        {
          <button
            onClick={() => {
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
            }}
            className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm shrink-0"
            title={dt("Новый спринт", "New sprint")}
          >
            <RoyIcon name="plus" size={14} strokeWidth={2} />
          </button>
        }

        {/* Вид запоминается у человека; канбан — только на компьютере (D003). */}
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle
            value={isDesktop ? view : "list"}
            onChange={setView}
            kanbanDisabled={!isDesktop}
          />
        </div>
      </div>

      {creating && (
        <div className="mx-4 mb-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCycle();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={dt("Название спринта", "Sprint name")}
            className="w-44 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary/50"
          />
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink outline-none focus:border-primary/50"
          />
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink outline-none focus:border-primary/50"
          />
          <Button
            size="sm"
            className="h-9 text-xs"
            onClick={submitCycle}
            disabled={busy}
          >
            {busy ? dt("Создание…", "Creating…") : dt("Создать", "Create")}
          </Button>
          <button
            onClick={() => setCreating(false)}
            className="text-xs text-ink-soft px-2"
          >
            {dt("Отмена", "Cancel")}
          </button>
        </div>
      )}

      {err && (
        <p className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {err}
        </p>
      )}

      {!detail
        ? (
          <p className="px-4 py-10 text-center text-sm text-ink-soft/70">
            {spaceCycles.length === 0
              ? dt(
                "В этом пространстве спринтов пока нет. Создайте первый кнопкой «+» сверху — это может любой участник.",
                "No sprints in this space yet. Create the first one with “+” above — any participant can.",
              )
              : dt("Выберите спринт сверху.", "Pick a sprint above.")}
          </p>
        )
        : (
          <>
            {/* Шапка: даты, состояние, прогресс, действие по состоянию */}
            <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-line bg-surface/40 px-3 py-2 dark:backdrop-blur-sm">
              {renaming === null
                ? (
                  <span className="text-sm font-bold text-ink">
                    {detail.name}
                  </span>
                )
                : (
                  <input
                    autoFocus
                    value={renaming}
                    disabled={busy}
                    onChange={(e) => setRenaming(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Escape") setRenaming(null);
                      if (e.key === "Enter" && renaming.trim()) {
                        await updateSprintCycle(detail.id, {
                          name: renaming.trim(),
                        });
                        setRenaming(null);
                        await load();
                      }
                    }}
                    className="w-56 rounded-full border border-line bg-surface px-3 py-1 text-sm font-bold text-ink outline-none focus:border-ink-soft"
                  />
                )}
              {isAdmin && !accepted && renaming === null && (
                <button
                  onClick={() => setRenaming(detail.name)}
                  disabled={busy}
                  title={dt("Переименовать спринт", "Rename sprint")}
                  className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-soft hover:bg-surface-2 disabled:opacity-50 dark:backdrop-blur-sm"
                >
                  ✎
                </button>
              )}
              <span className="text-xs text-ink-soft">
                {fmtRange(detail.start_date, detail.end_date)}
              </span>
              {detail.status === "active" && (
                <span
                  className={`text-xs ${
                    daysLeft(detail.end_date) < 0
                      ? "text-destructive"
                      : "text-ink-soft"
                  }`}
                >
                  {daysLeft(detail.end_date) < 0
                    ? dt(
                      `просрочен на ${-daysLeft(detail.end_date)} дн.`,
                      `${-daysLeft(detail.end_date)} day(s) overdue`,
                    )
                    : dt(
                      `осталось ${daysLeft(detail.end_date)} дн.`,
                      `${daysLeft(detail.end_date)} day(s) left`,
                    )}
                </span>
              )}
              {accepted && (
                <span className="rounded-full bg-surface-2 border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                  {dt("принят", "accepted")}{" "}
                  {detail.accepted_at ? fmtDay(detail.accepted_at) : ""}
                </span>
              )}

              <SprintKpiHeader kpi={kpi} showUnchecked={unchecked} />
              {plan.length > 0 && items.length > plan.length && (
                <span className="text-xs text-ink-soft">
                  {dt(
                    `сверх плана ${items.length - plan.length}`,
                    `extra ${items.length - plan.length}`,
                  )}
                </span>
              )}

              <div className="ml-auto flex items-center gap-2">
                {detail.status === "draft" && (
                  <Button
                    size="sm"
                    className="h-9 text-xs"
                    onClick={start}
                    disabled={busy}
                  >
                    {dt("Начать спринт", "Start sprint")}
                  </Button>
                )}
                {detail.status === "active" && (
                  <Button
                    size="sm"
                    className="h-9 text-xs"
                    onClick={() => setAcceptOpen(true)}
                    disabled={busy}
                  >
                    {dt("Принять спринт", "Accept sprint")}
                  </Button>
                )}
                {accepted && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={() => setReportOpen((v) => !v)}
                  >
                    {reportOpen
                      ? dt("Скрыть отчёт", "Hide report")
                      : dt("Открыть отчёт", "Open report")}
                  </Button>
                )}
                {isAdmin && !accepted && (
                  <button
                    onClick={removeCycle}
                    disabled={busy}
                    title={dt("Удалить спринт", "Delete sprint")}
                    className="rounded-full p-1.5 bg-surface text-ink-soft border border-line hover:bg-surface-2 hover:text-destructive disabled:opacity-50 dark:backdrop-blur-sm"
                  >
                    <RoyIcon name="trash" size={14} />
                  </button>
                )}
              </div>
            </div>

            {accepted && (
              <p className="mx-4 mb-2 text-xs text-ink-soft/70">
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

            <div className="flex-1 min-h-0 flex gap-3 px-4 pb-4">
              {
                /* Пул — способ набрать состав, поэтому он нужен обоим видам; на телефоне его
                нет (D003): выбор галочками в узкой колонке нечитаем. */
              }
              {accepted
                ? (reportOpen && <SprintReport cycle={detail} />)
                : isDesktop && !poolOpen
                ? (
                  /* Свёрнутая панель остаётся слева, на своём месте: кнопка, уехавшая в правый
                     верх, читалась как «задачи куда-то делись» (владелец 19.09.2026). */
                  <button
                    type="button"
                    onClick={() => togglePool(true)}
                    title={dt("Показать задачи", "Show tasks")}
                    className="flex w-9 shrink-0 flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 py-2 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink dark:backdrop-blur-sm"
                  >
                    <RoyIcon name="cright" size={14} />
                    <span className="text-[11px] font-semibold tabular-nums">
                      {poolTasks.length}
                    </span>
                    <span
                      className="text-[11px] font-semibold tracking-wide"
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {dt("Задачи", "Tasks")}
                    </span>
                  </button>
                )
                : isDesktop && (
                  <SprintTaskPool
                    tasks={poolTasks}
                    projects={projects}
                    users={users}
                    adding={busy}
                    onAdd={addToSprint}
                    onHide={() => togglePool(false)}
                  />
                )}
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
                : showInitiatives
                ? (
                  <AllInitiatives
                    tasks={spaceTasks}
                    projects={projects}
                    users={users}
                    inSprint={inSprint}
                    sprintName={liveCycle?.name ?? null}
                    onAddToSprint={(taskId) => {
                      if (liveCycle) addToSprint([taskId]);
                    }}
                    onOpenTask={(t) => setEditing(t)}
                    onSaveProject={saveInitiative}
                  />
                )
                : showList
                ? (
                  <div className="flex-1 min-w-0 overflow-y-auto">
                    {items.length === 0 ? emptyComposition : (
                      <>
                        <GroupingToggle
                          value={grouping}
                          onChange={setGrouping}
                        />
                        <InitiativeList
                          board={byPeople ? peopleBoard : board}
                          noneLabel={byPeople
                            ? dt("Без исполнителя", "Unassigned")
                            : undefined}
                          unchecked={unchecked}
                          users={users}
                          // Принятый спринт — слепок: в него не дописывают. В группировке по
                          // людям «+ задача» нет: группа — человек, а не проект, и класть
                          // задачу «в человека» некуда.
                          onAdd={accepted || byPeople
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
                      </>
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
