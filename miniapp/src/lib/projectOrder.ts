// Порядок проектов и подпроектов на доске (issue #433). Позиция — число у строки (`projects.position`),
// общее для всей команды: переставил один — видят все, порядок переживает перезагрузку.
//
// Приём канонический (fractional indexing, rocicorp/fractional-indexing и его порты): вставка между
// соседями = середина между их позициями, поэтому одно перетаскивание = одна правка одной строки, а не
// перенумерация всего списка. Строковые base62-ключи оттуда нам не нужны — проектов десятки, а `double
// precision` выдерживает полсотни последовательных делений одного зазора.
//
// Середина перестаёт работать, когда зазора между соседями не осталось (равные позиции, легаси-строки
// без позиции). Тогда — и только тогда — план перенумеровывает всех братьев: молча положить дубль
// позиции нельзя, порядок станет случайным, и человек будет ловить «карточка сама прыгает».

/** Шаг между соседними позициями. Тот же шаг у бэкфилла миграции и у создания проекта. */
export const ORDER_STEP = 1000;

/** Зазор, в который ещё можно вставить середину. Ниже него — перенумерация. */
const MIN_GAP = 1e-6;

type Orderable = { id: string; position: number | null; created_at: string };

/** Одна правка: строке назначается новая позиция. */
export type PositionChange = { id: string; position: number };

/**
 * Порядок братьев: сначала строки с позицией, затем строки без неё (легаси/гонка со старым кодом),
 * внутри каждой группы — по дате создания, чтобы порядок не «дышал» между перерисовками.
 */
export function sortByPosition<T extends Orderable>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.position !== null && b.position !== null && a.position !== b.position) {
      return a.position - b.position;
    }
    if (a.position === null && b.position !== null) return 1;
    if (a.position !== null && b.position === null) return -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Куда встаёт перетаскиваемая строка относительно строки, на которую её отпустили. */
export type DropTarget = { id: string; place: "before" | "after" };

/**
 * План перестановки: строка `movedId` встаёт до/после строки `target.id` среди своих братьев.
 * Пустой массив — двигать нечего (отпустили на себя или на то же самое место).
 */
export function planReorder<T extends Orderable>(
  siblings: T[],
  movedId: string,
  target: DropTarget,
): PositionChange[] {
  if (movedId === target.id) return [];
  const sorted = sortByPosition(siblings);
  const moved = sorted.find((s) => s.id === movedId);
  const rest = sorted.filter((s) => s.id !== movedId);
  const at = rest.findIndex((s) => s.id === target.id);
  if (!moved || at < 0) return [];
  const desired = [...rest];
  desired.splice(target.place === "before" ? at : at + 1, 0, moved);
  return planFor(desired, movedId, sorted);
}

/**
 * План для переноса строки в другой проект: она встаёт в конец списка новых братьев
 * (`siblings` — братья БЕЗ неё, она ещё числится за прежним родителем).
 */
export function planAppend<T extends Orderable>(siblings: T[], movedId: string): PositionChange[] {
  const desired: Orderable[] = [
    ...sortByPosition(siblings),
    { id: movedId, position: null, created_at: "" },
  ];
  return planFor(desired, movedId, null);
}

/**
 * Считает правки для уже выстроенного желаемого порядка: одна середина, если зазор есть,
 * иначе перенумерация всего списка ровным шагом.
 */
function planFor(
  desired: Orderable[],
  movedId: string,
  current: Orderable[] | null,
): PositionChange[] {
  const at = desired.findIndex((s) => s.id === movedId);
  if (at < 0) return [];
  const moved = desired[at];
  const sameOrder = current !== null &&
    current.length === desired.length &&
    current.every((s, i) => s.id === desired[i].id);
  if (sameOrder && moved.position !== null) return [];

  const prev = at > 0 ? desired[at - 1].position : null;
  const next = at < desired.length - 1 ? desired[at + 1].position : null;
  const single = at === 0 && desired.length === 1;

  if (single) return [{ id: movedId, position: ORDER_STEP }];
  if (at === 0 && next !== null) return [{ id: movedId, position: next - ORDER_STEP }];
  if (at === desired.length - 1 && prev !== null) return [{ id: movedId, position: prev + ORDER_STEP }];
  if (prev !== null && next !== null && next - prev > MIN_GAP) {
    return [{ id: movedId, position: (prev + next) / 2 }];
  }
  // Зазора нет (дубли позиций) или у соседа позиции ещё не было — раскладываем весь список заново.
  return desired.map((s, i) => ({ id: s.id, position: ORDER_STEP * (i + 1) }));
}

/**
 * Сторона вставки под курсором: до строки или после неё. Считается от середины строки по той оси,
 * вдоль которой идёт список (X у плиток в ряду, Y у списка сверху вниз).
 */
export function dropSide(start: number, size: number, pointer: number): "before" | "after" {
  return pointer < start + size / 2 ? "before" : "after";
}
