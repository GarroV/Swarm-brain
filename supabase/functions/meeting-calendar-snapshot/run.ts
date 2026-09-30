// meeting-calendar-snapshot — проход снимка (T164, D023). index.ts подставляет настоящие Supabase и
// Google, тест — поддельные.
//
// По каждому человеку с автозапуском: календарь остатка дня (до полуночи по Белграду) → строки
// снимка; итог попытки → строка человека. Календаря нет / доступ умер — пропуск уровня человека
// пишется сразу (один в сутки, ключ autojoin:<дата>), его покажет рекордер. Google не ответил —
// прежний снимок остаётся в силе, двигается только время попытки. Сбой одного человека не
// останавливает остальных.
import type { GEvent } from "../meeting-current/select.ts";
import type { TokenResult } from "../_shared/google-calendar.ts";
import { missFromSkip, type MissRecord } from "../_shared/calendar-missed.ts";
import { endOfTeamDay, type RunOutcome, type SnapshotEvent, snapshotEvents } from "../_shared/calendar-snapshot.ts";

export interface SnapshotPerson {
  telegramId: number;
  groupId: string;
}

/** Строка человека: snapshot_at — только у успешной попытки, иначе прежний не трогается. */
export interface RunWrite {
  attempted_at: string;
  outcome: RunOutcome;
  snapshot_at?: string;
}

export interface SnapshotDeps {
  /** Люди с включённым автозапуском, у кого есть воркспейс. */
  people(): Promise<SnapshotPerson[]>;
  refreshToken(telegramId: number): Promise<string | null>;
  accessToken(refresh: string): Promise<TokenResult>;
  listEvents(token: string, timeMin: string, timeMax: string, maxResults: number): Promise<GEvent[] | null>;
  saveEvents(person: SnapshotPerson, snapshotAt: string, rows: readonly SnapshotEvent[]): Promise<void>;
  saveRun(person: SnapshotPerson, run: RunWrite): Promise<void>;
  recordMisses(groupId: string, misses: readonly MissRecord[]): Promise<void>;
  log(line: string): void;
}

export interface SnapshotReport {
  people: number;
  ok: number;
  calendar_not_connected: number;
  calendar_token_dead: number;
  calendar_unavailable: number;
  /** Сбой базы на человеке — его снимок не обновлён. */
  failed: number;
  events: number;
}

/** Встреч за остаток дня у человека — десятки; предел страхует от странного ответа. */
export const MAX_EVENTS = 100;

async function personMiss(deps: SnapshotDeps, person: SnapshotPerson, reason: Failure, nowMs: number) {
  const miss = missFromSkip({ invited_by: person.telegramId, calendar_key: null, title: null, reason }, nowMs);
  if (miss !== null) await deps.recordMisses(person.groupId, [miss]);
}

type Failure = Exclude<RunOutcome, "ok">;

/** Календарь человека на остаток дня, или почему его не прочитать. */
async function readCalendar(deps: SnapshotDeps, person: SnapshotPerson, nowMs: number): Promise<GEvent[] | Failure> {
  const refresh = await deps.refreshToken(person.telegramId);
  if (!refresh) return "calendar_not_connected";
  const tok = await deps.accessToken(refresh);
  if (!tok.ok) return tok.deadGrant ? "calendar_token_dead" : "calendar_unavailable";
  const timeMin = new Date(nowMs).toISOString();
  const timeMax = new Date(endOfTeamDay(nowMs)).toISOString();
  return await deps.listEvents(tok.token, timeMin, timeMax, MAX_EVENTS) ?? "calendar_unavailable";
}

/** Снять календарь одного человека. Возвращает итог и число встреч; бросает только сбой базы. */
async function snapPerson(
  deps: SnapshotDeps,
  person: SnapshotPerson,
  nowMs: number,
): Promise<{ outcome: RunOutcome; events: number }> {
  const nowIso = new Date(nowMs).toISOString();
  const got = await readCalendar(deps, person, nowMs);
  if (typeof got === "string") {
    await personMiss(deps, person, got, nowMs);
    await deps.saveRun(person, { attempted_at: nowIso, outcome: got });
    return { outcome: got, events: 0 };
  }
  if (got.length >= MAX_EVENTS) {
    deps.log(`meeting-calendar-snapshot: ${person.telegramId} — ${got.length} событий, снимок по первым`);
  }
  const rows = snapshotEvents(got, person.telegramId);
  // Сначала встречи, потом время снимка у человека: иначе читатель увидит новое время без строк.
  await deps.saveEvents(person, nowIso, rows);
  await deps.saveRun(person, { attempted_at: nowIso, outcome: "ok", snapshot_at: nowIso });
  return { outcome: "ok", events: rows.length };
}

export async function snapshotAll(deps: SnapshotDeps, nowMs: number): Promise<SnapshotReport> {
  const people = await deps.people();
  const report: SnapshotReport = {
    people: people.length,
    ok: 0,
    calendar_not_connected: 0,
    calendar_token_dead: 0,
    calendar_unavailable: 0,
    failed: 0,
    events: 0,
  };
  for (const person of people) {
    try {
      const res = await snapPerson(deps, person, nowMs);
      report[res.outcome] += 1;
      report.events += res.events;
    } catch (e) {
      report.failed += 1;
      deps.log(`meeting-calendar-snapshot: ${person.telegramId} — сбой: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
