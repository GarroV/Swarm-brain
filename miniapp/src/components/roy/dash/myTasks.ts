/**
 * myTasks.ts — чистая логика панелей desktop-дашборда «Рой».
 *
 * Без React, без сайд-эффектов. Все функции иммутабельны:
 * входные массивы не мутируются — при необходимости делаем копию.
 */
import type { Task, Entry } from "@/types";

// ── Вспомогательные ──────────────────────────────────────────────────────────

/**
 * Нормализует статус задачи.
 * "progress" — устаревший alias из БД; приводим к "in_progress" для единого
 * сравнения (консистентно с RoyDashboard.tsx).
 */
const norm = (s: string): string => (s === "progress" ? "in_progress" : s);

// ── Экспортируемые функции ────────────────────────────────────────────────────

/**
 * Разделяет задачи на «мои» и «командные» по числовому telegram_id.
 *
 * Владелец — тот, чей telegram_id присутствует в `assignee_telegram_ids`.
 * Не мутирует входной массив.
 *
 * @param tasks  Список задач (любой статус)
 * @param meId   telegram_id текущего пользователя (Me.telegram_id, number)
 */
export function splitByOwner(
  tasks: Task[],
  meId: number,
): { mine: Task[]; team: Task[] } {
  const mine: Task[] = [];
  const team: Task[] = [];
  for (const t of tasks) {
    const owned = (t.assignee_telegram_ids ?? []).includes(meId);
    (owned ? mine : team).push(t);
  }
  return { mine, team };
}

/**
 * Группирует «мои» задачи по дедлайну относительно сегодняшнего дня.
 *
 * Категории:
 *  - today  — due_date <= todayISO  (просроченные + сегодня)
 *  - week   — todayISO < due_date <= todayISO + 7 дней
 *  - noDate — без дедлайна ИЛИ дедлайн дальше недели
 *
 * Не мутирует входной массив.
 *
 * @param mine      Только «мои» задачи (результат splitByOwner().mine)
 * @param todayISO  Сегодняшняя дата в ISO-формате YYYY-MM-DD (полночь)
 */
export function groupMine(
  mine: Task[],
  todayISO: string,
): { today: Task[]; week: Task[]; noDate: Task[] } {
  const today: Task[] = [];
  const week: Task[] = [];
  const noDate: Task[] = [];

  const t0 = Date.parse(todayISO);
  const weekEnd = t0 + 7 * 86_400_000;

  for (const t of mine) {
    if (!t.due_date) {
      noDate.push(t);
      continue;
    }
    const due = Date.parse(t.due_date);
    if (!Number.isFinite(due)) {
      noDate.push(t);
      continue;
    }
    if (due <= t0) {
      today.push(t);
    } else if (due <= weekEnd) {
      week.push(t);
    } else {
      noDate.push(t);
    }
  }

  return { today, week, noDate };
}

/**
 * Возвращает записи, созданные не позже `withinMs` миллисекунд до `now`,
 * отсортированные от новых к старым.
 *
 * По умолчанию withinMs = 86 400 000 мс = 24 часа.
 * Не мутирует входной массив (создаёт новый через filter+sort).
 *
 * @param entries   Список записей
 * @param now       Текущий timestamp в мс (Date.now())
 * @param withinMs  Окно отсечки в мс (по умолчанию 24ч)
 */
export function recentEntries(
  entries: Entry[],
  now: number,
  withinMs = 86_400_000,
): Entry[] {
  return entries
    .filter((e) => {
      const c = Date.parse(e.created_at ?? "");
      return Number.isFinite(c) && now - c <= withinMs;
    })
    .sort(
      (a, b) =>
        Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""),
    );
}

/**
 * Сортирует встречи так, чтобы неподтверждённые шли первыми
 * (требуют подтверждения → выше приоритет отображения).
 *
 * confirmed=true → в конец; confirmed=false/undefined → в начало.
 * Не мутирует входной массив — создаёт копию через spread перед sort.
 *
 * @param meetings  Список записей типа «встреча»
 */
export function sortMeetingsApprovalFirst(meetings: Entry[]): Entry[] {
  const isConfirmed = (e: Entry): boolean => e.metadata?.confirmed === true;
  return [...meetings].sort(
    (a, b) => Number(isConfirmed(a)) - Number(isConfirmed(b)),
  );
}
