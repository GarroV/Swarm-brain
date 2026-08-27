// Быстрое добавление задачи — ЕДИНЫЙ источник дефолтов для всех точек «+» в вебе:
// список в духе Reminders (useReminderTasks.quickAdd) и доска проектов/спринтов (SprintBoard).
//
// Зачем один файл: до 2026-08-27 дефолты жили в двух местах и разошлись — «+» на доске
// создавал задачу БЕЗ исполнителя, она по правилу линз попадала в «Команда» (общая = не
// приватная и без исполнителя) и пропадала из «Моих». Владелец: быстрое добавление везде
// назначает задачу на меня, общую делаешь осознанно через полную форму.
//
// Типы объявлены локально и без импортов, чтобы файл гонялся `deno test` вместе с остальными
// тестами веба (алиас `@/` deno не разрешает). Совместимость с CreateTaskInput проверяет
// `tsc --noEmit` в точках вызова.

export type QuickAddContext = {
  /** Колонка доски: open | in_progress | … Пусто — дефолт сервера («открыто»). */
  status?: string;
  projectId?: string | null;
  sprintId?: string | null;
  /** Сегодняшний день (YYYY-MM-DD) — передаётся, только если активен список «Сегодня». */
  todayISO?: string | null;
  /** Активная персональная метка: задача создаётся личной, метка вешается вторым шагом. */
  labelId?: string | null;
};

export type QuickAddInput = {
  title: string;
  assignee_telegram_id?: number;
  status?: string;
  project_id?: string;
  sprint_id?: string;
  due_date?: string;
  is_private?: boolean;
};

export function buildQuickAddInput(
  title: string,
  me: { telegram_id: number } | null,
  ctx: QuickAddContext = {},
): QuickAddInput | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const input: QuickAddInput = { title: trimmed };
  if (me) input.assignee_telegram_id = me.telegram_id;
  if (ctx.status) input.status = ctx.status;
  if (ctx.projectId) input.project_id = ctx.projectId;
  if (ctx.sprintId) input.sprint_id = ctx.sprintId;
  // Метка перебивает «сегодня»: список метки — не «Сегодня», навязанный срок там мешает.
  if (ctx.labelId) input.is_private = true;
  else if (ctx.todayISO) input.due_date = ctx.todayISO;
  return input;
}
