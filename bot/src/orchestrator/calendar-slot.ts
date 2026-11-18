import { createHash } from "node:crypto";
import { MEETING_ENV, parsePlatform } from "./config.ts";
import { joinUrlFor } from "./join-url.ts";

/**
 * Physical admission only: never substitutes a calendar identity, owner or grant.
 */
export function calendarSlotKey(platform: string, joinUrl: string, startsAt: string): string {
  const known = parsePlatform(platform);
  const url = new URL(joinUrlFor(known, joinUrl));
  const time = Date.parse(startsAt);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(startsAt) || !Number.isFinite(time)) {
    throw new TypeError("calendar slot start must be an instant with a timezone");
  }
  let pathname = url.pathname;
  while (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  const room = `${url.hostname}${pathname}`.toLowerCase();
  return createHash("sha256")
    .update(JSON.stringify([known, room, new Date(time).toISOString()]))
    .digest("hex");
}

/**
 * Inspect only these non-secret fields when adopting pre-label calendar containers.
 */
export function calendarSlotFromEnvironment(environment: readonly string[]): string | null {
  const fields = new Map<string, string>();
  const allowed = new Set<string>([
    MEETING_ENV.joinUrl,
    MEETING_ENV.platform,
    MEETING_ENV.calendarStartsAt,
  ]);
  for (const line of environment) {
    const at = line.indexOf("=");
    const key = line.slice(0, at);
    if (at > 0 && allowed.has(key)) fields.set(key, line.slice(at + 1));
  }
  const room = fields.get(MEETING_ENV.joinUrl);
  const platform = fields.get(MEETING_ENV.platform);
  const start = fields.get(MEETING_ENV.calendarStartsAt);
  if (room === undefined || platform === undefined || start === undefined) return null;
  try {
    return calendarSlotKey(platform, room, start);
  } catch {
    return null;
  }
}

/**
 * Instance scope is the orchestrator's existing project/workspace boundary.
 */
export class CalendarSlots {
  private readonly pending = new Map<string, Promise<string>>();
  private readonly containers = new Map<string, string>();

  start(slot: string | null, launch: () => Promise<string>): Promise<string> {
    if (slot === null) return launch();
    const existing = this.pending.get(slot);
    if (existing !== undefined) return existing;
    // Reserve synchronously, before launch performs its first asynchronous preparation.
    const started = (async () => {
      await Promise.resolve();
      return launch();
    })();
    this.pending.set(slot, started);
    void started.catch(() => {
      if (this.pending.get(slot) === started) this.pending.delete(slot);
    });
    return started;
  }

  adopt(slot: string | undefined, id: string): void {
    if (slot === undefined) return;
    this.containers.set(id, slot);
    if (!this.pending.has(slot)) this.pending.set(slot, Promise.resolve(id));
  }

  release(id: string): void {
    const slot = this.containers.get(id);
    if (slot === undefined) return;
    this.containers.delete(id);
    // Existing duplicate containers are never stopped here; keep the room occupied
    // until the final adopted holder exits.
    const remaining = [...this.containers].find(([, key]) => key === slot);
    if (remaining === undefined) this.pending.delete(slot);
    else this.pending.set(slot, Promise.resolve(remaining[0]));
  }
}
