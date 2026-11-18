import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import { DockerodeEngine } from "./docker-engine.ts";
import { calendarSlotKey } from "./calendar-slot.ts";

const ROOM = "https://team.ktalk.ru/meeting-room";
const START = "2026-11-18T12:00:00Z";
const labels = { "scriba.calendar": "separate-calendar-key", "scriba.project": "slot-test" };

function engineFor(storedLabels: Record<string, string>, environment: string[]) {
  const inspect = vi.fn().mockResolvedValue({ Config: { Env: environment } });
  const docker = {
    listContainers: vi
      .fn()
      .mockResolvedValue([{ Id: "existing", State: "running", Labels: storedLabels }]),
    getContainer: vi.fn().mockReturnValue({ inspect }),
  };
  return { engine: new DockerodeEngine(docker as unknown as Docker), inspect };
}

describe("legacy calendar slot recovery", () => {
  it("derives only a hash from the three allowed fields, without exporting environment", async () => {
    const { engine, inspect } = engineFor(labels, [
      `SCRIBA_JOIN_URL=${ROOM}`,
      "SCRIBA_PLATFORM=kontur",
      `SCRIBA_CALENDAR_STARTS_AT=${START}`,
      "SCRIBA_BOT_TOKEN=synthetic-must-not-escape",
      "UNRELATED=value=with=equals",
    ]);
    const found = await engine.listByLabel("scriba.project", "slot-test");
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(found).toEqual([
      {
        id: "existing",
        running: true,
        labels,
        calendarSlot: calendarSlotKey("kontur", ROOM, START),
      },
    ]);
    expect(JSON.stringify(found)).not.toContain("synthetic-must-not-escape");
    expect(JSON.stringify(found)).not.toContain("UNRELATED");
  });

  it("uses the new slot label without inspecting environment", async () => {
    const slot = calendarSlotKey("kontur", ROOM, START);
    const { engine, inspect } = engineFor({ ...labels, "scriba.calendar-slot": slot }, []);
    const found = await engine.listByLabel("scriba.project", "slot-test");
    expect(found[0]?.calendarSlot).toBe(slot);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("does not inspect or classify manual containers", async () => {
    const { engine, inspect } = engineFor({ "scriba.invite": "manual" }, [
      `SCRIBA_JOIN_URL=${ROOM}`,
      "SCRIBA_PLATFORM=kontur",
      `SCRIBA_CALENDAR_STARTS_AT=${START}`,
    ]);
    const found = await engine.listByLabel("scriba.project", "slot-test");
    expect(found[0]?.calendarSlot).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
  });
  it("a legacy container disappearing before inspect does not abort recovery", async () => {
    const { engine, inspect } = engineFor(labels, []);
    inspect.mockRejectedValueOnce({ statusCode: 404 });
    expect(await engine.listByLabel("scriba.project", "slot-test")).toEqual([
      { id: "existing", running: false, labels },
    ]);
  });
});
