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
import { acceptedBySelf } from "./calendar-attendance.ts";
import { botJoinsPlatform, parseInviteLink } from "./meeting-invite.ts";
import { BOT_PROFILE } from "./bot-profile.ts";

/**
 * За сколько до начала бот выходит на встречу. Контейнеру нужны секунды на подъём и заход, а стучаться
 * раньше времени — стоять у двери пустой комнаты. Значение — в профиле бота (autojoin.leadMs).
 */
export const DISPATCH_LEAD_MS = BOT_PROFILE.autojoin.leadMs;
/**
 * Насколько бот может опоздать. Оркестратор мог лежать, событие могли поставить на ходу; позже —
 * встреча идёт давно, и если бота не позвали руками, то, видимо, и не ждут.
 */
export const DISPATCH_LATE_MS = BOT_PROFILE.autojoin.lateMs;

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
  // Человек не ответил «да» («может быть», не ответил, событие без его строки) — D024.
  | "not_accepted"
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
  /** Люди, чью встречу бот запишет по чужому событию той же комнаты (dropSameRoom). */
  joined?: Array<{ into: string; person: number }>;
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

/** Пойдёт ли бот на встречу без оглядки на время: ответ человека и ссылка на площадку бота. */
export type JoinVerdict =
  | { ok: true; link: NonNullable<ReturnType<typeof parseInviteLink>> }
  | { ok: false; reason: SkipReason; platform?: ConferencePlatform | null };

/**
 * Правило встречи — одно на обход календаря (planPersonDispatch) и на проверку календаря у
 * переключателя (_shared/autojoin-calendar.ts): проверка обязана считать ровно те встречи, на которые
 * бот действительно пойдёт, иначе «бот видит N встреч» разойдётся с тем, куда он придёт.
 */
export function joinVerdict(ev: GEvent): JoinVerdict {
  // Бот идёт только туда, где человек ответил «да» (D024, _shared/calendar-attendance.ts).
  // Отклонённое — своей причиной: так пропуск читается без догадок.
  if (declinedBySelf(ev)) return { ok: false, reason: "declined" };
  if (!acceptedBySelf(ev)) return { ok: false, reason: "not_accepted" };
  const info = conferenceInfo(ev);
  if (info.join_url === null) return { ok: false, reason: "no_conference_link" };
  if (info.platform === null || !botJoinsPlatform(info.platform)) {
    return { ok: false, reason: "unsupported_platform", platform: info.platform };
  }
  const link = parseInviteLink(info.join_url);
  if (link === null) return { ok: false, reason: "unrecognized_link", platform: info.platform };
  return { ok: true, link };
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

    const verdict = joinVerdict(ev);
    if (!verdict.ok) {
      skip(verdict.reason, verdict.platform);
      continue;
    }
    const link = verdict.link;
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
/** Комната встречи: одна ссылка в разных событиях календаря — одна комната. */
export const roomOf = (joinUrl: string): string => parseInviteLink(joinUrl)?.room ?? joinUrl.trim();

type RoomSlot = Pick<DispatchJob, "calendar_key" | "join_url" | "starts_at" | "ends_at">;

const overlaps = (a: RoomSlot, b: RoomSlot) =>
  Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);

/**
 * Одна комната — один бот. У двух людей встреча может стоять РАЗНЫМИ событиями календаря на одну
 * ссылку (каждому прислали своё приглашение, серию разрезали «это и следующие»): ключи встречи
 * разные, комната одна. 07.10.2026 так в комнату Контура пришли два бота (IT+BD). Задание в комнату,
 * куда в пересекающееся время бот уже идёт по другому событию (`existing` или раньше в `jobs`),
 * отбрасывается. Это не пропуск: бот в комнате будет. Его человек — в `joined`: он получит доступ
 * к записи как совладелец (meeting_calendar_jobs.co_invited → meeting-claim).
 */
export function dropSameRoom(
  jobs: readonly DispatchJob[],
  existing: readonly RoomSlot[],
): { kept: DispatchJob[]; joined: Array<{ into: string; person: number }> } {
  const kept: DispatchJob[] = [];
  const joined: Array<{ into: string; person: number }> = [];
  for (const job of jobs) {
    const room = roomOf(job.join_url);
    const twin = [...existing, ...kept].find((e) =>
      e.calendar_key !== job.calendar_key && roomOf(e.join_url) === room && overlaps(e, job)
    );
    if (twin) joined.push({ into: twin.calendar_key, person: job.invited_by });
    else kept.push(job);
  }
  return { kept, joined };
}

export function mergeDispatch(plans: DispatchPlan[]): DispatchPlan {
  const byKey = new Map<string, DispatchJob>();
  for (const plan of plans) {
    for (const job of plan.jobs) if (!byKey.has(job.calendar_key)) byKey.set(job.calendar_key, job);
  }
  const { kept, joined } = dropSameRoom([...byKey.values()], []);
  const jobs = new Map(kept.map((j) => [j.calendar_key, j]));
  const skipped = plans
    .flatMap((p) => p.skipped)
    .filter((s) => s.calendar_key === null || !jobs.has(s.calendar_key));
  return { jobs: [...jobs.values()], skipped, joined };
}
