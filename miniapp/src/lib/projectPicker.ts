import type { Project } from "@/types";

// Состав и порядок выпадающего списка «Проект» в карточке задачи.
//
// Решение владельца 2026-09-06 (docs/decisions/2026-09-06-project-picker-own-only.md):
// «только проекты и подпроекты которые создал я, все, не больше». Общий список воркспейса
// (48 строк прода, три автора, вперемешку и с повторяющимися названиями) выбрать в нём
// нужное не давал. Доска (SprintBoard) осталась общей, менялась только витрина выбора.
//
// Привязку задачи к ЧУЖОМУ проекту это не рвёт: строки в списке нет, но значение живёт в
// состоянии карточки, а подпись считается по полному списку проектов (TaskModal). Проверено
// живым прогоном 2026-09-06 — Base UI не сбрасывает значение, которого нет среди пунктов.
//
// Это НЕ замок: доступ к проекту стережёт сервер (canViewProject в _shared/tasks/
// project-access.ts). Здесь только удобство выбора, поэтому при неизвестном зрителе
// список честно показывает всё, а не схлопывается в пустой.

export type ProjectOption = {
  id: string;
  name: string;
  /** null у верхнего проекта; имя группы у подпроекта (различает одноимённые «Маркетинг»). */
  parentName: string | null;
};

export type ProjectPickerOptions = { tops: ProjectOption[]; subs: ProjectOption[] };

const byName = (a: string, b: string) => a.localeCompare(b, "ru");

export function buildProjectOptions(
  projects: Project[],
  opts: { viewerId?: number | null },
): ProjectPickerOptions {
  const viewerId = opts.viewerId ?? null;
  const byId = new Map(projects.map((p) => [p.id, p]));

  // «Моё» = я автор строки, и только. Уточнение владельца 2026-09-06: «мне надо чтобы
  // выпадающий список проектов показывал только проекты и подпроекты которые создал я,
  // все, не больше» — ни ничейных строк, ни чужих подпроектов в моей группе.
  // Личность неизвестна (`fetchMe` не ответил) — показываем всё: пустой селект означал бы
  // «не к чему привязать задачу», а замок тут всё равно не здесь, а на сервере.
  const isMine = (p: Project): boolean => viewerId === null || p.created_by === viewerId;

  const visible = projects.filter(isMine);

  const toOption = (p: Project): ProjectOption => ({
    id: p.id,
    name: p.name,
    parentName: p.parent_id ? (byId.get(p.parent_id)?.name ?? "…") : null,
  });

  return {
    tops: visible.filter((p) => !p.parent_id).map(toOption).sort((a, b) => byName(a.name, b.name)),
    subs: visible.filter((p) => p.parent_id).map(toOption)
      .sort((a, b) => byName(a.parentName ?? "", b.parentName ?? "") || byName(a.name, b.name)),
  };
}
