// Фильтры пула «Задачи» на экране спринтов (issue #267).
//
// Вынесено из SprintTaskPool.tsx чистыми функциями, чтобы правило отбора проверялось тестами,
// а не глазами: у пула три независимых фильтра, и главный из них — по проекту — иерархический.
//
// Решение владельца 09.09.2026 (по итогам первого прогона на проде): «если выбираем прям
// проект, то нужны все задачи проекта, кроме выполненных; если выбрали подпроект — то только
// задачи подпроекта». До этого фильтр сравнивал `task.project_id` точным совпадением, поэтому
// выбор проекта-ГРУППЫ прятал всё, что лежит в её подпроектах, — а именно там и живут задачи
// (на доске у группы своя полоса «Общее», а рабочие карточки распределены по подпроектам).
//
// Кто вообще попадает в пул (не взятые в спринт, не закрытые, не приватные) — тоже здесь,
// функция `poolCandidates`: правило приватности не должно жить в разметке экрана.

import type { Project, Task } from "@/types";

export const POOL_ALL = "__all__";
export const POOL_NO_PROJECT = "__none__";

/**
 * Проекты, попадающие под выбор `projectId`: сам проект и все его подпроекты.
 * Вложенность в продукте ровно двухуровневая (`validateParent` в `_shared/tasks/project-nesting.ts`),
 * но обход написан по факту дерева, а не по этому допущению.
 */
export function projectScope(projectId: string, projects: Project[]): Set<string> {
  const scope = new Set<string>([projectId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      if (p.parent_id && scope.has(p.parent_id) && !scope.has(p.id)) {
        scope.add(p.id);
        grew = true;
      }
    }
  }
  return scope;
}

/** Подпись проекта в фильтре: у подпроекта — «Группа › Имя», иначе тёзки неотличимы. */
export function projectLabel(p: Project, all: Project[]): string {
  if (!p.parent_id) return p.name;
  const parent = all.find((x) => x.id === p.parent_id);
  return parent ? `${parent.name} › ${p.name}` : p.name;
}

/**
 * Опции фильтра в порядке дерева: родитель, сразу под ним его подпроекты.
 * Алфавит — внутри уровня, чтобы список не прыгал при переименовании.
 */
export function projectOptions(projects: Project[]): Array<{ id: string; label: string; child: boolean }> {
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);
  const roots = projects.filter((p) => !p.parent_id).sort(byName);
  const out: Array<{ id: string; label: string; child: boolean }> = [];
  for (const root of roots) {
    out.push({ id: root.id, label: root.name, child: false });
    for (const kid of projects.filter((p) => p.parent_id === root.id).sort(byName)) {
      out.push({ id: kid.id, label: kid.name, child: true });
    }
  }
  // Подпроект, чей родитель не виден (скрыт приватностью) — иначе он бы пропал из фильтра совсем.
  const seen = new Set(out.map((o) => o.id));
  for (const orphan of projects.filter((p) => !seen.has(p.id)).sort(byName)) {
    out.push({ id: orphan.id, label: projectLabel(orphan, projects), child: false });
  }
  return out;
}

export type PoolFilters = { query: string; projectId: string; assignee: string };

/** Отбор задач пула по всем трём фильтрам сразу. */
export function filterPoolTasks(tasks: Task[], projects: Project[], f: PoolFilters): Task[] {
  const q = f.query.trim().toLowerCase();
  const scope = f.projectId === POOL_ALL || f.projectId === POOL_NO_PROJECT
    ? null
    : projectScope(f.projectId, projects);
  return tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q)) return false;
    if (f.projectId === POOL_NO_PROJECT && t.project_id) return false;
    if (scope && !(t.project_id && scope.has(t.project_id))) return false;
    if (f.assignee !== POOL_ALL && !t.assignees.includes(f.assignee)) return false;
    return true;
  });
}

/** Закрытые статусы: в спринтовом канбане обе колонки-исхода схлопнуты в «Готово». */
export const CLOSED_STATUSES = new Set(["done", "cancelled"]);

/**
 * Кто вообще может попасть в пул: не взятые в этот спринт, не закрытые, не приватные.
 *
 * Закрытая задача сразу легла бы в «Готово» и накрутила процент выполнения задним числом.
 * Приватные сервер не берёт в спринт в принципе (`is_private=false` в фильтре добавления),
 * включая собственные задачи автора, — показывать их в пуле значит обещать действие,
 * которое закончится «добавлено 0 из 1».
 */
export function poolCandidates(tasks: Task[], inSprint: ReadonlySet<string>): Task[] {
  return tasks.filter((t) => !inSprint.has(t.id) && !CLOSED_STATUSES.has(t.status) && !t.is_private);
}
