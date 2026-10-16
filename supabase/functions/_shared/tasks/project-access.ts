// Единственный источник правды о доступе к ПРОЕКТУ (секции доски задач).
//
// Зачем отдельный модуль. Правило «что считать приватным проектом» было написано руками в
// трёх местах и в одном из них отсутствовало вовсе (issue #37): `listProjects` фильтровала,
// `canMutateProject` повторяла ту же строчку, а `matchProject` в swarm-mcp резолвила имя
// проекта в id вообще без проверки — через Claude можно было найти чужой скрытый проект по
// имени и положить в него задачу. Второго слоя нет по устройству: всё ходит SERVICE_ROLE_KEY,
// RLS не механизм авторизации, — поэтому пропущенная проверка сразу даёт доступ.
//
// Отличие от задач (`access.ts`): у проекта нет `owner_id`, владение определяется `created_by`,
// а приватность управляется тумблером-глазом и наследуется вниз по дереву (см. ниже).

export type ProjectAccessRow = {
  parent_id: string | null;
  created_by: number | null;
  is_private: boolean;
};

// Индекс `id → строка` по всем проектам воркспейса: нужен, чтобы дойти от подпроекта до его
// группы. Строится один раз на запрос — вызывающий и так держит весь список.
export type ProjectIndex = Map<string, ProjectAccessRow>;

export function parentLookup(
  rows: Array<ProjectAccessRow & { id: string }>,
): ProjectIndex {
  return new Map(
    rows.map((
      r,
    ) => [r.id, {
      parent_id: r.parent_id,
      created_by: r.created_by,
      is_private: r.is_private,
    }]),
  );
}

// Ровно 2 уровня по устройству доски (DB-гард, migration 20260812140000), но обход всё равно
// с потолком: испорченные данные (цикл parent_id) не должны вешать запрос.
const MAX_DEPTH = 8;

// Доска — ОБЩЕЕ пространство команды (решение владельца 2026-08-24): проект и подпроект по
// умолчанию видны всем в воркспейсе. Прячет только тумблер-глаз, и он наследуется ВНИЗ:
//  • закрыт проект   → закрыты все его подпроекты («если проект закрыт, значит и подпроекты»);
//  • закрыт подпроект → закрыт только он сам, соседи и группа остаются общими.
// До 2026-08-24 приватным считался ЛЮБОЙ подпроект (`parent_id ≠ null`) — из-за этого руководитель
// не видел рабочие подпроекты по сотрудникам, а сам флаг `is_private` на подпроекте не работал
// (issue #86). Тумблер на подпроекте — замена той автоматике.
export function isProjectPrivate(
  row: ProjectAccessRow,
  index: ProjectIndex,
): boolean {
  let cur: ProjectAccessRow | undefined = row;
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    if (cur.is_private) return true;
    if (cur.parent_id === null) return false;
    cur = index.get(cur.parent_id);
  }
  // Родитель не найден (или цикл) — приватность строки неизвестна. Считаем закрытой:
  // показать лишнее хуже, чем не показать (fail-closed, как и без личности зрителя).
  return true;
}

// Кто видит строку. Открытая — весь воркспейс; закрытая — только тот, кто её закрыл.
// `created_by = null` (легаси-строка или системное создание без юзера) НЕ прячем ни от кого:
// молча потерять доступ к «ничейной» строке хуже, чем показать её лишний раз.
//
// Админского обхода нет намеренно — решение владельца 2026-08-21
// (`docs/decisions/2026-08-21-admin-visibility.md`): руководитель видит РАБОТУ сотрудника
// (задачи), но не его личное. Закрытый проект — личное.
//
// Тот же критерий работает и на мутацию: открытую строку правит любой участник (решение
// 2026-07-01), закрытую — только автор. Поэтому отдельной canMutate нет — иначе две функции
// снова разъедутся, как разъехались три рукописные копии.
export function canViewProject(
  row: ProjectAccessRow,
  viewerId: number | undefined,
  index: ProjectIndex,
): boolean {
  let cur: ProjectAccessRow | undefined = row;
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    // Закрытая строка на любом уровне цепочки рубит доступ, если зритель не её автор:
    // подпроект внутри чужой закрытой группы закрыт даже для того, кто создал сам подпроект.
    if (
      cur.is_private && cur.created_by !== null && cur.created_by !== viewerId
    ) return false;
    if (cur.parent_id === null) return true;
    cur = index.get(cur.parent_id);
  }
  return false; // родитель не найден или цикл — fail-closed, как в isProjectPrivate
}

export type ProjectNameRow = ProjectAccessRow & { id: string; name: string };

