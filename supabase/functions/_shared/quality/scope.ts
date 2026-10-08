// Границы загрузки листа в общую для всех воркспейсов таблицу quality_scores. Чистые функции под
// тестом (scope.test.ts): что удалить при повторной загрузке, какие страны листа чужие вызывающему,
// какие пиццерии лист «переносит» в другую страну.
import type { CellKey, ParsedSheet, SheetUnit } from "./sheet.ts";

const key = (c: CellKey) => `${c.unit_id}|${c.period_start}`;

export type StoredKey = CellKey & { country_code: string };

/** Балл, которого больше нет в листе, удаляется — но только внутри загруженного: периоды заголовка
 *  листа × его пиццерии, и только строки, у которых страна та же, что у пиццерии в листе. Всё за
 *  пределами (старые периоды вне выгрузки, выпавшие из листа пиццерии, чужие страны) остаётся:
 *  выгрузка — окно, а не полная история. Ячейка с не-баллом (опечатка) прежнее значение не стирает. */
export function staleKeys(
  existing: StoredKey[],
  parsed: Pick<ParsedSheet, "scores" | "badCells" | "periods" | "sheetUnits">,
): CellKey[] {
  const periods = new Set(parsed.periods.map((p) => p.start));
  const unitCc = new Map(parsed.sheetUnits.map((u) => [u.id, u.cc]));
  const keep = new Set([...parsed.scores, ...parsed.badCells].map(key));
  return existing
    .filter((c) => periods.has(c.period_start) && unitCc.get(c.unit_id) === c.country_code.trim() && !keep.has(key(c)))
    .map(({ unit_id, period_start }) => ({ unit_id, period_start }));
}

const upper = (list: string[]) => new Set(list.map((a) => a.trim().toUpperCase()));

/** Страны листа вне открытых воркспейсу (без учёта регистра): админ одного воркспейса не должен
 *  перезаписывать баллы чужих стран. `allowed` null — ограничений нет. */
export function foreignCountries(countries: string[], allowed: string[] | null): string[] {
  if (allowed === null) return [];
  const open = upper(allowed);
  return countries.filter((c) => !open.has(c.toUpperCase()));
}

export type UnitMove = { id: string; name: string; from: string; to: string; foreign: boolean };

/** Пиццерии листа, которые в базе уже записаны под другой страной. Ключ строки — (kind, unit_id,
 *  period_start), страна в него не входит, поэтому без этой проверки лист мог бы «забрать» чужую
 *  пиццерию и переписать её страну. `foreign` — прежняя страна вне `allowed` вызывающего. */
export function unitMoves(
  sheetUnits: SheetUnit[],
  stored: { unit_id: string; country_code: string }[],
  allowed: string[] | null,
): UnitMove[] {
  const open = allowed === null ? null : upper(allowed);
  const byId = new Map(sheetUnits.map((u) => [u.id, u]));
  const seen = new Set<string>();
  const moves: UnitMove[] = [];
  for (const s of stored) {
    const u = byId.get(s.unit_id);
    const from = s.country_code.trim().toUpperCase();
    if (!u || from === u.cc || seen.has(`${u.id}|${from}`)) continue;
    seen.add(`${u.id}|${from}`);
    moves.push({ id: u.id, name: u.name, from, to: u.cc, foreign: open !== null && !open.has(from) });
  }
  return moves;
}
