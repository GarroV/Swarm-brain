import { describe, expect, it, vi } from "vitest";
import { FakeEngine } from "../../test-support/orchestrator.ts";
import type { MeetingBasis } from "./claim-request.ts";
import type { EngineContainer } from "./engine.ts";
import { LABEL } from "./meeting-basis.ts";
import { deliverOnce, deliveryKey, deliveryName, RetryableWorkError } from "./work-delivery.ts";

const BASIS = {
  id: "b5be2737-b161-4912-9a22-dc4572c6ddc9",
  joinUrl: "https://meet.google.com/abc-defg-hij",
};
function container(isRunning = true): EngineContainer {
  return {
    id: "existing",
    running: isRunning,
    labels: {
      [LABEL.project]: "stand",
      [LABEL.onBehalfOf]: "744",
      [LABEL.delivery]: deliveryKey(BASIS) ?? "",
    },
  };
}

describe("durable delivery container identity", () => {
  it("same job has the same Docker name across random run IDs", () => {
    expect(deliveryName("stand", "run-1", BASIS)).toBe(deliveryName("stand", "run-2", BASIS));
    const calendar: MeetingBasis = {
      jobId: BASIS.id,
      calendarKey: "event:2026-11-28",
      startsAt: "2026-11-28T10:00:00Z",
    };
    expect(deliveryKey(calendar)).not.toBe(deliveryKey(BASIS));
  });

  it("restart adopts the existing running delivery without creating another", async () => {
    const engine = new FakeEngine();
    vi.spyOn(engine, "listByLabel").mockResolvedValue([container()]);
    const launch = vi.fn(() => Promise.resolve("new"));
    const adopt = vi.fn();
    expect(
      await deliverOnce({ engine, project: "stand", person: 744, basis: BASIS, launch, adopt }),
    ).toBe("existing");
    expect(launch).not.toHaveBeenCalled();
    expect(adopt).toHaveBeenCalledWith(container());
  });

  it("created but not started delivery is retryable, never treated as complete", async () => {
    const engine = new FakeEngine();
    vi.spyOn(engine, "listByLabel").mockResolvedValue([container(false)]);
    await expect(
      deliverOnce({
        engine,
        project: "stand",
        person: 744,
        basis: BASIS,
        launch: () => Promise.resolve("new"),
        adopt: () => {
          // No adoption on refusal.
        },
      }),
    ).rejects.toBeInstanceOf(RetryableWorkError);
  });

  it("concurrent Docker name winner is recovered after create conflict", async () => {
    const engine = new FakeEngine();
    vi.spyOn(engine, "listByLabel").mockResolvedValueOnce([]).mockResolvedValueOnce([container()]);
    expect(
      await deliverOnce({
        engine,
        project: "stand",
        person: 744,
        basis: BASIS,
        launch: () => Promise.reject(Object.assign(new Error("conflict"), { statusCode: 409 })),
        adopt: () => {
          // Adoption metadata is checked in the restart case.
        },
      }),
    ).toBe("existing");
  });
});
