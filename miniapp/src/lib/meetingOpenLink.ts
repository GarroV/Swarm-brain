/** Explicit null disables browser entry; undefined supports older API deployments. */
export function meetingOpenLink(meeting: { join_url: string | null; open_url?: string | null }): string | null {
  const raw = meeting.open_url === undefined ? meeting.join_url : meeting.open_url;
  if (!raw) return null;
  try { return new URL(raw).protocol === "https:" ? raw : null; } catch { return null; }
}
