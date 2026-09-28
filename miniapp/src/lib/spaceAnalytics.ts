// Аналитика пространства — семь таблиц эталона, собранных чистыми функциями.
//
// Почему отдельным модулем и под тестами: это единственные числа продукта, которые человек
// читает как ФАКТ о работе команды, и ошибка в них молчит. Неверный процент выглядит так же,
// как верный, и спорить с ним никто не станет — его просто перескажут на встрече.
//
// Правила счёта те же, что у списка и у серверных итогов: отменённая задача вне процента и
// вне знаменателя (D010), упоминание удалённой не считается нигде, «переносилась раз» —
// из `carry_count` (D012).
import type {
  CheckStatus,
  Project,
  SprintCycle,
  SprintCycleDetail,
  SprintCycleItem,
  Task,
} from "@/types";
import { computeProgress, spaceProjects } from "@/lib/initiatives";

export interface SprintHistoryRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  done: number;
  total: number;
  percent: number;
  /** Взятое сверх плана: скрывать его нельзя, но и в процент плана оно не входит. */
  extra: number;
  extraDone: number;
  carried: number;
  cancelled: number;
}

export interface RiskRow {
  title: string;
  person: string | null;
  status: CheckStatus;
  note: string | null;
  project: string | null;
}

export interface CarryRow {
  title: string;
  reason: string | null;
  /** Сколько раз задача уже переезжала — ради этой колонки таблица и заводится (D012). */
  count: number;
}

export interface InitiativeRow {
  direction: string;
  initiative: string;
  owner: number | null;
  done: number;
  total: number;
  percent: number;
  end_date: string | null;
  overdue: boolean;
}

export interface PersonRow {
  /** null — «без исполнителя»: строка нужна, это дыра в планировании. */
  person: string | null;
  total: number;
  done: number;
  percent: number;
  risk: number;
  problem: number;
  unchecked: number;
  carried: number;
}

export interface OverdueRow {
  title: string;
  person: string | null;
  due_date: string;
  daysLate: number;
  project: string | null;
}

export interface CurrentRow {
  name: string;
  done: number;
  total: number;
  percent: number;
  cancelled: number;
  risk: number;
  problem: number;
  unchecked: number;
  toCarry: number;
}

export interface SpaceReport {
  history: SprintHistoryRow[];
  current: CurrentRow | null;
  risks: RiskRow[];
  carries: CarryRow[];
  initiatives: InitiativeRow[];
  people: PersonRow[];
  overdue: OverdueRow[];
}

export interface SpaceReportInput {
  cycles: readonly SprintCycle[];
  current: SprintCycleDetail | null;
  projects: readonly Project[];
  tasks: readonly Task[];
  /** Пространство, для которого считаем просрочку и инициативы; null — «Без вкладки». */
  space?: string | null;
  today?: Date;
}

const CLOSED = new Set(["done", "cancelled"]);

/** Живое и не отменённое — то, что вообще участвует в проценте. */
function counted(items: readonly SprintCycleItem[]): SprintCycleItem[] {
  return items.filter((i) => !i.removed && i.status !== "cancelled");
}

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(fromISO: string, today: Date): number {
  const day = new Date(`${fromISO}T00:00:00`);
  if (isNaN(day.getTime())) return 0;
  return Math.round((startOfDay(today) - day.getTime()) / 86_400_000);
}

