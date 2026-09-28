// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Снимок календаря для пропусков автозапуска (T164, решение D023). Чистые функции.
//
// Зачем снимок. Рекордер человека спрашивает meeting-missed «бот не пришёл?» часто, и раньше каждый
// такой запрос шёл в Google (T102). Квота Calendar API общая на проект, а ответ меняется редко:
// сервер снимает календарь людей с автозапуском по расписанию (функция meeting-calendar-snapshot,
// таблицы meeting_calendar_snapshot_runs / _events), а запрос рекордера читает только базу.
//
// Когда. SNAPSHOT_HOURS по Белграду: 08:00 — до первых встреч рабочего дня (они с 09:00), 11:00 —
// «через три часа», 12:00 — «и ещё через час» (формулировка владельца, D023). Встречу, поставленную
// после 12:00, снимок не увидит — её при живом оркестраторе подхватывает минутный опрос
// meeting-calendar; при лежащем оркестраторе пропуск по ней не виден. Это принятая цена D023.
// Час считается в коде, а не в pg_cron: cron работает в UTC, а Белград дважды в год переводит часы.
//
// Что в снимке. Весь остаток дня (до полуночи по Белграду), каждая встреча оценена тем же отбором,
// что у оркестратора, как будто сейчас момент её начала: ожидаемая (бот должен прийти) или громкая
// причина, видная по самому событию (не Meet, ссылка не разобралась). Не встречи бота (нет ссылки,
// отклонил, отменено, на весь день) в снимок не идут. «Уже позвали руками» решается при чтении —
// приглашение могли завести после снимка.
import type { GEvent } from "../meeting-current/select.ts";
import type { ConferencePlatform } from "../meeting-current/join-link.ts";
import { type DispatchJob, planPersonDispatch } from "./calendar-dispatch.ts";
import { missFromSkip, type MissRecord, type OngoingPlan, TEAM_TIME_ZONE, teamDate } from "./calendar-missed.ts";
import { parseInviteLink } from "./meeting-invite.ts";

/** Часы снимка по Белграду: слот — весь час (cron мог опоздать на минуты). */
export const SNAPSHOT_HOURS: readonly number[] = [8, 11, 12];

export const SNAPSHOT_OUTCOMES = ["expected", "unsupported_platform", "unrecognized_link"] as const;
export type SnapshotOutcome = (typeof SNAPSHOT_OUTCOMES)[number];

/** Встреча дня в снимке — строка meeting_calendar_snapshot_events без служебных колонок. */
export interface SnapshotEvent {
  calendar_key: string;
  outcome: SnapshotOutcome;
  title: string | null;
  /** Только у ожидаемой: туда бот идёт и туда его можно позвать руками. */
  join_url: string | null;
  platform: ConferencePlatform | null;
  starts_at: string;
  ends_at: string;
}

export const RUN_OUTCOMES = ["ok", "calendar_not_connected", "calendar_token_dead", "calendar_unavailable"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Последняя попытка снять календарь человека — строка meeting_calendar_snapshot_runs. */
export interface SnapshotRun {
  /** Когда календарь последний раз прочитан успешно; строки снимка несут это же время. */
  snapshot_at: string | null;
  attempted_at: string;
  outcome: RunOutcome;
}

/** Смещение часового пояса команды от UTC в момент `ms`, в миллисекундах. */
function teamOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(ms / 1000) * 1000;
}

/** Час по Белграду (0–23). */
export function teamHour(nowMs: number): number {
  return new Date(nowMs + teamOffsetMs(nowMs)).getUTCHours();
}

/** Пора ли снимать: сейчас час из SNAPSHOT_HOURS по Белграду. */
export function snapshotDue(nowMs: number): boolean {
  return SNAPSHOT_HOURS.includes(teamHour(nowMs));
}

