// Напоминание о сроке за день (решение владельца 15.10.2026, docs/decisions/2026-10-15-due-reminder.md).
// Чистая логика (без БД/Telegram): отбор задач, итог тика, текст. БД+отправка —
// task-due-reminders-send.ts, крон — тот же `task_pings_cron` (swarm-bot/index.ts).
//
// Правила:
// • напоминаем, когда срок приходится на ЗАВТРА по календарю команды (`todayIn`); просроченные
//   и сегодняшние не трогаем;
// • одно напоминание на срок: `due_reminded_for` хранит срок, о котором уже напомнили, — перенос
//   срока даёт новое напоминание за день до нового;
// • ручной пинг важнее: задача с ожидающим пингом (или пингом, сработавшим сегодня) пропускается;
// • адресаты и недоставка — как у ручного пинга (`pingRecipients`, дошедшим повторно не шлём).

import { addDays } from "../../_shared/tasks/due.ts";
import { isClosedStatus } from "../../_shared/tasks/statuses.ts";
import { formatPings, type InlineUrlButton, pingRecipients, type PingRow } from "./task-pings.ts";

/** Заголовок сообщения в Telegram (у бота нет языка профиля — как у пинга, текст русский). */
export const DUE_REMINDER_HEADING = "Срок завтра";

export interface DueRow extends PingRow {
  /** Когда сработал ручной пинг (если сработал). */
  reminded_at?: string | null;
  /** Срок, о котором уже напомнили за день. */
  due_reminded_for?: string | null;
  /** Кому напоминание о текущем сроке уже дошло. */
  due_reminder_delivered_to?: number[] | null;
}

/**
 * Пора ли напоминать о сроке. `today` — календарный день команды (`todayIn`).
 * Ручной пинг пропускает задачу, если он ждёт своего часа (remind_date есть, reminded_at нет)
 * или сработал сегодня/позже: человек напоминание уже получил.
 */
export function isDueReminderDue(row: DueRow, today: string): boolean {
  if (!row.due_date || row.archived_at || isClosedStatus(row.status)) return false;
  if (row.due_date !== addDays(today, 1)) return false;
  if (row.due_reminded_for === row.due_date) return false;
  if (row.remind_date && (!row.reminded_at || row.remind_date >= today)) return false;
  return true;
}

/** Строки в форме пинга: у напоминания свой список «кому дошло», группировка та же. */
export function asPingRow(row: DueRow): PingRow {
  return { ...row, ping_delivered_to: row.due_reminder_delivered_to ?? [] };
}

export interface DueSettlement {
  /** Срок отработан (`due_reminded_for = due_date`): дошло всем получателям. */
  done: boolean;
  /** Кому дошло за всё время — пишется в `due_reminder_delivered_to`. */
  delivered: number[];
}

/**
 * Итог тика для одной задачи. Окна повторов нет: напоминание живёт один календарный день
 * (завтра срок уже «сегодня», и отбор его не подхватит), а до тех пор недошедшим пробуем
 * каждый часовой тик.
 */
export function settleDueReminder(row: DueRow, deliveredNow: number[]): DueSettlement {
  const delivered = [...new Set([...(row.due_reminder_delivered_to ?? []), ...deliveredNow])];
  const got = new Set(delivered);
  return { done: pingRecipients(row).every((id) => got.has(id)), delivered };
}

export function formatDueReminders(
  rows: PingRow[],
  webBaseUrl: string,
): { text: string; keyboard: InlineUrlButton[][] } {
  return formatPings(rows, webBaseUrl, DUE_REMINDER_HEADING);
}
