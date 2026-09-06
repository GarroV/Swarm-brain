import type { Project } from "@/types";

// Состав и порядок выпадающего списка «Проект» в карточке задачи.
//
// Решение владельца 2026-09-06 (docs/decisions/2026-09-06-project-picker-own-only.md):
// при настройке задачи человек видит ТОЛЬКО свои проекты и подпроекты — общий список
// воркспейса (48 строк прода, три автора, вперемешку и с повторяющимися названиями)
// выбрать в нём нужное не давал. Доска (SprintBoard) осталась общей, менялась только
// витрина выбора.
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
  opts: { viewerId?: number | null; selectedId?: string | null },
): ProjectPickerOptions {
  const viewerId = opts.viewerId ?? null;
  const selectedId = opts.selectedId ?? null;
  const byId = new Map(projects.map((p) => [p.id, p]));

  // «Моё» = я автор, либо строка ничейная (легаси/бот — иначе она недостижима),
  // либо это подпроект в моей группе (сосед по моей же ветке).
  const isMine = (p: Project): boolean => {
    if (viewerId === null) return true;
    if (p.created_by === null || p.created_by === viewerId) return true;
    const parent = p.parent_id ? byId.get(p.parent_id) : undefined;
    return parent !== undefined && (parent.created_by === null || parent.created_by === viewerId);
  };

  // Уже привязанный чужой проект остаётся в списке: убери его — подпись схлопнется в «—»,
  // и первое же сохранение молча оторвёт задачу от проекта.
  const visible = projects.filter((p) => isMine(p) || p.id === selectedId);

  const toOption = (p: Project): ProjectOption => ({
    id: p.id,
    name: p.name,
    parentName: p.parent_id ? (byId.get(p.parent_id)?.name ?? "…") : null,
  });

  // Чужая привязанная строка — в голову своей секции: это текущее значение, ему место на виду.
  const pinFirst = (list: ProjectOption[]) => {
    const i = list.findIndex((o) => o.id === selectedId);
    return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
  };
  const isForeignSelected = (o: ProjectOption) => o.id === selectedId && !isMine(byId.get(o.id)!);

  const tops = visible.filter((p) => !p.parent_id).map(toOption).sort((a, b) => byName(a.name, b.name));
  const subs = visible.filter((p) => p.parent_id).map(toOption)
    .sort((a, b) => byName(a.parentName ?? "", b.parentName ?? "") || byName(a.name, b.name));

  return {
    tops: tops.some(isForeignSelected) ? pinFirst(tops) : tops,
    subs: subs.some(isForeignSelected) ? pinFirst(subs) : subs,
  };
}
