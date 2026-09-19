// Доска инициатив: дерево «направление → инициатива → задачи» и цифры её шапки.
//
// Чистыми функциями и отдельным файлом — потому что это единственное место, где веб СЧИТАЕТ,
// а не показывает. Всё остальное на экране можно проверить глазами; неверный процент выглядит
// ровно так же, как верный, поэтому он под тестами.
//
// Правила счёта — те же, что у серверных итогов (`_shared/tasks/sprint-stats.ts`): отменённые
// вне процента и вне знаменателя, упоминания удалённых задач не считаются, приватная чужая
// задача остаётся в счёте строкой без содержимого. Если шапка начнёт считать по-своему,
// человек увидит два разных факта об одном спринте.
import type { Project, SprintCycleItem } from "@/types";

/** Сделано из закрываемых. `percent` округляется к ближайшему целому. */
export interface Progress {
  total: number;
  done: number;
  percent: number;
}

/**
 * Минимум, который дереву нужно от строки. Доска собирается и из состава спринта, и из
 * обычных задач («Все инициативы»), а правило раскладки у них одно — значит и код один.
 * `removed` есть только у состава: у задачи его нет, и `undefined` читается как «не удалена».
 */
export interface BoardRow {
  id: string;
  status: string;
  project_id: string | null;
  removed?: boolean;
}

/** Инициатива внутри направления. `project: null` — задачи, лежащие прямо на направлении. */
export interface InitiativeNode<T extends BoardRow = SprintCycleItem> {
  project: Project | null;
  items: T[];
  progress: Progress;
}

/** Направление — проект верхнего уровня. `project: null` — задачи вообще без проекта. */
export interface DirectionNode<T extends BoardRow = SprintCycleItem> {
  project: Project | null;
  initiatives: InitiativeNode<T>[];
  progress: Progress;
}

export interface SprintKpi extends Progress {
  /** Отменённые: отдельной цифрой, вне процента (решение владельца 18.09.2026). */
  cancelled: number;
  /** Упоминания удалённых задач: в составе видны, в счёте не участвуют. */
  removed: number;
  checkOk: number;
  checkRisk: number;
  checkProblem: number;
  /** Живые задачи без отметки сверки — человек промолчал. */
  unchecked: number;
  /** Помечены «к переносу» вручную. */
  toCarry: number;
  unassigned: number;
}

/** Строка-упоминание удалённой задачи: самой задачи нет, в счёт она не идёт. */
function isMention(i: BoardRow): boolean {
  return i.removed === true;
}

/** То, что вообще участвует в проценте: живое и не отменённое. */
function counted<T extends BoardRow>(items: readonly T[]): T[] {
  return items.filter((i) => !isMention(i) && i.status !== "cancelled");
}

export function computeProgress(items: readonly BoardRow[]): Progress {
  const live = counted(items);
  const done = live.filter((i) => i.status === "done").length;
  return {
    total: live.length,
    done,
    percent: live.length === 0 ? 0 : Math.round((done / live.length) * 100),
  };
}

export function sprintKpi(items: readonly SprintCycleItem[]): SprintKpi {
  const live = counted(items);
  const check = (s: string) => live.filter((i) => i.check_status === s).length;
  return {
    ...computeProgress(items),
    cancelled:
      items.filter((i) => !isMention(i) && i.status === "cancelled").length,
    removed: items.filter(isMention).length,
    checkOk: check("ok"),
    checkRisk: check("risk"),
    checkProblem: check("problem"),
    unchecked: live.filter((i) => i.check_status === null).length,
    toCarry: live.filter((i) => i.to_carry).length,
    unassigned: live.filter((i) => i.assignees.length === 0).length,
  };
}

/** Порядок внутри уровня: по имени, безымянная группа («Общее», «Без направления») — с краю. */
function byName(
  a: { project: Project | null },
  b: { project: Project | null },
): number {
  if (a.project === null) return -1;
  if (b.project === null) return 1;
  return a.project.name.localeCompare(b.project.name);
}

/**
 * Собирает состав спринта в дерево доски.
 *
 * Задача попадает под инициативу, если её проект — подпроект; если проект верхнего уровня,
 * задача идёт прямо под направление (узел `project: null`, как «Общее» на доске проектов).
 * Неизвестный проект — не повод потерять задачу: такая строка уходит в «Без направления».
 * Пустых направлений на доске нет: доска спринта про то, что в работе сейчас.
 */
export function buildBoard<T extends BoardRow>(
  items: readonly T[],
  projects: readonly Project[],
): DirectionNode<T>[] {
  const byId = new Map(projects.map((p) => [p.id, p]));

  // directionId → initiativeId → строки. null-ключ кодируем пустой строкой: Map различает
  // null и "" , а собирать ключи строками проще, чем держать два параллельных хранилища.
  const tree = new Map<string, Map<string, T[]>>();

  for (const item of items) {
    const project = item.project_id === null
      ? undefined
      : byId.get(item.project_id);
    const direction = project === undefined
      ? null
      : project.parent_id === null
      ? project
      : byId.get(project.parent_id) ?? null;
    const initiative = project !== undefined && project.parent_id !== null
      ? project
      : null;

    const dirKey = direction?.id ?? "";
    const iniKey = initiative?.id ?? "";
    if (!tree.has(dirKey)) tree.set(dirKey, new Map());
    const inner = tree.get(dirKey)!;
    if (!inner.has(iniKey)) inner.set(iniKey, []);
    inner.get(iniKey)!.push(item);
  }

  const directions: DirectionNode<T>[] = [];
  for (const [dirKey, inner] of tree) {
    const initiatives: InitiativeNode<T>[] = [];
    for (const [iniKey, rows] of inner) {
      initiatives.push({
        project: iniKey === "" ? null : byId.get(iniKey) ?? null,
        items: rows,
        progress: computeProgress(rows),
      });
    }
    initiatives.sort(byName);
    const all = initiatives.flatMap((i) => i.items);
    directions.push({
      project: dirKey === "" ? null : byId.get(dirKey) ?? null,
      initiatives,
      progress: computeProgress(all),
    });
  }

  // «Без направления» — последним: это не направление, а остаток, и наверху он мешает читать.
  directions.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return a.project.name.localeCompare(b.project.name);
  });
  return directions;
}

