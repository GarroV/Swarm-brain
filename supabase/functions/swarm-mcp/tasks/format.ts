// Форматирование ответов MCP по задачам и доскам. Чистые функции без сети — здесь живёт всё,
// что агент читает глазами, поэтому оно тестируется отдельно от резолва и запросов (format.test.ts).
//
// Правило этого файла: ответ обязан говорить, ЧТО получилось, а не «✅ готово». Молчаливый
// успех дороже ошибки — агент докладывает владельцу неправду и уходит дальше (issue #201).

export type ProjectTreeRow = {
  id: string;
  name: string;
  parent_id: string | null;
  task_count: number;
  backlog_count: number;
};

const line = (r: ProjectTreeRow, indent: string) =>
  `${indent}• ${r.name} (id: ${r.id}) — задач: ${r.task_count}, в бэклоге: ${r.backlog_count}`;

/**
 * Дерево досок воркспейса: проект → его подпроекты (issue #198). Порядок верхнего уровня —
 * как пришёл из listProjects (created_at), подпроекты идут сразу за своим родителем.
 *
 * Подпроект с недоступным родителем (родитель закрыт тумблером-глазом и отфильтрован
 * `canViewProject`) печатается верхним уровнем: потерять его молча нельзя — задачи в нём
 * человеку видны, и агент должен уметь туда положить.
 */
export function formatProjectTree(rows: ProjectTreeRow[]): string {
  if (!rows.length) return "В воркспейсе нет проектов, доступных тебе.";

  const ids = new Set(rows.map((r) => r.id));
  const kidsOf = new Map<string, ProjectTreeRow[]>();
  const roots: ProjectTreeRow[] = [];
  for (const r of rows) {
    if (r.parent_id && ids.has(r.parent_id)) {
      const kids = kidsOf.get(r.parent_id) ?? [];
      kids.push(r);
      kidsOf.set(r.parent_id, kids);
    } else {
      roots.push(r);
    }
  }

  const out: string[] = [];
  for (const root of roots) {
    out.push(line(root, ""));
    for (const kid of kidsOf.get(root.id) ?? []) out.push(line(kid, "  "));
  }
  return out.join("\n");
}

/**
 * Проект под фильтр не нашёлся (issue #199). Раньше фильтр молча игнорировался и агент получал
 * ВСЮ доску, считая её содержимым проекта — «проект не найден» было неотличимо от «в проекте
 * столько задач». Поэтому здесь отказ, а не выдача.
 */
export function projectNotFoundMessage(name: string, available: string[]): string {
  const head = `Проект «${name}» не найден — фильтр НЕ применён, задачи не показаны.`;
  const tail = "Полное дерево проектов и подпроектов с id — инструмент get_projects.";
  if (!available.length) return `${head} В воркспейсе нет проектов, доступных тебе. ${tail}`;
  return `${head} Доступные проекты: ${available.join(", ")}. ${tail}`;
}

/**
 * Строка задачи в выдаче get_tasks. `confirmed: false` помечается явно: такая задача не видна
 * НИГДЕ в вебе (`fetchTasks` всегда просит `confirmed=true`), и без пометки агент видит «open»
 * и считает, что задача на доске (issue #201).
 */
export function formatTaskLine(t: {
  status: string;
  title: string;
  assignees?: string[] | null;
  due_date?: string | null;
  country?: string | null;
  confirmed?: boolean;
}): string {
  const who = t.assignees?.join(", ") || "—";
  const due = t.due_date ? ` | дедлайн: ${t.due_date}` : "";
  const country = t.country ? ` | ${t.country}` : "";
  const pending = t.confirmed === false ? " ⏳ на проверке (в вебе не видна)" : "";
  return `• [${t.status}] ${t.title}${pending}\n  Исполнитель: ${who}${due}${country}`;
}

/**
 * Итог add_task. Дефолт — задача сразу на доске (решение владельца 2026-09-03), поэтому в
 * обычном пути про Telegram-бота не сказано ни слова: уводить человека в бота за подтверждением
 * своей же задачи — тупик, особенно для того, кто задачи в телеграме не ведёт.
 * Про бота говорим только когда задачу осознанно положили в очередь `confirmed: false` — там он
 * действительно единственный вход, очереди задач в вебе нет.
 */
export function addTaskOutcome(o: { id: string; confirmed: boolean; warning?: string }): string {
  const w = o.warning ?? "";
  if (o.confirmed) return `✅ Задача создана и уже на доске (id: ${o.id})${w}.`;
  return `✅ Задача создана, но ЖДЁТ ПОДТВЕРЖДЕНИЯ (id: ${o.id})${w}. ` +
    "В вебе её не видно — очередь «На проверке» есть только в Telegram-боте (/tasks → ⏳ На проверке). " +
    "Чтобы задача сразу попадала на доску, создавай её без confirmed: false.";
}
