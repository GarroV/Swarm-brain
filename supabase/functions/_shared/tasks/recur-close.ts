// Закрытие цикла регулярной задачи: строка журнала и защита от повтора (issue #577, F-018).
//
// Регулярная задача при «готово» не закрывается, а перекатывается на следующее вхождение
// (recurrence.ts). Второе «готово» сразу за первым — двойной клик, повторное нажатие в боте,
// ретрай MCP после таймаута — видело уже НОВЫЙ срок и перекатывало его ещё раз: вхождение
// графика пропадало молча. Отличить повтор от «закрыл и следующий цикл досрочно» по одному
// запросу нельзя, поэтому правило такое: если ЭТОТ ЖЕ цикл только что закрыли (журнал говорит,
// что срок перекатили ровно на текущий, и было это в пределах окна) — второй запрос ничего не
// пишет и отвечает тем же перекатом. Закрыть следующий цикл досрочно можно, но не в ту же
// минуту.

/** Окно, в котором повторное «готово» считается повтором того же нажатия. */
export const RECUR_DUPLICATE_WINDOW_MS = 60_000;

/** Текст строки журнала о закрытии цикла. Формат читает parseRecurCloseNote — менять вместе. */
export function recurCloseNote(from: string, to: string): string {
  return `цикл закрыт, следующий срок ${to} (было ${from})`;
}

const NOTE_RE = /^цикл закрыт, следующий срок (\d{4}-\d{2}-\d{2}) \(было (\d{4}-\d{2}-\d{2})\)$/;

/** Обратное к recurCloseNote; null — строка не о закрытии цикла или в чужом формате. */
export function parseRecurCloseNote(
  note: string | null | undefined,
): { from: string; to: string } | null {
  const m = note ? NOTE_RE.exec(note) : null;
  return m ? { from: m[2], to: m[1] } : null;
}

/**
 * Повтор ли это только что выполненного закрытия цикла. Возвращает перекат, которым надо
 * ответить (тот же, что уже записан), или null — запрос новый и перекатывать надо.
 *
 * Повтор, только если срок задачи и сейчас тот, на который её перекатили: если срок с тех пор
 * поменяли руками, «готово» относится уже к другому циклу.
 */
export function duplicateRecurClose(args: {
  lastClose: { note: string | null; created_at: string } | null;
  currentDue: string | null;
  nowMs: number;
  windowMs?: number;
}): { from: string; to: string } | null {
  if (!args.lastClose || !args.currentDue) return null;
  const parsed = parseRecurCloseNote(args.lastClose.note);
  if (!parsed || parsed.to !== args.currentDue) return null;
  const at = Date.parse(args.lastClose.created_at);
  if (Number.isNaN(at)) return null;
  const age = args.nowMs - at;
  return age >= 0 && age <= (args.windowMs ?? RECUR_DUPLICATE_WINDOW_MS) ? parsed : null;
}
