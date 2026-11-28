import { describe, expect, it, vi } from "vitest";
import { inviteTriggerFor, type InviteServiceOptions } from "./invite-service.ts";
import { signalHandler } from "./signal-handler.ts";

const ID = "b5be2737-b161-4912-9a22-dc4572c6ddc9";
const SECRET = "test-signal-secret-for-hermetic-requests";

function noLog(): void {
  // No log output in hermetic checks.
}
function noDispatch(): Promise<void> {
  return Promise.resolve();
}
function request(body: unknown, secret: string): Request {
  return new Request("https://scriba.internal/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scriba-Signal-Secret": secret },
    body: JSON.stringify(body),
  });
}
async function status(
  handler: (request: Request) => Promise<Response>,
  body: unknown = null,
  secret = SECRET,
): Promise<number> {
  const response = await handler(request(body ?? { kind: "invite", id: ID }, secret));
  return response.status;
}
function deferred() {
  let resolve: () => void = noLog;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Project lib is ES2023.
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

describe("internal work signal", () => {
  it("missing or incorrect secret never dispatches work", async () => {
    const dispatch = vi.fn(noDispatch);
    const handler = signalHandler({ secret: SECRET, dispatch, log: noLog });
    expect(await status(handler, null, "")).toBe(401);
    expect(await status(handler, null, "incorrect")).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "invite", id: ID, join_url: "https://meet.google.com/abc-defg-hij" },
    { kind: "other", id: ID },
    { kind: "calendar", id: "invalid" },
    [],
  ])("rejects invalid or extra fields", async (body) => {
    const dispatch = vi.fn(noDispatch);
    const handler = signalHandler({ secret: SECRET, dispatch, log: noLog });
    expect(await status(handler, body)).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("limits request body before parsing", async () => {
    const handler = signalHandler({ secret: SECRET, dispatch: noDispatch, log: noLog });
    const body = "x".repeat(1025);
    expect(await status(handler, body)).toBe(413);
  });

  it("idle handler performs no background requests", async () => {
    vi.useFakeTimers();
    try {
      const dispatch = vi.fn(noDispatch);
      signalHandler({ secret: SECRET, dispatch, log: noLog });
      await vi.advanceTimersByTimeAsync(86_400_000);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("concurrent duplicate waits for the same completed work", async () => {
    const running = deferred();
    const started = deferred();
    const dispatch = vi.fn(async () => {
      started.resolve();
      await running.promise;
    });
    const handler = signalHandler({ secret: SECRET, dispatch, log: noLog });
    const first = status(handler);
    await started.promise;
    const second = status(handler);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    running.resolve();
    expect(await first).toBe(200);
    expect(await second).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["take", "ack"])(
    "transient %s failure remains retryable and starts only once",
    async (failAt) => {
      const bodies: unknown[] = [];
      let shouldFail = true;
      const start = vi.fn<InviteServiceOptions["startForMeeting"]>(() =>
        Promise.resolve("container-1"),
      );
      const trigger = inviteTriggerFor({
        swarmUrl: "https://swarm.test/functions/v1",
        token: "service-test-token",
        version: 1,
        startForMeeting: start,
        notifierFor: () => ({
          notify: () => Promise.resolve({ delivered: true, shouldLeave: false }),
        }),
        log: noLog,
        fetch: (_url, init) => {
          const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null");
          bodies.push(body);
          const isAck = typeof body === "object" && body !== null && "started" in body;
          if (shouldFail && isAck === (failAt === "ack")) {
            shouldFail = false;
            return Promise.resolve(new Response("retry", { status: 503 }));
          }
          return Promise.resolve(
            Response.json({
              ok: true,
              invites: isAck
                ? []
                : [
                    {
                      id: ID,
                      invited_by: 744,
                      platform: "meet",
                      join_url: "https://meet.google.com/abc-defg-hij",
                      created_at: "2026-11-28T00:00:00Z",
                      expires_at: "2099-11-28T01:00:00Z",
                      grant_token: "test-grant",
                    },
                  ],
            }),
          );
        },
      });
      const handler = signalHandler({
        secret: SECRET,
        dispatch: async (signal) => trigger.dispatch(signal.id),
        log: noLog,
      });
      expect(await status(handler)).toBe(503);
      expect(await status(handler)).toBe(200);
      expect(start).toHaveBeenCalledTimes(1);
      expect(bodies.at(-1)).toEqual({ id: ID, started: true });
      expect(start.mock.calls[0]?.[3]).toEqual({
        id: ID,
        joinUrl: "https://meet.google.com/abc-defg-hij",
        grantToken: "test-grant",
      });
    },
  );
});
