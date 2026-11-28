import { createHash } from "node:crypto";
import { isCalendarBasis, type MeetingBasis } from "./claim-request.ts";
import type { ContainerEngine, EngineContainer } from "./engine.ts";
import { LABEL } from "./meeting-basis.ts";

export class RetryableWorkError extends Error {}

export function deliveryKey(basis: MeetingBasis): string | null {
  const id = isCalendarBasis(basis) ? basis.jobId : basis.id;
  if (id === undefined) return null;
  return createHash("sha256")
    .update(`${isCalendarBasis(basis) ? "calendar" : "invite"}:${id}`)
    .digest("hex");
}

export function deliveryLabel(basis: MeetingBasis): Record<string, string> {
  const key = deliveryKey(basis);
  return key === null ? {} : { [LABEL.delivery]: key };
}

export function deliveryName(project: string, runId: string, basis: MeetingBasis): string {
  return `${project}-meeting-${deliveryKey(basis) ?? runId}`;
}

/**
 * Docker's unique name closes the gap between successful launch and durable server acknowledgement.
 */
export async function deliverOnce(input: {
  readonly engine: ContainerEngine;
  readonly project: string;
  readonly person: number;
  readonly basis: MeetingBasis;
  readonly launch: () => Promise<string>;
  readonly adopt: (container: EngineContainer) => void;
}): Promise<string> {
  const key = deliveryKey(input.basis);
  if (key === null) return input.launch();
  const find = async (): Promise<string | null> => {
    let containers: EngineContainer[];
    try {
      containers = await input.engine.listByLabel(LABEL.delivery, key);
    } catch (error) {
      throw new RetryableWorkError("delivery lookup unavailable; retry", { cause: error });
    }
    const own = containers.filter(
      (container) =>
        container.labels[LABEL.project] === input.project &&
        container.labels[LABEL.onBehalfOf] === String(input.person),
    );
    const running = own.find((container) => container.running);
    if (running !== undefined) {
      input.adopt(running);
      return running.id;
    }
    if (own.length > 0) throw new RetryableWorkError("delivery container has not started; retry");
    return null;
  };
  const existing = await find();
  if (existing !== null) return existing;
  try {
    return await input.launch();
  } catch (error) {
    const concurrent = await find();
    if (concurrent !== null) return concurrent;
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 409
    ) {
      throw new RetryableWorkError("concurrent delivery launch; retry", { cause: error });
    }
    throw error;
  }
}
