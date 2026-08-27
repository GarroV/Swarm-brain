// Смарт-списки задач в стиле macOS Reminders (Direction C из design_handoff_roy).
// Чистая логика без React: фильтрация, счётчики и группировка по рынкам.
// Дизайн-решения и семантика — docs/superpowers/specs/2026-06-18-tasks-reminders-list-design.md

import type { Task, Me } from "@/types";
import type { RoyIconName } from "@/components/roy/icons";
import { countryCode } from "@/lib/countries";
import { inRange, dayOf, type DateRange } from "@/lib/dateRange";

export type SmartListId = "today" | "upcoming" | "all" | "recurring" | "done";
// Линза = ось «чьи задачи»: «mine» — назначенные на меня; «team» — ОБЩИЕ (не приватные, без
// конкретного исполнителя); «all» — «мои + командные» (владелец 2026-08-20: «линза "все"
// показывает свои задачи и задачи команды, чужие задачи не показывает»); «staff» — АДМИНСКИЙ
// оверсайт «буквально все, включая чужие личные», в переключателе его НЕТ: он включается только
// тумблером «Все сотрудники» (см. effLens в useReminderTasks) и только у админа.
// «По рынкам» и «Все сотрудники» — НЕ значения линзы, а независимые тумблеры-модификаторы
// отображения (см. LensToggle/useReminderTasks) — применяются К ТЕКУЩЕЙ линзе, группируя её
// результат, а не подменяя охват (решение владельца 2026-08-19: «тумблер сортировки "по рынкам"
// не должен зависеть от того, в каком разделе сейчас юзер»).
export type Lens = "mine" | "team" | "all" | "staff";

// Линзе нужен только telegram_id смотрящего — поэтому принимаем узкий тип, а не весь `Me`:
// главный экран держит в зависимостях useMemo примитивный `meId`, а не объект `me`.
export type Viewer = Pick<Me, "telegram_id">;

export type SmartListDef = { id: SmartListId; label: string; labelEn: string; icon: RoyIconName };

// Единый источник правды для порядка/подписей/иконок смарт-списков (время/статус).
// «По рынкам»/«Все сотрудники» — НЕ смарт-списки, а независимые тумблеры (см. Lens), накладываются на любой из этих списков.
export const SMART_LISTS: SmartListDef[] = [
  { id: "today", label: "Сегодня", labelEn: "Today", icon: "clock" },
  { id: "upcoming", label: "Ближайшие", labelEn: "Upcoming", icon: "cal" },
  { id: "all", label: "Все", labelEn: "All", icon: "task" },
  // «Регулярные» — единственный список, который ПРЯЧЕТСЯ при нулевом счётчике (решение
  // владельца 2026-08-27: «если задач таких нет, то список скрывается»). Скрытие живёт в
  // SmartListNav, здесь список объявлен всегда — иначе счётчик было бы негде взять.
  { id: "recurring", label: "Регулярные", labelEn: "Recurring", icon: "repeat" },
  { id: "done", label: "Готовые", labelEn: "Done", icon: "check" },
];

// Списки, исчезающие из навигации, когда в них нечего показать.
export const HIDE_WHEN_EMPTY: ReadonlySet<SmartListId> = new Set<SmartListId>(["recurring"]);

export function isRecurring(task: Task): boolean {
  return task.recur_freq != null;
}

export const HIGH_PRIORITY = "high";
const PRI_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

// Поддерживаем оба написания статуса в данных: "progress" и "in_progress".
export function normStatus(status: string): string {
  return status === "progress" ? "in_progress" : status;
}
export function isDone(task: Task): boolean {
  return normStatus(task.status) === "done";
}

// Локальная полночь переданной даты (день без времени), в часовом поясе устройства.
function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
// Полночь срока задачи. null — если срока нет или дата не парсится.
function dueMidnight(task: Task): number | null {
  if (!task.due_date) return null;
  const d = new Date(task.due_date);
  return isNaN(d.getTime()) ? null : midnight(d);
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  const due = dueMidnight(task);
  return due != null && !isDone(task) && due < midnight(now);
}

