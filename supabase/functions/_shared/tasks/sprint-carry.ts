// Кто уезжает в следующий спринт и почему.
//
// Логика описана здесь один раз, чистой функцией, и её же обязана повторять SQL-функция приёмки:
// тест на локальной базе сверяет результат `accept_sprint_cycle` с `planCarry`. Две реализации
// одного правила иначе разъезжаются молча — и расхождение видно не на сборке, а через месяц,
// когда чей-то хвост не доехал.
import { isClosedStatus } from "./statuses.ts";

/** Строка состава спринта в виде, достаточном для решения о переносе. */
export interface CarryInput {
  id: string;
  status: string;
  /** Человек сам пометил «к переносу» (причина хранится рядом, на решение не влияет). */
  to_carry: boolean;
  /** Задача удалена: в составе осталось только упоминание. */
  removed_at: string | null;
}

/**
 * - `stay` — остаётся в этом спринте: работа над задачей кончена (`done`/`cancelled`);
 * - `manual` — уезжает, потому что человек пометил её «к переносу»;
 * - `auto` — уезжает, потому что спринт кончился, а задача нет;
 * - `mention` — упоминание удалённой задачи: не переносится и в итогах не считается.
 */
export type CarryKind = "stay" | "manual" | "auto" | "mention";

export interface CarryDecision {
  id: string;
  kind: CarryKind;
}

/**
 * Решение по каждой строке состава. Порядок входа сохраняется: по нему строится окно приёмки,
 * и перестановка строк выглядела бы для человека как чужой список.
 */
export function planCarry(items: readonly CarryInput[]): CarryDecision[] {
  return items.map((it) => ({ id: it.id, kind: decide(it) }));
}

function decide(it: CarryInput): CarryKind {
  // Порядок проверок важен. Удалённая задача рассматривается первой: её строка может нести
  // любой статус и любую пометку, но переносить нечего — самой задачи больше нет.
  if (it.removed_at !== null) return "mention";
  if (isClosedStatus(it.status)) return "stay";
  return it.to_carry ? "manual" : "auto";
}
