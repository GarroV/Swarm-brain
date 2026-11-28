import { sameSecret, validPushHeaders } from "../_shared/calendar-push-plan.ts";

export interface CalendarNotificationStore {
  channel(
    id: string,
  ): Promise<
    { telegram_id: number; token: string; resource_id: string | null; state: string; expires_at: string } | null
  >;
  dirty(person: number): Promise<void>;
}

/** Receipt means the dirty generation is durable, not that an in-memory task was scheduled. */
export async function receiveCalendarNotification(
  req: Request,
  store: CalendarNotificationStore,
  now = Date.now(),
): Promise<Response> {
  const fail = (status: number) => new Response(null, { status });
  if (req.method !== "POST") return fail(405);
  if (!validPushHeaders(req.headers)) return fail(401);
  const channel = await store.channel(req.headers.get("x-goog-channel-id")!);
  if (
    !channel || !await sameSecret(req.headers.get("x-goog-channel-token")!, channel.token) ||
    Date.parse(channel.expires_at) <= now || channel.state === "stopping"
  ) return fail(401);
  // Google can send sync before watch returns. Do not bind an unverified resource from that POST.
  if (channel.resource_id === null) return fail(503);
  if (req.headers.get("x-goog-resource-id") !== channel.resource_id) return fail(401);
  await store.dirty(channel.telegram_id);
  return fail(204);
}
