import { randomUUID } from "node:crypto";
import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { UploadQueue } from "../swarm-client/queue.ts";
import { recoveryQueueClient } from "../swarm-client/upload-recovery.ts";
import { adoptOrphanedRuns, ALIVE_TOUCH_MS, runQueueRoot, touchAlive } from "./run-directories.ts";

/**
One finite job: no browser, no call, no audio capture, only durable queue parts.
*/
export async function recoverUploads(options: {
  directory: string;
  person: number;
  baseUrl: string;
  serviceToken: string;
  log: (line: string) => void;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  if (!Number.isSafeInteger(options.person) || options.person <= 0)
    throw new Error("invalid recovery person");
  const personDirectory = path.join(options.directory, "queue", String(options.person));
  const runId = `resend-${randomUUID()}`;
  const root = runQueueRoot(personDirectory, runId);
  await touchAlive(root);
  let heartbeat = Promise.resolve();
  const touch = async (previous: Promise<void>): Promise<void> => {
    await previous;
    try {
      await touchAlive(root);
    } catch (error) {
      options.log(`досылка: alive не обновлён: ${String(error)}`);
    }
  };
  const alive = setInterval(() => {
    heartbeat = touch(heartbeat);
  }, ALIVE_TOUCH_MS);
  try {
    const moved = await adoptOrphanedRuns({
      personDirectory,
      ownRunId: runId,
      nowMs: Date.now(),
      recoverFailed: true,
      log: options.log,
    });
    if (moved === 0) return;
    const queue = new UploadQueue({
      root,
      client: recoveryQueueClient(options),
      onEvent: (event) => {
        options.log(`досылка: ${event.kind} ${event.meetingId}`);
      },
    });
    const result = await queue.drain();
    options.log(
      `досылка: принято ${String(result.uploaded.length)}, ждут ${String(result.retryable.length)}, требуют разбора ${String(result.deadLettered.length)}`,
    );
  } finally {
    clearInterval(alive);
    await heartbeat;
    const files = await readdir(root);
    if (files.length === 1 && files[0] === "alive") await rm(root, { recursive: true });
  }
}
