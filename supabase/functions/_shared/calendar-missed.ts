// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Пропуски автозапуска по календарю (T102, решения D015/D022). Чистые функции: что считается
// пропуском, под каким ключом он хранится (таблица meeting_calendar_misses), когда по нему можно
// позвать бота руками и что о нём сказать человеку. Показывает пропуск рекордер человека (bumblebee,
// функция meeting-missed); пишут его meeting-calendar (на опросе оркестратора), meeting-calendar-snapshot
// (причины уровня человека, по расписанию) и meeting-missed (на опросе рекордера — по снимку календаря,
// _shared/calendar-snapshot.ts: так пропуск виден, даже когда оркестратор лежит и не опрашивает ничего).
//
// Что считается пропуском. Правило одно: человек включил автозапуск и ЖДЁТ бота на этой встрече.
//   пропуск: unsupported_platform (встреча не в Meet), unrecognized_link (ссылку в событии не разобрали),
//            calendar_not_connected / calendar_token_dead (бот не видит НИ ОДНОЙ встречи человека),
//            not_picked_up (встреча началась, а задания нет или его никто не забрал — служба
//            автозапуска не отозвалась), not_arrived (забрал, но в звонке не появился и сам ничего не
//            сказал: контейнер упал до двери, оркестратор умер после забора);
//   не пропуск: no_conference_link — событие без ссылки обычно не созвон (обед, фокус, встреча
//            вживую); declined, not_accepted — человек сам не идёт или не сказал «да» (D024); manual_invite_exists — бот уже идёт по ручному
//            приглашению; calendar_unavailable — Google моргнул, опрос повторится через минуту.
//
// Сколько раз. Пропуск встречи — один на встречу и причину (ключ = ключ встречи). Причина человека
// встречи не имеет — один в сутки команды (ключ `autojoin:<дата по Белграду>`).
import type { DispatchJob, DispatchSkip } from "./calendar-dispatch.ts";
import { NO_TITLE } from "./notice-texts.ts";

/** После начала встречи: задания всё нет или его никто не забрал — служба автозапуска не отозвалась. */
export const PICKUP_GRACE_MS = 3 * 60_000;
/** После забора задания: бот обязан подать heartbeat или сам сказать человеку об отказе. */
export const ARRIVAL_GRACE_MS = 6 * 60_000;

/** Часовой пояс команды: по нему сутки для причин уровня человека. */
export const TEAM_TIME_ZONE = "Europe/Belgrade";

export const MISS_REASONS = [
  "unsupported_platform",
  "unrecognized_link",
  "calendar_not_connected",
  "calendar_token_dead",
  "not_picked_up",
  "not_arrived",
] as const;
export type MissReason = (typeof MISS_REASONS)[number];

