// Автор события журнала: в старых строках — строка с telegram_id ('744230399', у Google-входа
// отрицательный, '-30'), в новых — имя или 'demo'. Числовую строку показываем именем, остальное
// как есть. Чистые функции: резолв имён передаётся снаружи (resolveNames из index.ts).

const NUMERIC_ACTOR = /^-?\d+$/;

/** telegram_id из автора, если он записан числом; иначе null. */
export function actorId(actor: string | null): number | null {
  if (actor === null || !NUMERIC_ACTOR.test(actor)) return null;
  const id = Number(actor);
  return Number.isSafeInteger(id) ? id : null;
}

/** Все уникальные telegram_id среди авторов — одним списком для одного резолва. */
export function actorIds(actors: (string | null)[]): number[] {
  const ids = new Set<number>();
  for (const a of actors) {
    const id = actorId(a);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

/** Имя вместо числового автора; не нашлось имени или автор не число — значение как есть. */
export function displayActor(
  actor: string | null,
  names: Map<number, string>,
): string | null {
  const id = actorId(actor);
  if (id === null) return actor;
  return names.get(id) ?? actor;
}