// ЕДИНЫЙ источник правды о линзе: экспортируется, потому что тем же правилом живёт главный экран
// (dash/myTasks.ts → блоки «Мои задачи»/«Задачи команды»). Своя копия правила там разошлась с
// этой и тащила в «команду» ЛИЧНЫЕ задачи коллег — не повторять, звать matchesLens.
export function matchesLens(task: Task, lens: Lens, me: Viewer | null): boolean {
  // «Все сотрудники» (админский тумблер) — ЕДИНСТВЕННЫЙ охват, где видно чужие личные задачи.
  if (lens === "staff") return true;
  // «Команда» = ОБЩИЕ задачи: не приватные И без конкретного исполнителя (формулировка владельца —
  // «командная задача = общая, у которой нет определённого юзера»). Приватные и назначенные на
  // кого-либо (в т.ч. на меня) сюда НЕ попадают — назначенные живут в «Мои». Общую задачу
  // создаёшь, выбрав в исполнителе «Общие» (без конкретного человека).
  const isTeam = !task.is_private && (task.assignee_telegram_ids?.length ?? 0) === 0;
  if (lens === "team") return isTeam;
  const isMine = me != null && (task.assignee_telegram_ids?.includes(me.telegram_id) ?? false);
  if (lens === "mine") return isMine;
  // «Все» = мои + командные, НЕ «буквально все»: чужая личная задача — личное дело коллеги
  // (владелец 2026-08-20). Оверсайт руководителя живёт в отдельной линзе «staff».
  return isMine || isTeam;
}