export function buildSpaceReport(input: SpaceReportInput): SpaceReport {
  const today = input.today ?? new Date();
  const items = input.current?.items ?? [];
  const live = counted(items);
  const projectName = (id: string | null) =>
    id ? input.projects.find((p) => p.id === id)?.name ?? null : null;

  // История — только принятые: у незакрытого спринта итогов ещё нет, и строка в таблице
  // была бы враньём, а не «пока пусто».
  const history: SprintHistoryRow[] = input.cycles
    .filter((c) => c.status === "accepted" && c.stats)
    .map((c) => {
      const s = c.stats!;
      return {
        id: c.id,
        name: c.name,
        start_date: c.start_date,
        end_date: c.end_date,
        // Процент — СОХРАНЁННЫЙ на приёмке, а не пересчитанный здесь по-своему. Иначе архив
        // спорил бы с отчётом того же спринта, и человек не узнал бы, какому числу верить.
        done: s.planDone,
        total: s.plan,
        percent: s.planPercent,
        extra: s.extra,
        extraDone: s.extraDone,
        carried: s.carried,
        cancelled: s.cancelled,
      };
    })
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  const checks = (s: CheckStatus) =>
    live.filter((i) => i.check_status === s).length;
  const current: CurrentRow | null = input.current
    ? {
      name: input.current.name,
      done: live.filter((i) => i.status === "done").length,
      total: live.length,
      percent: pct(live.filter((i) => i.status === "done").length, live.length),
      cancelled:
        items.filter((i) => !i.removed && i.status === "cancelled").length,
      risk: checks("risk"),
      problem: checks("problem"),
      unchecked: live.filter((i) => i.check_status === null).length,
      toCarry: live.filter((i) => i.to_carry).length,
    }
    : null;

  // Риски: проблема выше риска — читают сверху вниз, и первым должно идти то, что горит.
  const risks: RiskRow[] = live
    .filter((i) => i.check_status === "risk" || i.check_status === "problem")
    .map((i) => ({
      title: i.title,
      person: i.assignees[0] ?? null,
      status: i.check_status as CheckStatus,
      note: i.check_note,
      project: i.project ?? projectName(i.project_id),
    }))
    .sort((
      a,
      b,
    ) => (a.status === b.status ? 0 : a.status === "problem" ? -1 : 1));

  const carries: CarryRow[] = live
    .filter((i) => i.carry_count > 0)
    .map((i) => ({
      title: i.title,
      reason: i.carry_reason,
      count: i.carry_count,
    }))
    .sort((a, b) => b.count - a.count);

  // По людям: задача с двумя исполнителями считается КАЖДОМУ. Делить её пополам значило бы
  // придумать число, которого никто не называл; строка «сколько на человеке» честнее.
  const byPerson = new Map<string | null, SprintCycleItem[]>();
  for (const i of live) {
    const people: (string | null)[] = i.assignees.length === 0
      ? [null]
      : i.assignees;
    for (const p of people) {
      if (!byPerson.has(p)) byPerson.set(p, []);
      byPerson.get(p)!.push(i);
    }
  }
  const people: PersonRow[] = [...byPerson.entries()]
    .map(([person, rows]) => ({
      person,
      total: rows.length,
      done: rows.filter((i) => i.status === "done").length,
      percent: pct(rows.filter((i) => i.status === "done").length, rows.length),
      risk: rows.filter((i) => i.check_status === "risk").length,
      problem: rows.filter((i) => i.check_status === "problem").length,
      unchecked: rows.filter((i) => i.check_status === null).length,
      carried: rows.filter((i) => i.carry_count > 0).length,
    }))
    .sort((a, b) => {
      if (a.person === null) return 1;
      if (b.person === null) return -1;
      return a.person.localeCompare(b.person);
    });

  // Инициативы и просрочка считаются от ЗАДАЧ пространства, а не от состава спринта: вопрос
  // «где мы по инициативам» шире одного спринта.
  const ownIds = spaceProjects(input.projects, input.space ?? "tab1");
  const spaceTasks = input.tasks.filter((t) =>
    t.project_id !== null && ownIds.has(t.project_id)
  );

  const initiatives: InitiativeRow[] = input.projects
    .filter((p) => p.parent_id !== null && ownIds.has(p.id))
    .map((p) => {
      const rows = spaceTasks.filter((t) => t.project_id === p.id);
      const progress = computeProgress(rows);
      return {
        direction: input.projects.find((d) => d.id === p.parent_id)?.name ??
          "—",
        initiative: p.name,
        owner: p.owner_telegram_id,
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
        end_date: p.end_date,
        overdue: !!p.end_date && daysBetween(p.end_date, today) > 0 &&
          progress.done < progress.total,
      };
    })
    .sort((a, b) =>
      a.direction.localeCompare(b.direction) ||
      a.initiative.localeCompare(b.initiative)
    );

  const overdue: OverdueRow[] = spaceTasks
    .filter((t) =>
      !!t.due_date && !CLOSED.has(t.status) &&
      daysBetween(t.due_date, today) > 0
    )
    .map((t) => ({
      title: t.title,
      person: t.assignees[0] ?? null,
      due_date: t.due_date as string,
      daysLate: daysBetween(t.due_date as string, today),
      project: projectName(t.project_id),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);

  return { history, current, risks, carries, initiatives, people, overdue };
}

/** Строка таблицы markdown: символ `|` в тексте ломает таблицу, поэтому экранируем. */
function cell(v: string | number | null): string {
  return String(v ?? "—").replaceAll("|", "\\|");
}

function table(
  title: string,
  head: string[],
  rows: (string | number | null)[][],
): string {
  // Пустую таблицу не печатаем: читать в ней нечего, а место и внимание она занимает.
  if (rows.length === 0) return "";
  const line = (cells: (string | number | null)[]) =>
    `| ${cells.map(cell).join(" | ")} |`;
  return [
    `## ${title}`,
    "",
    line(head),
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
    "",
  ].join("\n");
}

/** Итоги пространства одним markdown — его кладут в буфер и вставляют в переписку. */
export function spaceReportMarkdown(r: SpaceReport, spaceName: string): string {
  const parts = [
    `# ${spaceName}`,
    "",
    r.current
      ? `**${r.current.name}** — ${r.current.done}/${r.current.total} · ${r.current.percent}%` +
        (r.current.risk ? `, риск ${r.current.risk}` : "") +
        (r.current.problem ? `, проблема ${r.current.problem}` : "") +
        (r.current.cancelled ? `, отменено ${r.current.cancelled}` : "") + "\n"
      : "",
    table(
      "История спринтов",
      ["Спринт", "Даты", "План", "%", "Сверх плана", "Перенесено", "Отменено"],
      r.history.map((
        h,
      ) => [
        h.name,
        `${h.start_date} — ${h.end_date}`,
        `${h.done}/${h.total}`,
        h.percent,
        `${h.extraDone}/${h.extra}`,
        h.carried,
        h.cancelled,
      ]),
    ),
    table(
      "Риски",
      ["Задача", "Кто", "Состояние", "Комментарий"],
      r.risks.map((
        x,
      ) => [
        x.title,
        x.person,
        x.status === "problem" ? "проблема" : "риск",
        x.note,
      ]),
    ),
    table(
      "Причины переносов",
      ["Задача", "Переносилась раз", "Причина"],
      r.carries.map((c) => [c.title, c.count, c.reason]),
    ),
    table(
      "По инициативам",
      ["Направление", "Инициатива", "Сделано", "%", "До", "Просрочена"],
      r.initiatives.map((
        i,
      ) => [
        i.direction,
        i.initiative,
        `${i.done}/${i.total}`,
        i.percent,
        i.end_date,
        i.overdue ? "да" : "",
      ]),
    ),
    table(
      "По людям",
      [
        "Кто",
        "Сделано",
        "%",
        "Риск",
        "Проблема",
        "Не отмечено",
        "Переносилось",
      ],
      r.people.map((
        p,
      ) => [
        p.person ?? "без исполнителя",
        `${p.done}/${p.total}`,
        p.percent,
        p.risk,
        p.problem,
        p.unchecked,
        p.carried,
      ]),
    ),
    table(
      "Просрочка",
      ["Задача", "Кто", "Срок", "Дней"],
      r.overdue.map((o) => [o.title, o.person, o.due_date, o.daysLate]),
    ),
  ];
  return parts.filter((p) => p !== "").join("\n");
}
