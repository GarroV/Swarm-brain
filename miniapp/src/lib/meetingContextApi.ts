import { mcpApiFetch } from "./api";
import type { MeetingContextView } from "./api-types/meeting-context";

export function fetchMeetingContext(input: { entryId: string } | { calendarKey: string }): Promise<MeetingContextView> {
  const path = "entryId" in input
    ? `/meetings/${encodeURIComponent(input.entryId)}/context`
    : `/calendar/today/context?${new URLSearchParams({ key: input.calendarKey, tz_offset: String(-new Date().getTimezoneOffset()) })}`;
  return mcpApiFetch<MeetingContextView>(path, { cache: "no-store" });
}
