// Срок задачи. Единственное место, где решается, каким он будет по умолчанию.
//
// Решение владельца 21.09.2026: «давай заложим обязательное требование для задач на
// дедлайн. по дефолту дедлайн +1 день от времени добавления». Срок перестал быть
// необязательным полем: задача без срока не попадала ни в «Сегодня», ни в «Ближайшие» и
// жила только в «Все» — то есть терялась ровно так же, как замьюченная (issue #440).
import { TASK_TZ, todayInTz } from "./recurrence.ts";

const DEFAULT_DUE_SHIFT_DAYS = 1;

// Прибавляет дни к календарной дате YYYY-MM-DD. Считаем в UTC-полночи: арифметика дат
// не должна зависеть от часового пояса машины, иначе срок «завтра» у одного участника
// команды окажется сегодняшним у другого.
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// Срок по умолчанию: завтрашний день по времени команды.
export function defaultDueDate(now: Date = new Date()): string {
  return addDays(todayInTz(now, TASK_TZ), DEFAULT_DUE_SHIFT_DAYS);
}
