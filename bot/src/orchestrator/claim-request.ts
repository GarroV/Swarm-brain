/**
 * Тело `meeting-claim` для ручной встречи бота — одно на процесс встречи в контейнере и на
 * отказ оркестратора (площадка без адаптера), чтобы оба заявлялись одинаково.
 *
 * Ключ `scriba:<runId>`: каждая ручная встреча своя, арбитража с календарной нет (решение
 * D006 — бок о бок с bumblebee). Приглашение (решение D017) — единственное, что пускает
 * служебного агента в ручную встречу: без него сервер отвечает 403.
 */
import type { ClaimRequest } from "../swarm-client/contract.ts";

export interface InviteReference {
  readonly id: string;
  /**
   * Ссылка на звонок; сервер сверяет её комнату с комнатой приглашения.
   */
  readonly joinUrl: string;
}

export function manualClaim(input: {
  readonly runId: string;
  readonly version: number;
  readonly startedAt: string;
  readonly invite: InviteReference | null;
}): ClaimRequest {
  return {
    identity_kind: "manual",
    identity_key: `scriba:${input.runId}`,
    started_at: input.startedAt,
    agent_version: `scriba-${String(input.version)}`,
    recorded_seconds: 0,
    ...(input.invite !== null && {
      invite_id: input.invite.id,
      join_url: input.invite.joinUrl,
    }),
  };
}

/**
 * Календарная встреча (T100): оркестратор взял задание `meeting-calendar`. Бот заявляет её
 * ключом события — тем же, что у рекордера, — и сервер сам сверяет, что встреча в календаре
 * человека (D016). Приглашение здесь не нужно и не предъявляется.
 */
export interface CalendarReference {
  /**
   * `<iCalUID|id>:<YYYY-MM-DD>` — `_shared/calendar-key.ts` на сервере.
   */
  readonly calendarKey: string;
  /**
   * Начало встречи по календарю: с ним заявка выглядит как заявка рекордера на ту же встречу.
   */
  readonly startsAt: string;
}

/**
 * На каком основании бот идёт на встречу: приглашение из веба или событие календаря.
 */
export type MeetingBasis = InviteReference | CalendarReference;

export function isCalendarBasis(basis: MeetingBasis): basis is CalendarReference {
  return "calendarKey" in basis;
}

export function calendarClaim(input: {
  readonly version: number;
  readonly calendar: CalendarReference;
}): ClaimRequest {
  return {
    identity_kind: "calendar",
    identity_key: input.calendar.calendarKey,
    started_at: input.calendar.startsAt,
    agent_version: `scriba-${String(input.version)}`,
    recorded_seconds: 0,
  };
}

/**
 * Заявка по основанию: календарная — ключом события, иначе ручная (с приглашением, если оно есть).
 */
export function claimFor(input: {
  readonly runId: string;
  readonly version: number;
  readonly startedAt: string;
  readonly basis: MeetingBasis | null;
}): ClaimRequest {
  const { basis } = input;
  if (basis !== null && isCalendarBasis(basis)) {
    return calendarClaim({ version: input.version, calendar: basis });
  }
  return manualClaim({ ...input, invite: basis });
}
