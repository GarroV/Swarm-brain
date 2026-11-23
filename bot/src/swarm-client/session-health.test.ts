import { expect, it } from "vitest";
import { SwarmClient } from "./client.ts";
import { SwarmHttpError } from "./errors.ts";
import { UploadQueue } from "./queue.ts";
import { RecordingSession } from "./session.ts";

it("журнал отличает доставку heartbeat от отказа и сохраняет исходную ошибку", async () => {
  const lines: string[] = [];
  let status = 200;
  let isHealthy = false;
  const client = new SwarmClient({
    baseUrl: "https://swarm.example/functions/v1",
    token: "secret-not-for-log",
    onBehalfOf: 1,
    retry: { attempts: 1, sleep: () => Promise.resolve() },
    fetch: () => Promise.resolve(Response.json({ ok: true }, { status })),
  });
  const session = new RecordingSession({
    client,
    queue: new UploadQueue({ root: "/unused", client }),
    claim: { identity_kind: "calendar", identity_key: "event-key" },
    version: 1,
    audioHealthy: () => isHealthy,
    log: (line) => {
      lines.push(line);
    },
  });
  await session.heartbeat();
  await session.heartbeat();
  status = 503;
  await expect(session.heartbeat()).rejects.toBeInstanceOf(SwarmHttpError);
  status = 200;
  await session.heartbeat();
  isHealthy = true;
  await session.heartbeat();
  const events: Record<string, unknown>[] = lines.map(
    (line) => JSON.parse(line.slice("capture-transport ".length)) as Record<string, unknown>,
  );
  expect(events.map((event) => event.result)).toEqual([
    "http_ok",
    "request_failed",
    "http_ok",
    "http_ok",
  ]);
  expect(events[1]).toMatchObject({ meetingKey: "event-key", isHealthy: false, status: 503 });
  expect(events[3]).toMatchObject({ isHealthy: true });
  expect(lines.join("\n")).not.toContain("secret-not-for-log");
});
