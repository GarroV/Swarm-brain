export type ProjectRef = { id: string; parent_id: string | null };

// Валидация вложенности проектов (ровно 2 уровня: группа → подпроект).
// Чистая, без БД: `all` — все проекты воркспейса. Вызывается create/updateProject.
export function validateParent(input: {
  projectId: string | null;
  parentId: string | null;
  all: ProjectRef[];
}): { ok: true } | { ok: false; error: string } {
  const { projectId, parentId, all } = input;
  if (parentId === null) return { ok: true };
  if (parentId === projectId) return { ok: false, error: "проект не может быть родителем самому себе" };
  const parent = all.find((p) => p.id === parentId);
  if (!parent) return { ok: false, error: "родитель не найден в воркспейсе" };
  if (parent.parent_id !== null) return { ok: false, error: "нельзя вкладывать глубже 2 уровней" };
  if (projectId !== null && all.some((p) => p.parent_id === projectId)) {
    return { ok: false, error: "у проекта есть подпроекты — его нельзя делать подпроектом" };
  }
  return { ok: true };
}
