// Google watch uses the existing calendar.events.readonly grant; no OAuth scope expansion.
// https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
import { externalFetch } from "./external-fetch.ts";
import type { GEvent } from "../meeting-current/select.ts";

export interface WatchChannel {
  id: string;
  resourceId: string;
  expiration: number;
}
const BASE = "https://www.googleapis.com/calendar/v3";

async function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const result = await externalFetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }, { service: "google-calendar", timeoutMs: 8_000, attempts: 1 });
  if (!result.ok) {
    // Do not retain Google response bodies, calendar IDs or credentials in queue errors/logs.
    throw new Error(`calendar_google_${result.status}`);
  }
  return result;
}

export async function watchCalendar(
  token: string,
  id: string,
  channelToken: string,
  address: string,
): Promise<WatchChannel> {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("calendar_webhook_invalid");
  }
  const result = await request("/calendars/primary/events/watch", token, {
    method: "POST",
    body: JSON.stringify({ id, token: channelToken, type: "web_hook", address, params: { ttl: "604800" } }),
  });
  const body = await result.json();
  const expiration = Number(body.expiration);
  if (
    body.id !== id || typeof body.resourceId !== "string" || !body.resourceId ||
    !Number.isFinite(expiration) || expiration <= Date.now()
  ) throw new Error("calendar_watch_invalid_response");
  return { id, resourceId: body.resourceId, expiration };
}

export async function stopCalendar(token: string, id: string, resourceId: string): Promise<void> {
  try {
    await request("/channels/stop", token, { method: "POST", body: JSON.stringify({ id, resourceId }) });
  } catch (error) {
    // An expired/already-stopped channel is terminal, not a reason to keep old credentials.
    if (error instanceof Error && ["calendar_google_404", "calendar_google_410"].includes(error.message)) return;
    throw error;
  }
}

/** Complete bounded snapshot: never reconcile a partial page set as deletions. */
export async function futureCalendarEvents(token: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const events: GEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: "250",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await request(`/calendars/primary/events?${query}`, token);
    const body = await result.json();
    if (!body || typeof body !== "object" || (body.items !== undefined && !Array.isArray(body.items))) {
      throw new Error("calendar_events_invalid_response");
    }
    events.push(...(body.items ?? []));
    if (!body.nextPageToken) return events;
    if (typeof body.nextPageToken !== "string") throw new Error("calendar_events_invalid_cursor");
    pageToken = body.nextPageToken;
  }
  throw new Error("calendar_snapshot_too_large");
}
