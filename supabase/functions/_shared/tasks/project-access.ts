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

export function parentLookup(rows: Array<ProjectAccessRow & { id: string }>): ProjectIndex {
  return new Map(rows.map((r) => [r.id, { parent_id: r.parent_id, created_by: r.created_by, is_private: r.is_private }]));
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
export function isProjectPrivate(row: ProjectAccessRow, index: ProjectIndex): boolean {
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
    if (cur.is_private && cur.created_by !== null && cur.created_by !== viewerId) return false;
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
export function visibleProjectNames(rows: ProjectNameRow[], viewerId: number | undefined): string[] {
  const index = parentLookup(rows);
  return rows.filter((p) => canViewProject(p, viewerId, index)).map((p) => p.name);
}
