// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Какие встречи календаря бот берёт сам (T100, решения D015/D016). Чистые функции: хождение в
// Google и в базу — у функции meeting-calendar, здесь только отбор, чтобы границы проверялись
// без живого календаря.
//
// Правило модуля одно, и оно про тишину (D015): встреча в окне, на которую бот НЕ пойдёт, не
// пропадает молча — она уходит в пропуски с причиной. Молча пропускается лишь то, что встречей бота
// не является вовсе: вне окна, на весь день, отменённое.
//
// Ключ встречи — тот же, что у рекордера и у сверки meeting-claim (_shared/calendar-key.ts):
// бот заявляет встречу этим ключом, и сервер находит её в календаре того же человека.
import type { GEvent } from "../meeting-current/select.ts";
import { conferenceInfo } from "../meeting-current/join-link.ts";
import type { ConferencePlatform } from "../meeting-current/join-link.ts";
import { calendarKeyOf } from "./calendar-key.ts";
import { botJoinsPlatform, parseInviteLink } from "./meeting-invite.ts";

/**
 * За сколько до начала бот выходит на встречу. Контейнеру нужны секунды на подъём и заход, а стучаться
 * раньше времени — стоять у двери пустой комнаты. Две минуты — с запасом на минутный опрос.
 */
export const DISPATCH_LEAD_MS = 2 * 60_000;
/**
 * Насколько бот может опоздать. Оркестратор мог лежать, событие могли поставить на ходу; позже —
 * встреча идёт давно, и если бота не позвали руками, то, видимо, и не ждут.
 */
export const DISPATCH_LATE_MS = 10 * 60_000;

/** Задание боту: встреча и за кого он на неё идёт. */
export interface DispatchJob {
  calendar_key: string;
  invited_by: number;
  join_url: string;
  platform: ConferencePlatform;
  title: string | null;
  starts_at: string;
  ends_at: string;
}

export type SkipReason =
  | "no_conference_link"
  | "unsupported_platform"
  | "unrecognized_link"
  | "declined"
  | "manual_invite_exists"
  // Причины уровня человека (встречи не видно вовсе) — ставит meeting-calendar, не отбор.
  | "calendar_not_connected"
  | "calendar_token_dead"
  | "calendar_unavailable";

/** Встреча, на которую бот не пойдёт, и почему. У причин уровня человека ключа нет. */
export interface DispatchSkip {
  invited_by: number;
  calendar_key: string | null;
  title: string | null;
  reason: SkipReason;
  platform?: ConferencePlatform | null;
  /** Время встречи — у причин уровня встречи (у причин человека встречи нет). */
  starts_at?: string;
  ends_at?: string;
}

export interface DispatchPlan {
  jobs: DispatchJob[];
  skipped: DispatchSkip[];
}

/**
 * Время встречи, если она со временем и в окне. Строки начала и конца отдаются отсюда, а не
 * перечитываются из события: у события на весь день (`start.date`) или с концом без времени их нет,
 * и такое событие отсекается здесь, а не уезжает в задание или пропуск без времени.
 */
function windowSpan(ev: GEvent, nowMs: number): { starts_at: string; ends_at: string } | null {
  const starts_at = ev.start?.dateTime;
  const ends_at = ev.end?.dateTime;
  if (starts_at === undefined || ends_at === undefined) return null;
  const start = Date.parse(starts_at);
  const end = Date.parse(ends_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const open = start <= nowMs + DISPATCH_LEAD_MS && start >= nowMs - DISPATCH_LATE_MS && end > nowMs;
  return open ? { starts_at, ends_at } : null;
}

function declinedBySelf(ev: GEvent): boolean {
  return (ev.attendees ?? []).some((a) => a.self === true && a.responseStatus === "declined");
}

/**
 * Встречи одного человека в окне: задания и пропуски.
 *
 * @param manualRooms комнаты (`parseInviteLink().room`), куда человек воркспейса уже позвал бота
 *                    руками и приглашение живо: второго бота на ту же комнату не ведём.
 */
export function planPersonDispatch(
  events: GEvent[],
  person: number,
  nowMs: number,
  manualRooms: ReadonlySet<string>,
): DispatchPlan {
  const jobs: DispatchJob[] = [];
  const skipped: DispatchSkip[] = [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const span = windowSpan(ev, nowMs);
    if (span === null) continue;
    const key = calendarKeyOf(ev);
    if (key === null) continue;
    const title = ev.summary ?? null;
    const skip = (reason: SkipReason, platform?: ConferencePlatform | null) =>
      skipped.push({
        invited_by: person,
        calendar_key: key,
        title,
        reason,
        ...(platform !== undefined && { platform }),
        ...span,
      });

    if (declinedBySelf(ev)) {
      skip("declined");
      continue;
    }
    const info = conferenceInfo(ev);
    if (info.join_url === null) {
      skip("no_conference_link");
      continue;
    }
    if (info.platform === null || !botJoinsPlatform(info.platform)) {
      skip("unsupported_platform", info.platform);
      continue;
    }
    const link = parseInviteLink(info.join_url);
    if (link === null) {
      skip("unrecognized_link", info.platform);
      continue;
    }
    if (manualRooms.has(link.room)) {
      skip("manual_invite_exists", link.platform);
      continue;
    }
    jobs.push({
      calendar_key: key,
      invited_by: person,
      join_url: link.url,
      platform: link.platform,
      title,
      ...span,
    });
  }
  return { jobs, skipped };
}

/**
 * Свести планы людей одного воркспейса. Одна встреча — одно задание (за первого по порядку):
 * у двоих коллег в календаре одно событие, а бот на него нужен один. Пропуск встречи, на которую
 * задание уже есть, не громкий — бот туда идёт.
 */
export function mergeDispatch(plans: DispatchPlan[]): DispatchPlan {
  const jobs = new Map<string, DispatchJob>();
  for (const plan of plans) {
    for (const job of plan.jobs) if (!jobs.has(job.calendar_key)) jobs.set(job.calendar_key, job);
  }
  const skipped = plans
    .flatMap((p) => p.skipped)
    .filter((s) => s.calendar_key === null || !jobs.has(s.calendar_key));
  return { jobs: [...jobs.values()], skipped };
}