// Резолв имени проекта в id — чистая часть, вынесена ради тестов. `rows` — ВСЕ строки
// воркспейса (из них же строится индекс родителей: без группы приватность подпроекта не вычислить).
//
// КРИТИЧНО (issue #37): сначала отсекаем невидимые зрителю строки и только потом ищем по имени.
// Раньше фильтра не было вовсе: чужой закрытый проект резолвился по имени, и через MCP в него
// можно было положить задачу — а сам факт совпадения имени уже подтверждал, что такой проект
// существует. Невидимая строка не должна ни матчиться, ни участвовать в подсчёте неоднозначности.
export function pickProjectByName(
  rows: ProjectNameRow[],
  name: string,
  viewerId: number | undefined,
): { id: string; ambiguous: boolean } | null {
  const index = parentLookup(rows);
  const visible = rows.filter((p) => canViewProject(p, viewerId, index));
  if (!visible.length) return null;
  const lower = name.trim().toLowerCase();
  const exact = visible.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return { id: exact[0].id, ambiguous: false };
  if (exact.length > 1) return { id: exact[0].id, ambiguous: true };
  const partial = visible.filter((p) => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return { id: partial[0].id, ambiguous: false };
  if (partial.length > 1) return { id: partial[0].id, ambiguous: true };
  return null;
}

// Имена проектов, видимых зрителю — тем же предикатом, что и резолв по имени. Нужен, чтобы
// отказ «проект не найден» мог перечислить, что вообще есть (issue #199): без списка агент
// перебирает имена вслепую, а закрытый проект в подсказку попасть не должен.
export function visibleProjectNames(
  rows: ProjectNameRow[],
  viewerId: number | undefined,
): string[] {
  const index = parentLookup(rows);
  return rows.filter((p) => canViewProject(p, viewerId, index)).map((p) => p.name);
}

// Проекты, которые зрителю НЕ видны, — тем же предикатом canViewProject. Нужен читателям
// ЗАДАЧ: задача закрытого проекта видна только тому, кто видит сам проект (решение владельца
// 16.10.2026, docs/decisions/2026-10-16-security-fixes.md). Список «скрытых», а не «видимых»:
// задача без проекта видна всем, и фильтр выборки — «project_id пуст или не из этого списка».
// `rows` — ВСЕ строки воркспейса, включая архивные: архивный закрытый проект свои задачи
// прячет так же, как живой.
export function hiddenProjectIds(
  rows: Array<ProjectAccessRow & { id: string }>,
  viewerId: number | undefined,
): string[] {
  const index = parentLookup(rows);
  return rows.filter((p) => !canViewProject(p, viewerId, index)).map((p) => p.id);
}

// Кто может закрыть или открыть проект (тумблер-глаз): только его автор и админ (решение
// владельца 16.10.2026, docs/decisions/2026-10-16-security-fixes.md). Остальные правки открытого
// проекта по-прежнему доступны всем участникам (решение 2026-07-01) — сужен только тумблер.
// Строка без автора (`created_by = null`, легаси) — только админ: «ничейную» строку закрыть
// чужой рукой нельзя, а открыть её обратно было бы некому.
export function canToggleProjectPrivacy(
  row: Pick<ProjectAccessRow, "created_by">,
  viewerId: number | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return viewerId !== undefined && row.created_by !== null &&
    row.created_by === viewerId;
}

export type PrivacyChangeVerdict = "ok" | "parent-hidden" | "forbidden";

// Правка проекта, которая меняет, КТО его видит, — то же закрытие/открытие, даже если тумблер
// не тронут: перенос под закрытую группу прячет проект у всех, вынос из неё — открывает.
// Поэтому право автора-или-админа спрашивается и на смену собственного флага, и на любую смену
// итоговой приватности (isProjectPrivate до и после). Новый родитель обязан быть виден зрителю:
// под невидимую группу не переносят и не создают — отказ неотличим от «такой группы нет».
// `rows` — все живые строки воркспейса.
export function privacyChangeVerdict(input: {
  row: ProjectAccessRow;
  rows: Array<ProjectAccessRow & { id: string }>;
  next: { parent_id: string | null; is_private: boolean };
  viewerId: number | undefined;
  isAdmin: boolean;
}): PrivacyChangeVerdict {
  const { row, next, viewerId, isAdmin } = input;
  const index = parentLookup(input.rows);
  if (next.parent_id !== null && next.parent_id !== row.parent_id) {
    const parent = index.get(next.parent_id);
    if (!parent || !canViewProject(parent, viewerId, index)) {
      return "parent-hidden";
    }
  }
  const togglesOwn = next.is_private !== row.is_private;
  const effectiveChanges = isProjectPrivate(row, index) !==
    isProjectPrivate({ ...row, ...next }, index);
  if (
    (togglesOwn || effectiveChanges) &&
    !canToggleProjectPrivacy(row, viewerId, isAdmin)
  ) return "forbidden";
  return "ok";
}
