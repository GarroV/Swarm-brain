// Кому, кроме запустившего, бот сообщает, что не смог записать встречу (решение владельца 12.11.2026,
// docs/decisions/2026-11-12-bot-notices-to-all-participants.md): тем из Swarm, кто ПРИНЯЛ встречу.
//
// Откуда известно «принял» — по надёжности источника:
//   1. у участника ПОДКЛЮЧЁН Google-календарь → смотрим в ЕГО календарь: событие с той же комнатой и
//      пересекающимся временем, где его собственный ответ «да» (`acceptedBySelf`). Это не подделать:
//      статус чужого ответа в событии запустившего можно вписать импортом .ics, а свой календарь —
//      нельзя. Нет такого события или он не принял — не получает. Ошибка Google по одному человеку —
//      тоже не получает (лог): задание из-за неё не падает;
//   2. календаря нет → по ответу в событии запустившего (accepted). Риск низкий — человек увидит
//      только название встречи и факт «бот не зашёл», владелец его принимает;
//   3. запустивший получает всегда и сюда не входит.
// Не ответил, «может быть», отклонил, не участник — не получает ни по одному из путей.
import type { GEvent } from "../meeting-current/select.ts";
import { conferenceInfo } from "../meeting-current/join-link.ts";
import { acceptedBySelf } from "./calendar-attendance.ts";
import { roomOf } from "./calendar-dispatch.ts";

/** Сколько календарей участников одного задания проверяем: страховка от встречи на сотню гостей. */
export const MAX_CALENDAR_CHECKS = 15;

export interface NoticeMember {
  telegram_id: number | null;
  email: string | null;
}

/** Что знает проверка о задании: комната, время, кто в событии запустившего и кто там принял. */
export interface NoticeJob {
  invited_by: number;
  join_url: string;
  starts_at: string;
  ends_at: string;
  attendee_emails?: string[];
  accepted_emails?: string[];
}

/** Доступ к календарям участников. `null` у `ownEvents` — календаря нет; исключение — Google не ответил. */
export interface CalendarAccess {
  ownEvents(telegramId: number, job: NoticeJob): Promise<GEvent[] | null>;
}

const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);

/**
 * Принял ли человек эту встречу по СВОЕМУ календарю: событие не отменено, та же комната, время
 * пересекается, его собственный ответ — accepted (или своя встреча без поля ответа).
 */
export function acceptedInOwnCalendar(
  events: readonly GEvent[],
  job: Pick<NoticeJob, "join_url" | "starts_at" | "ends_at">,
): boolean {
  const room = roomOf(job.join_url);
  return events.some((ev) => {
    const start = ev.start?.dateTime;
    const end = ev.end?.dateTime;
    if (ev.status === "cancelled" || start === undefined || end === undefined) return false;
    if (!overlaps(start, end, job.starts_at, job.ends_at)) return false;
    const url = conferenceInfo(ev).join_url;
    if (url === null || roomOf(url) !== room) return false;
    return acceptedBySelf(ev);
  });
}

/**
 * Получатели нотис, кроме запустившего: telegram_id участников воркспейса, принявших встречу.
 * Кандидаты — те, чья почта есть в событии запустившего (или в событиях склеенных с ним людей).
 */
export async function resolveNoticeRecipients(
  job: NoticeJob,
  members: readonly NoticeMember[],
  calendars: CalendarAccess,
  log: (line: string) => void = () => {},
): Promise<number[]> {
  const inEvent = new Set((job.attendee_emails ?? []).map(norm));
  const acceptedInEvent = new Set((job.accepted_emails ?? []).map(norm));
  const candidates = members.filter((m) => {
    const email = norm(m.email);
    return m.telegram_id !== null && m.telegram_id > 0 && m.telegram_id !== job.invited_by && email !== "" &&
      (inEvent.has(email) || acceptedInEvent.has(email));
  }).slice(0, MAX_CALENDAR_CHECKS * 4);

  const checked = await Promise.all(candidates.map(async (m, n) => {
    const id = m.telegram_id as number;
    if (n >= MAX_CALENDAR_CHECKS) return acceptedInEvent.has(norm(m.email)) ? id : null;
    try {
      const own = await calendars.ownEvents(id, job);
      if (own === null) return acceptedInEvent.has(norm(m.email)) ? id : null; // календаря нет
      return acceptedInOwnCalendar(own, job) ? id : null;
    } catch (e) {
      log(
        `notice-recipients: календарь ${id} не прочитан, нотису он не получит: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
  }));
  return checked.filter((id): id is number => id !== null).sort((a, b) => a - b);
}
