// «Пинг» задачи — ручное напоминание, которое человек ставит на карточке отдельно от срока:
// дедлайн 20 сентября, а вспомнить надо 1-го. Чистая логика (без БД/Telegram) — отбор
// наступивших пингов, круг получателей и формат сообщения. БД+отправка — task-pings-send.ts,
// крон-триггер — swarm-bot/index.ts (task_pings_cron).
//
// Правила (решения владельца 2026-08-26):
// • пинг ТОЛЬКО ручной — авто-пинга «за день до срока» нет (иначе первый же прогон разослал бы
//   напоминания по сотне задач со сроком);
// • пинг ОДНОРАЗОВЫЙ и сгорает: отправили → `reminded_at`, повторов и «догоняющих» напоминаний
//   по просрочке нет;
// • получатель — исполнители; у общей задачи без исполнителя — тот, кто поставил пинг.

import { canViewTask } from "../../_shared/tasks/access.ts";
import { TASK_TZ, todayInTz } from "../../_shared/tasks/recurrence.ts";

// Часовой пояс и календарный «сегодня» — канон в _shared/tasks/recurrence.ts (одна копия
// на весь модуль задач: перекат регулярных и пинги обязаны считать один и тот же день).
export const PING_TZ = TASK_TZ;
const MAX_BUTTONS = 10; // Telegram: не вываливаем сотню кнопок — верх списка + «…ещё N»
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export interface PingRow {
  id: string;
  title: string;
  remind_date: string | null;  // YYYY-MM-DD — день, когда напомнить
  due_date: string | null;     // YYYY-MM-DD — срок, показываем в напоминании
  status: string;
  is_private: boolean;
  assignee_telegram_ids: number[] | null;
  created_by_telegram_id: number | null;
  remind_set_by: number | null; // кто поставил пинг (может быть не создатель задачи)
  owner_id: number | null;
}

export interface InlineUrlButton {
  text: string;
  url: string;
}

// Календарный «сегодня» по Белграду — реэкспорт канона, чтобы существующие вызовы и тесты
// (`todayIn`) остались на месте, а формула жила в одном файле.
export const todayIn = todayInTz;

function isDone(status: string): boolean {
  return status === "done";
}

/**
 * Пора ли слать пинг. Прошедшая дата тоже считается наступившей: крон мог простоять
 * (деплой, сбой), и пропущенный пинг лучше отдать с опозданием, чем потерять молча.
 * Факт отправки (`reminded_at`) отсекается запросом в БД — здесь только дата и статус.
 */
export function isPingDue(row: PingRow, today: string): boolean {
  if (!row.remind_date || isDone(row.status)) return false;
  return row.remind_date <= today;
}

/**
 * Кому уходит пинг: исполнителям задачи; если исполнителя нет (общая задача) — тому, кто
 * поставил пинг, а если это неизвестно — создателю задачи. Приватную задачу видит только
 * владелец, поэтому круг дополнительно режется `canViewTask` (без админского оверсайта:
 * пинг — это «твоя задача ждёт», а не поток уведомлений о чужих личных делах).
 */
export function pingRecipients(row: PingRow): number[] {
  const assignees = (row.assignee_telegram_ids ?? []).filter((id): id is number => !!id);
  const candidates = assignees.length ? assignees : [row.remind_set_by ?? row.created_by_telegram_id];

  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!canViewTask(row, id, false)) continue;
    out.push(id);
  }
  // Приватную задачу видит только владелец. Если исполнитель ей не владеет (задачу закрыли
  // после назначения), круг схлопывается в ноль — и пинг ушёл бы в никуда, а задача осталась
  // бы в выборке крона навсегда. Владелец — последний рубеж: он эту задачу точно видит.
  if (!out.length && row.is_private && row.owner_id) out.push(row.owner_id);
  return out;
}

// Задача с несколькими исполнителями попадает каждому: пинг персональный, «кто-то другой
// наверняка увидит» — ровно тот случай, из-за которого задачи и теряются.
export function groupByRecipient(rows: PingRow[]): Map<number, PingRow[]> {
  const map = new Map<number, PingRow[]>();
  for (const row of rows) {
    for (const rid of pingRecipients(row)) {
      const bucket = map.get(rid);
      if (bucket) bucket.push(row);
      else map.set(rid, [row]);
    }
  }
  return map;
}

function ruShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "задаче";
  return "задачам";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Сообщение с пингами одного человека. Кнопка ведёт в веб (как у напоминаний о вычитке —
// уводим из Telegram туда, где задачу можно закрыть или передвинуть).
export function formatPings(rows: PingRow[], webBaseUrl: string): { text: string; keyboard: InlineUrlButton[][] } {
  const n = rows.length;
  const line = (r: PingRow) =>
    `• ${escapeHtml(r.title)}${r.due_date ? ` · срок ${ruShortDate(r.due_date)}` : ""}`;

  if (n === 1) {
    const r = rows[0];
    const due = r.due_date ? `\nСрок: ${ruShortDate(r.due_date)}` : "";
    const text = `🔔 <b>Напоминание</b>\n«${escapeHtml(r.title)}»${due}`;
    const keyboard = webBaseUrl ? [[{ text: "Открыть задачу", url: `${webBaseUrl}/?task=${r.id}` }]] : [];
    return { text: webBaseUrl ? text : `${text}\n\nОткрой /tasks`, keyboard };
  }

  const header = `🔔 <b>Напоминание</b> по ${n} ${plural(n)}`;
  const shown = rows.slice(0, MAX_BUTTONS);
  const rest = n - shown.length;
  const tail = rest > 0 ? `\n…и ещё ${rest}` : "";

  if (!webBaseUrl) {
    return { text: `${header}\n${rows.map(line).join("\n")}`, keyboard: [] };
  }
  const keyboard: InlineUrlButton[][] = shown.map((r) => {
    const title = r.title.length > 40 ? `${r.title.slice(0, 39)}…` : r.title;
    return [{ text: r.due_date ? `${title} · ${ruShortDate(r.due_date)}` : title, url: `${webBaseUrl}/?task=${r.id}` }];
  });
  return { text: `${header}${tail}`, keyboard };
}