/**
 * Та же доска, но сгруппированная ПО ЛЮДЯМ: направление — человек, задачи лежат прямо на
 * нём. Нужна для обхода на встрече (идём по человеку, а не по проекту) — раньше ради этого
 * был отдельный экран сверки; после переезда отметок в строку (владелец 19.09.2026) это
 * просто вторая группировка того же списка.
 *
 * Задача с двумя исполнителями попадает к обоим: на обходе про неё спросят обоих, и
 * «показать только первому» означало бы, что второй её не увидит.
 */
export function buildPeopleBoard<T extends BoardRow & { assignees: string[] }>(
  items: readonly T[],
): DirectionNode<T>[] {
  const byPerson = new Map<string, T[]>();
  for (const item of items) {
    // Без исполнителя — тоже группа, причём та, ради которой обход и затевают.
    const names = item.assignees.length > 0 ? item.assignees : [""];
    for (const name of names) {
      if (!byPerson.has(name)) byPerson.set(name, []);
      byPerson.get(name)!.push(item);
    }
  }

  const nodes: DirectionNode<T>[] = [];
  for (const [name, rows] of byPerson) {
    nodes.push({
      project: name === "" ? null : personProject(name),
      initiatives: [{
        project: null,
        items: rows,
        progress: computeProgress(rows),
      }],
      progress: computeProgress(rows),
    });
  }
  // «Без исполнителя» — последним, как и «Без направления»: это остаток, а не человек.
  nodes.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return a.project.name.localeCompare(b.project.name);
  });
  return nodes;
}

/**
 * Человек в роли направления. Настоящим проектом он не является и в базу не попадает —
 * это подпись группы, поэтому идентификатор с префиксом `person:`: если такой id когда-то
 * утечёт в запрос, он не совпадёт ни с одним проектом, вместо тихой подмены чужого.
 */
function personProject(name: string): Project {
  return {
    id: `person:${name}`,
    group_id: "",
    name,
    color: null,
    emoji: null,
    parent_id: null,
    sprint_id: null,
    created_by: null,
    created_at: "",
    is_private: false,
    owner_telegram_id: null,
    start_date: null,
    end_date: null,
  };
}

/**
 * Пора ли считать молчание сигналом. С дня сверки неотмеченная задача помечается «не
 * отмечено» (D013): молчание не должно выглядеть как отсутствие проблем.
 *
 * Правило живёт здесь, а не в экране, по той же причине, что и проценты: «с какого дня»
 * — это правило продукта, и в двух экранах оно разъедется. Сравниваем по КАЛЕНДАРНОМУ
 * дню: день сверки наступает с его начала, а не в момент, когда пройдут ещё сутки.
 * Негодная дата сигнал не включает — лучше промолчать, чем пометить всю доску серым.
 */
export function checksDue(
  checkDate: string | null,
  today: Date = new Date(),
): boolean {
  if (!checkDate) return false;
  const day = new Date(`${checkDate}T00:00:00`);
  if (isNaN(day.getTime())) return false;
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return day.getTime() <= start.getTime();
}

/**
 * Проекты пространства: сам проект держит вкладку в `sprint_id`, подпроект наследует её у
 * родителя (у подпроекта своё поле обычно пустое). Возвращает МНОЖЕСТВО id — им фильтруют
 * задачи для «Всех инициатив».
 *
 * Правило под тестами не из педантизма: ошибка здесь молчит и показывает чужую стройку как
 * свою — экран выглядит рабочим, просто в нём не то, что человек думает.
 */
export function spaceProjects(
  projects: readonly Project[],
  spaceId: string | null,
): Set<string> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const tabOf = (p: Project): string | null =>
    p.parent_id === null
      ? p.sprint_id
      : byId.get(p.parent_id)?.sprint_id ?? null;
  // `null` — законное пространство «Без вкладки», а не «ничего»: проекты, не привязанные ни
  // к одной вкладке, иначе не видно нигде.
  return new Set(projects.filter((p) => tabOf(p) === spaceId).map((p) => p.id));
}

/**
 * У направления нет инициатив — только задачи, лежащие прямо на нём. Такое направление
 * рисуется без обёртки «Общее»: строка с теми же цифрами, что у направления, ничего не
 * добавляет и прячет задачи за лишний клик.
 */
export function isBareDirection(dir: DirectionNode<BoardRow>): boolean {
  return dir.initiatives.length === 1 && dir.initiatives[0].project === null;
}
