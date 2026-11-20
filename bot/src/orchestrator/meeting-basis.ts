import { isCalendarBasis, type MeetingBasis } from "./claim-request.ts";
import { MEETING_ENV } from "./config.ts";

export const LABEL = {
  project: "scriba.project",
  run: "scriba.run",
  onBehalfOf: "scriba.on-behalf-of",
  platform: "scriba.platform",
  invite: "scriba.invite",
  calendar: "scriba.calendar",
  calendarSlot: "scriba.calendar-slot",
} as const;

export function basisEnvironment(basis: MeetingBasis | null): Record<string, string> {
  if (basis === null) return {};
  if (isCalendarBasis(basis)) {
    return {
      [MEETING_ENV.calendarKey]: basis.calendarKey,
      [MEETING_ENV.calendarStartsAt]: basis.startsAt,
      ...(basis.title !== undefined && { [MEETING_ENV.calendarTitle]: basis.title }),
    };
  }
  return { [MEETING_ENV.inviteId]: basis.id, [MEETING_ENV.inviteJoinUrl]: basis.joinUrl };
}

export function basisLabel(basis: MeetingBasis | null): Record<string, string> {
  if (basis === null) return {};
  return isCalendarBasis(basis)
    ? { [LABEL.calendar]: basis.calendarKey }
    : { [LABEL.invite]: basis.id };
}

export function validOnBehalfOf(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`onBehalfOf должен быть telegram id человека, получено ${String(value)}`);
  }
  return value;
}