/** Пропуск, как он лежит в meeting_calendar_misses (без служебных колонок). */
export interface MissRecord {
  invited_by: number;
  miss_key: string;
  calendar_key: string | null;
  reason: MissReason;
  title: string | null;
  join_url: string | null;
  platform: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

const FROM_SKIP: ReadonlySet<string> = new Set([
  "unsupported_platform",
  "unrecognized_link",
  "calendar_not_connected",
  "calendar_token_dead",
]);
const PERSON_LEVEL: ReadonlySet<string> = new Set(["calendar_not_connected", "calendar_token_dead"]);
/** По каким причинам бот в эту комнату вообще может пойти — только тогда зовём руками. */
const INVITABLE: ReadonlySet<MissReason> = new Set(["not_picked_up", "not_arrived"]);

/** Дата в часовом поясе команды. */
export function teamDate(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Ключ пропуска уровня человека: один на сутки команды. */
export function personMissKey(nowMs: number): string {
  return `autojoin:${teamDate(nowMs)}`;
}

/** Пропуск из прохода по календарю, или null, если это не пропуск. */
export function missFromSkip(skip: DispatchSkip, nowMs: number): MissRecord | null {
  if (!FROM_SKIP.has(skip.reason)) return null;
  const reason = skip.reason as MissReason;
  if (PERSON_LEVEL.has(reason)) {
    return {
      invited_by: skip.invited_by,
      miss_key: personMissKey(nowMs),
      calendar_key: null,
      reason,
      title: null,
      join_url: null,
      platform: null,
      starts_at: null,
      ends_at: null,
    };
  }
  if (skip.calendar_key === null) return null;
  return {
    invited_by: skip.invited_by,
    miss_key: skip.calendar_key,
    calendar_key: skip.calendar_key,
    reason,
    title: skip.title,
    join_url: null,
    platform: skip.platform ?? null,
    starts_at: skip.starts_at ?? null,
    ends_at: skip.ends_at ?? null,
  };
}

/** Забранное задание, как его видит проверка «дошёл ли бот». */
export interface ArrivalJob {
  calendar_key: string;
  invited_by: number;
  title: string | null;
  join_url: string;
  platform: string;
  starts_at: string;
  ends_at: string;
  taken_at: string | null;
}

function fromJob(job: DispatchJob | ArrivalJob, person: number, reason: MissReason): MissRecord {
  return {
    invited_by: person,
    miss_key: job.calendar_key,
    calendar_key: job.calendar_key,
    reason,
    title: job.title,
    join_url: job.join_url,
    platform: job.platform,
    starts_at: job.starts_at,
    ends_at: job.ends_at,
  };
}

/** Что известно о встрече: бот подал heartbeat · человеку по встрече уже ушла нотиса бота. */
export interface ArrivalEvidence {
  botSeen: boolean;
  noticeSent: boolean;
}

/** Пора ли спрашивать, дошёл ли бот: запас после забора прошёл, встреча ещё идёт. */
export function arrivalCheckDue(job: ArrivalJob, nowMs: number): boolean {
  if (job.taken_at === null) return false;
  const taken = Date.parse(job.taken_at);
  const ends = Date.parse(job.ends_at);
  if (Number.isNaN(taken) || Number.isNaN(ends)) return false;
  return taken + ARRIVAL_GRACE_MS <= nowMs && nowMs < ends;
}

/**
 * Бот забрал задание, не подал признака жизни и сам человеку ничего не сказал → пропуск.
 * @param person за кого пропуск: владелец задания или коллега, у которого та же встреча.
 */
export function notArrivedMiss(
  job: ArrivalJob,
  evidence: ArrivalEvidence,
  person: number = job.invited_by,
): MissRecord | null {
  if (evidence.botSeen || evidence.noticeSent) return null;
  return fromJob(job, person, "not_arrived");
}

/** Ожидаемые встречи человека (бот должен быть там) и пропуски, видные по самому календарю. */
export interface OngoingPlan {
  jobs: DispatchJob[];
  misses: MissRecord[];
}

/**
 * Ожидаемая встреча без забранного задания после запаса → служба автозапуска не отозвалась.
 * @param row задание в meeting_calendar_jobs, если оно заведено.
 */
export function pickupMiss(
  job: DispatchJob,
  row: { taken_at: string | null } | null,
  nowMs: number,
  person: number = job.invited_by,
): MissRecord | null {
  if (row !== null && row.taken_at !== null) return null;
  const start = Date.parse(job.starts_at);
  const end = Date.parse(job.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (nowMs < start + PICKUP_GRACE_MS || nowMs >= end) return null;
  return fromJob(job, person, "not_picked_up");
}

/** Можно ли по пропуску позвать бота руками одним действием (приглашение D017). */
export function canInvite(miss: MissRecord): boolean {
  return INVITABLE.has(miss.reason) && miss.join_url !== null && miss.platform === "meet";
}

type Lang = "en" | "ru";

const PLATFORM_NAME: Readonly<Record<string, string>> = { zoom: "Zoom", kontur: "Kontur.Talk" };

/** Что сказать человеку о пропуске — обычный текст, EN и RU (рекордер показывает на своём языке). */
export function missMessage(miss: MissRecord): Record<Lang, string> {
  const t = { en: miss.title ?? NO_TITLE.en, ru: miss.title ?? NO_TITLE.ru };
  switch (miss.reason) {
    case "unsupported_platform": {
      const p = miss.platform === null ? undefined : PLATFORM_NAME[miss.platform];
      return {
        en: `"${t.en}" is on ${
          p ?? "another service"
        }, and scriba only joins Google Meet — it won't come to this meeting.`,
        ru: `«${t.ru}» идёт в ${
          p ?? "другом сервисе"
        }, а scriba ходит только в Google Meet — на эту встречу он не придёт.`,
      };
    }
    case "unrecognized_link":
      return {
        en: `"${t.en}": scriba couldn't read the Google Meet link in the calendar event, so it won't join on its own.`,
        ru: `«${t.ru}»: scriba не разобрал ссылку на Google Meet в событии календаря и сам не придёт.`,
      };
    case "calendar_not_connected":
      return {
        en: "scriba autostart is on, but no Google Calendar is connected — the bot can't see your meetings.",
        ru: "Автозапуск scriba включён, но Google-календарь не подключён — бот не видит ваших встреч.",
      };
    case "calendar_token_dead":
      return {
        en: "scriba lost access to your Google Calendar — reconnect it; until then the bot won't come on its own.",
        ru: "scriba потерял доступ к вашему Google-календарю — переподключите его, до тех пор бот сам не придёт.",
      };
    case "not_picked_up":
      return {
        en: `"${t.en}" has started, but scriba's autostart didn't pick it up — the bot isn't coming.`,
        ru: `«${t.ru}» уже идёт, а автозапуск scriba её не подхватил — бот не придёт.`,
      };
    case "not_arrived":
      return {
        en: `"${t.en}": scriba was on its way but never made it into the call — the meeting isn't being recorded.`,
        ru: `«${t.ru}»: scriba выехал на встречу, но в звонок так и не попал — встреча не записывается.`,
      };
  }
}
