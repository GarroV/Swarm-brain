/**
 * Сборка входа «автозапуск по календарю» (T100) из живых частей: клиент `meeting-calendar`,
 * оркестратор, заявка и нотиса от имени владельца календаря. Правила — в `calendar-trigger.ts`;
 * здесь только провода, общие для службы (`orchestrator-main.ts`) и смоука.
 */
import { SwarmClient } from "../swarm-client/client.ts";
import { CalendarClient, type CalendarJob } from "./calendar-client.ts";
import { CalendarTrigger } from "./calendar-trigger.ts";
import { calendarClaim, type CalendarReference } from "./claim-request.ts";
import type { Notifier } from "./notices.ts";

export interface CalendarServiceOptions {
  /**
   * Корень функций Swarm, каким его видит сам оркестратор.
   */
  readonly swarmUrl: string;
  readonly token: string;
  readonly version: number;
  readonly startForMeeting: (
    joinUrl: string,
    platform: string,
    onBehalfOf: number,
    calendar: CalendarReference,
  ) => Promise<string>;
  readonly notifierFor: (onBehalfOf: number, token: string) => Notifier;
  readonly log: (line: string) => void;
  readonly intervalMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

function referenceOf(job: CalendarJob): CalendarReference {
  return {
    calendarKey: job.calendar_key,
    startsAt: job.starts_at,
    ...(job.grant_token !== undefined && { grantToken: job.grant_token }),
  };
}

export function calendarTriggerFor(options: CalendarServiceOptions): CalendarTrigger {
  const calendar = new CalendarClient({
    baseUrl: options.swarmUrl,
    token: options.token,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
  return new CalendarTrigger({
    sweep: async () => calendar.sweep(),
    start: async (job) =>
      options.startForMeeting(job.join_url, job.platform, job.invited_by, referenceOf(job)),
    // Нотисе `join_failed` нужна строка встречи — её заводит только `meeting-claim`, поэтому
    // сперва календарная заявка (сервер сверит встречу с календарём человека), затем отказ.
    // Отказ — по пропуску задания (T165): за человека общий токен не действует.
    refuse: async (job, detail) => {
      const token = job.grant_token ?? options.token;
      const client = new SwarmClient({
        baseUrl: options.swarmUrl,
        token,
        onBehalfOf: job.invited_by,
        ...(options.fetch !== undefined && { fetch: options.fetch }),
      });
      const claimed = await client.claim(
        calendarClaim({ version: options.version, calendar: referenceOf(job) }),
      );
      await options.notifierFor(job.invited_by, token).notify({
        kind: "join_failed",
        meetingId: claimed.meeting_id,
        detail,
      });
    },
    log: options.log,
    ...(options.intervalMs !== undefined && { intervalMs: options.intervalMs }),
  });
}
