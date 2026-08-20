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
// а приватность — двумя разными признаками (см. ниже).

export type ProjectAccessRow = {
  parent_id: string | null;
  created_by: number | null;
  is_private: boolean;
};

// Строка приватна по одной из двух причин:
//  • это подпроект (`parent_id ≠ null`) — скрыт от чужих по умолчанию (решение владельца
//    2026-08-19: «чтобы Анна видела не все подпроекты, а только свои»);
//  • на проекте ВЕРХНЕГО уровня включён тумблер-глаз (`is_private`) — «скрыть этот
//    конкретный проект из общего пула» (тот же день).
export function isProjectPrivate(row: ProjectAccessRow): boolean {
  return row.parent_id !== null || row.is_private;
}

// Кто видит строку. Публичный проект верхнего уровня — весь воркспейс; приватный — только
// автор и админ. `created_by = null` (легаси-строка или системное создание без юзера) НЕ
// прячем ни от кого: молча потерять доступ к «ничейной» строке хуже, чем показать её лишний раз.
//
// Тот же критерий работает и на мутацию: публичную строку правит любой участник (решение
// 2026-07-01), приватную — только автор или админ. Поэтому отдельной canMutate нет — иначе
// две функции снова разъедутся, как разъехались три рукописные копии.
export function canViewProject(
  row: ProjectAccessRow,
  viewerId: number | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!isProjectPrivate(row)) return true;
  if (row.created_by === null) return true;
  return row.created_by === viewerId;
}

export type ProjectNameRow = ProjectAccessRow & { id: string; name: string };

// Резолв имени проекта в id — чистая часть, вынесена ради тестов.
//
// КРИТИЧНО (issue #37): сначала отсекаем невидимые зрителю строки и только потом ищем по имени.
// Раньше фильтра не было вовсе: чужой приватный проект (или чужой подпроект) резолвился по
// имени, и через MCP в него можно было положить задачу — а сам факт совпадения имени уже
// подтверждал, что такой проект существует. Невидимая строка не должна ни матчиться, ни
// участвовать в подсчёте неоднозначности.
export function pickProjectByName(
  rows: ProjectNameRow[],
  name: string,
  viewerId: number | undefined,
  isAdmin: boolean,
): { id: string; ambiguous: boolean } | null {
  const visible = rows.filter((p) => canViewProject(p, viewerId, isAdmin));
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