// Сравнение по сроку: сначала ближайший, задачи без срока — в конец.
function byDueAsc(a: Task, b: Task): number {
  const da = dueMidnight(a);
  const db = dueMidnight(b);
  if (da == null && db == null) return 0;
  if (da == null) return 1;
  if (db == null) return -1;
  return da - db;
}
function byPriorityDesc(a: Task, b: Task): number {
  return (PRI_RANK[b.priority ?? ""] ?? 0) - (PRI_RANK[a.priority ?? ""] ?? 0);
}
function byCreatedDesc(a: Task, b: Task): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}
function byUpdatedDesc(a: Task, b: Task): number {
  const ua = a.updated_at ?? a.created_at ?? "";
  const ub = b.updated_at ?? b.created_at ?? "";
  return ub.localeCompare(ua);
}
// Композиция компараторов: первый ненулевой результат побеждает.
function chain(...cmps: Array<(a: Task, b: Task) => number>) {
  return (a: Task, b: Task): number => {
    for (const cmp of cmps) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

// Период (модификатор «Эта неделя»/«Этот месяц»/произвольный) — пересечение со списком, а не
// расширение: задача обязана попасть И в список, И в диапазон. Дата берётся по смыслу списка —
// в «Готовых» это дата закрытия (updated_at — прокси, отдельного completed_at в таблице нет),
// в остальных срок (due_date). Задача без нужной даты в период не попадает.
function inPeriod(task: Task, listId: SmartListId, range: DateRange | null): boolean {
  if (!range) return true;
  const day = listId === "done" ? dayOf(task.updated_at ?? task.created_at) : dayOf(task.due_date);
  return inRange(day, range);
}

// Базовый предикат «принадлежит списку» (без линзы и сортировки).
// Экспортируется как `matchesList`: тем же правилом проверяется только что созданная задача —
// если она не попадает в активный вид, экран задач переключает его, иначе задача «пропадает»
// (создал без срока → вернулся в «Сегодня» → пусто; найдено аудитом мобилки 2026-08-22).
// Период прокидывается насквозь: с включённым «Эта неделя» задача вне диапазона так же невидима.
export function matchesList(task: Task, listId: SmartListId, now: Date = new Date(), range: DateRange | null = null): boolean {
  return inList(task, listId, now, range);
}

function inList(task: Task, listId: SmartListId, now: Date, range: DateRange | null = null): boolean {
  if (!inPeriod(task, listId, range)) return false;
  if (listId === "done") return isDone(task);
  if (isDone(task)) return false; // все остальные списки — только незавершённое
  const today = midnight(now);
  const due = dueMidnight(task);
  switch (listId) {
    case "today":
      return due != null && due <= today;
    case "upcoming":
      return due != null && due > today;
    case "recurring":
      // Регулярные НЕ убираются из остальных списков (решение владельца 2026-08-27): задача
      // с сегодняшним сроком по-прежнему видна в «Сегодня», здесь она показана дополнительно.
      return isRecurring(task);
    case "all":
      return true;
  }
}

function sorterFor(listId: SmartListId): (a: Task, b: Task) => number {
  if (listId === "done") return byUpdatedDesc;
  return chain(byDueAsc, byPriorityDesc, byCreatedDesc); // today / upcoming / all
}

// Отфильтрованный и отсортированный список задач для смарт-списка под линзой.
export function filterTasks(tasks: Task[], listId: SmartListId, lens: Lens, me: Me | null, now: Date = new Date(), range: DateRange | null = null): Task[] {
  return tasks
    .filter((t) => matchesLens(t, lens, me) && inList(t, listId, now, range))
    .sort(sorterFor(listId));
}

// Счётчики для всех списков (для рельса/чипов).
export function countLists(tasks: Task[], lens: Lens, me: Me | null, now: Date = new Date(), range: DateRange | null = null): Record<SmartListId, number> {
  const counts = {} as Record<SmartListId, number>;
  for (const def of SMART_LISTS) {
    counts[def.id] = tasks.filter((t) => matchesLens(t, lens, me) && inList(t, def.id, now, range)).length;
  }
  return counts;
}

export type MarketGroup = { country: string | null; label: string; tasks: Task[] };

// Бакетирует УЖЕ отфильтрованный список по рынку — общий слой для groupByMarket (плоская
// группировка) и groupByAssigneeThenMarket (вложенная, ниже) — DRY, своей фильтрации нет.
function bucketByMarket(inScope: Task[]): MarketGroup[] {
  const map = new Map<string | null, Task[]>();
  for (const t of inScope) {
    // Нормализуем страну к ISO-коду (countryCode): иначе «SI» и «Словения» (или «RS»/«Сербия»)
    // попадают в РАЗНЫЕ группы — один рынок задваивается. Код объединяет любые формы записи.
    const key = t.country && t.country !== "—" ? countryCode(t.country) : null;
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  return [...map.entries()]
    .map(([country, list]) => ({ country, label: country ?? "Без рынка", tasks: list }))
    .sort((a, b) => {
      if (a.country === null) return 1;
      if (b.country === null) return -1;
      if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
      return a.label.localeCompare(b.label);
    });
}

// Группировка задач АКТИВНОГО смарт-списка ПОД ТЕКУЩЕЙ линзой по рынку — тумблер "По рынкам"
// (владелец 2026-08-19: должен группировать ТО, что уже выбрано, "Мои"/"Команда" тоже, не
// только "Все"). Для "показать буквально всех" линзу переопределяет вызывающий (effectiveLens
// в useReminderTasks, когда включён отдельный тумблер "Все сотрудники").
export function groupByMarket(tasks: Task[], listId: SmartListId, lens: Lens, me: Me | null, now: Date = new Date(), range: DateRange | null = null): MarketGroup[] {
  return bucketByMarket(filterTasks(tasks, listId, lens, me, now, range));
}

export type StaffGroup = { name: string; label: string; tasks: Task[] };

// Группировка задач АКТИВНОГО смарт-списка по ИСПОЛНИТЕЛЮ — все владельцы (админский вид «все сотрудники»).
// Задача с несколькими исполнителями попадает в секцию каждого (полная картина «у кого что»).
// Без исполнителя → «Без исполнителя», в конец. Группы по убыванию размера, затем по имени.
export function groupByAssignee(tasks: Task[], listId: SmartListId, lens: Lens, me: Me | null, now: Date = new Date(), range: DateRange | null = null): StaffGroup[] {
  const inScope = filterTasks(tasks, listId, lens, me, now, range);
  const NONE = " none";
  const map = new Map<string, Task[]>();
  for (const t of inScope) {
    const names = (t.assignees ?? []).filter(Boolean);
    const keys = names.length ? names : [NONE];
    for (const k of keys) {
      const bucket = map.get(k);
      if (bucket) bucket.push(t);
      else map.set(k, [t]);
    }
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, label: name === NONE ? "Без исполнителя" : name, tasks: list }))
    .sort((a, b) => {
      if (a.name === NONE) return 1;
      if (b.name === NONE) return -1;
      if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
      return a.label.localeCompare(b.label);
    });
}

export type NestedStaffGroup = StaffGroup & { marketGroups: MarketGroup[] };

// Оба тумблера разом ("Все сотрудники" + "По рынкам"): сначала по сотруднику, внутри каждого -
// по рынку (владелец: "группировка по сотруднику, а под ней - по рынкам"). Независимые измерения
// одной и той же задачи - конфликта нет, задача просто попадает в [свой исполнитель][свой рынок].
export function groupByAssigneeThenMarket(tasks: Task[], listId: SmartListId, lens: Lens, me: Me | null, now: Date = new Date(), range: DateRange | null = null): NestedStaffGroup[] {
  return groupByAssignee(tasks, listId, lens, me, now, range)
    .map((sg) => ({ ...sg, marketGroups: bucketByMarket(sg.tasks) }));
}

// ── Персональные смарт-метки (личные списки) ────────────────────────────────
// Список метки авто-собирает незавершённые задачи с этой меткой. Сортировка — как today/upcoming/all.
export function filterByLabel(tasks: Task[], labelId: string, range: DateRange | null = null): Task[] {
  return tasks
    .filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false) && inRange(dayOf(t.due_date), range))
    .sort(chain(byDueAsc, byPriorityDesc, byCreatedDesc));
}

export function countByLabel(tasks: Task[], labelId: string, range: DateRange | null = null): number {
  return tasks.filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false) && inRange(dayOf(t.due_date), range)).length;
}