/** Ближайшая полночь по Белграду после `nowMs` (конец суток команды), в мс UTC. */
export function endOfTeamDay(nowMs: number): number {
  const [y, m, d] = teamDate(nowMs).split("-").map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d + 1);
  // Смещение берём у самой полуночи, а не у «сейчас»: в день перевода часов они разные. Белград
  // переводит часы в 01:00 UTC, так что смещение в полночь по UTC совпадает с местной полуночью.
  return midnightAsUtc - teamOffsetMs(midnightAsUtc);
}

function timed(ev: GEvent): { startMs: number } | null {
  const startMs = Date.parse(ev.start?.dateTime ?? "");
  const endMs = Date.parse(ev.end?.dateTime ?? "");
  return Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs ? null : { startMs };
}

/** Встречи дня из календаря человека — в строки снимка. */
export function snapshotEvents(events: GEvent[], person: number): SnapshotEvent[] {
  const rows: SnapshotEvent[] = [];
  for (const ev of events) {
    const span = timed(ev);
    if (span === null) continue;
    const plan = planPersonDispatch([ev], person, span.startMs, new Set());
    for (const job of plan.jobs) {
      rows.push({
        calendar_key: job.calendar_key,
        outcome: "expected",
        title: job.title,
        join_url: job.join_url,
        platform: job.platform,
        starts_at: new Date(Date.parse(job.starts_at)).toISOString(),
        ends_at: new Date(Date.parse(job.ends_at)).toISOString(),
      });
    }
    for (const s of plan.skipped) {
      if (s.reason !== "unsupported_platform" && s.reason !== "unrecognized_link") continue;
      if (s.calendar_key === null || s.starts_at === undefined || s.ends_at === undefined) continue;
      rows.push({
        calendar_key: s.calendar_key,
        outcome: s.reason,
        title: s.title,
        join_url: null,
        platform: s.platform ?? null,
        starts_at: new Date(Date.parse(s.starts_at)).toISOString(),
        ends_at: new Date(Date.parse(s.ends_at)).toISOString(),
      });
    }
  }
  return rows;
}

/**
 * Встречи из снимка, которые идут сейчас: ожидаемые (сверяются с заданиями) и пропуски по самому
 * событию. `manualRooms` — комнаты, куда воркспейс уже позвал бота руками.
 */
export function ongoingFromSnapshot(
  rows: readonly SnapshotEvent[],
  person: number,
  nowMs: number,
  manualRooms: ReadonlySet<string>,
): OngoingPlan {
  const jobs: DispatchJob[] = [];
  const misses: MissRecord[] = [];
  for (const row of rows) {
    const start = Date.parse(row.starts_at);
    const end = Date.parse(row.ends_at);
    if (Number.isNaN(start) || Number.isNaN(end) || start > nowMs || end <= nowMs) continue;
    if (row.outcome === "expected") {
      const link = parseInviteLink(row.join_url);
      if (link === null || manualRooms.has(link.room)) continue;
      jobs.push({
        calendar_key: row.calendar_key,
        invited_by: person,
        join_url: link.url,
        platform: link.platform,
        title: row.title,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
      });
      continue;
    }
    const miss = missFromSkip({
      invited_by: person,
      calendar_key: row.calendar_key,
      title: row.title,
      reason: row.outcome,
      platform: row.platform,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    }, nowMs);
    if (miss !== null) misses.push(miss);
  }
  return { jobs, misses };
}

const DEFINITIVE: ReadonlySet<RunOutcome> = new Set(["calendar_not_connected", "calendar_token_dead"]);

/**
 * Есть ли сегодня ответ по календарю человека: снимок за сегодня, или сегодняшняя попытка сказала,
 * что календаря нет / доступ умер (тогда пропуск уровня человека записан, это и есть ответ).
 */
export function snapshotChecked(run: SnapshotRun | null, nowMs: number): boolean {
  if (run === null) return false;
  const today = teamDate(nowMs);
  const sameDay = (iso: string | null) =>
    iso !== null && !Number.isNaN(Date.parse(iso)) && teamDate(Date.parse(iso)) === today;
  if (DEFINITIVE.has(run.outcome) && sameDay(run.attempted_at)) return true;
  return sameDay(run.snapshot_at);
}
