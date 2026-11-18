import { ok } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "./orchestrator.ts";
import {
  deferred,
  FakeEgress,
  FakeEngine,
  NoticeCapture,
  settle,
} from "../../test-support/orchestrator.ts";

const ROOM = "https://team.ktalk.ru/meeting-room";
const FIRST = {
  calendarKey: "first:2026-11-18",
  startsAt: "2026-11-18T12:00:00Z",
  grantToken: "first-pass",
};
const SECOND = {
  calendarKey: "second:2026-11-18",
  startsAt: "2026-11-18T12:00:00.000Z",
  grantToken: "second-pass",
};

describe("calendar physical slot", () => {
  let directory: string;
  let engine: FakeEngine;
  let orchestrator: Orchestrator;
  let egress: FakeEgress;
  const instances: Orchestrator[] = [];

  function build(selectedEngine = engine): Orchestrator {
    let sequence = 0;
    const instance = new Orchestrator({
      engine: selectedEngine,
      egress,
      project: "slot-test",
      image: "scriba:test",
      leaseDirectory: directory,
      swarmUrl: "https://swarm.example/functions/v1",
      token: "test-token",
      version: 1,
      notifierFor: new NoticeCapture().forRecipient,
      newRunId: () => `run-${String(++sequence)}`,
      log: vi.fn(),
    });
    instances.push(instance);
    return instance;
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-calendar-slot-"));
    engine = new FakeEngine();
    egress = new FakeEgress();
    orchestrator = build();
  });
  afterEach(async () => {
    for (const instance of instances.splice(0)) instance.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  it("two calendar identities and people at the same room/start create one container", async () => {
    const first = await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    const second = await orchestrator.startForMeeting(ROOM, "kontur", 202, SECOND);
    expect(engine.specs).toHaveLength(1);
    expect(second).toBe(first);
    expect(engine.calls.filter((call) => call.startsWith("start:"))).toHaveLength(1);
    expect(engine.specs[0]?.env).toContain("SCRIBA_CALENDAR_KEY=first:2026-11-18");
    expect(engine.specs[0]?.env).toContain("SCRIBA_ON_BEHALF_OF=101");
    expect(engine.specs[0]?.env).toContain("SCRIBA_BOT_TOKEN=first-pass");
  });
  it("reserves a pending slot before asynchronous preparation", async () => {
    const gate = deferred<{ network: string; proxyUrl: string }>();
    const prepare = vi.spyOn(egress, "prepare").mockReturnValue(gate.promise);
    const first = orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    const second = orchestrator.startForMeeting(ROOM, "kontur", 202, SECOND);
    const both = Promise.all([first, second]);
    try {
      await settle();
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve({ network: "test-network", proxyUrl: "https://proxy.example" });
    }
    const [a, b] = await both;
    expect(a).toBe(b);
    expect(engine.specs).toHaveLength(1);
  });

  it.each([
    ["different room", "https://team.ktalk.ru/other", SECOND.startsAt],
    ["different start", ROOM, "2026-11-18T12:01:00Z"],
  ])("%s remains a separate container", async (_name, room, startsAt) => {
    await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    await orchestrator.startForMeeting(room, "kontur", 202, { ...SECOND, startsAt });
    expect(engine.specs).toHaveLength(2);
  });

  it("normalizes the room and equivalent UTC instants, not calendar identities", async () => {
    const first = await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    const duplicate = await orchestrator.startForMeeting(
      "https://TEAM.ktalk.ru/MEETING-ROOM/?lang=ru#join",
      "kontur",
      202,
      { ...SECOND, startsAt: "2026-11-18T13:00:00+01:00" },
    );
    expect(duplicate).toBe(first);
    expect(engine.specs).toHaveLength(1);
  });

  it("failed launch releases the slot for a retry", async () => {
    engine.shouldFailStart = true;
    await expect(orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST)).rejects.toThrow();
    engine.shouldFailStart = false;
    await expect(orchestrator.startForMeeting(ROOM, "kontur", 202, SECOND)).resolves.toBe("c2");
    expect(engine.specs).toHaveLength(2);
  });

  it("container exit releases the slot", async () => {
    const first = await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    engine.exit(first, 0);
    await orchestrator.whenExited(first);
    const next = await orchestrator.startForMeeting(ROOM, "kontur", 202, SECOND);
    expect(next).not.toBe(first);
    expect(engine.specs).toHaveLength(2);
  });

  it("adopts the room/start label after restart", async () => {
    await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    const spec = engine.specs[0];
    ok(spec);
    const labels = spec.labels;
    expect(labels["scriba.calendar-slot"]).toMatch(/^[a-f0-9]{64}$/u);
    const recovered = new FakeEngine();
    recovered.existing = [{ id: "previous", running: true, labels }];
    const restarted = build(recovered);
    await restarted.init();
    expect(await restarted.startForMeeting(ROOM, "kontur", 202, SECOND)).toBe("previous");
    expect(recovered.specs).toHaveLength(0);
  });

  it("adopts the whitelisted legacy slot supplied by the engine", async () => {
    await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    const slot = engine.specs[0]?.labels["scriba.calendar-slot"];
    ok(slot);
    const recovered = new FakeEngine();
    recovered.existing = [
      {
        id: "legacy",
        running: true,
        labels: {
          "scriba.calendar": FIRST.calendarKey,
          "scriba.run": "legacy-run",
          "scriba.on-behalf-of": "101",
        },
        calendarSlot: slot,
      },
    ];
    const restarted = build(recovered);
    await restarted.init();
    expect(await restarted.startForMeeting(ROOM, "kontur", 202, SECOND)).toBe("legacy");
    expect(recovered.specs).toHaveLength(0);
  });

  it("a duplicate still requires its own nonempty server grant", async () => {
    await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    await expect(
      orchestrator.startForMeeting(ROOM, "kontur", 202, { ...SECOND, grantToken: "" }),
    ).rejects.toThrow(/пропуск/u);
    expect(engine.specs).toHaveLength(1);
  });

  it("manual invitations retain separate launches even in the same room", async () => {
    await orchestrator.startForMeeting(ROOM, "kontur", 101, {
      id: "invite-one",
      joinUrl: ROOM,
      grantToken: "first-pass",
    });
    await orchestrator.startForMeeting(ROOM, "kontur", 202, {
      id: "invite-two",
      joinUrl: ROOM,
      grantToken: "second-pass",
    });
    expect(engine.specs).toHaveLength(2);
    expect(engine.specs.every((spec) => spec.labels["scriba.calendar-slot"] === undefined)).toBe(
      true,
    );
  });
  it("an exit during launch cannot leave a fulfilled pending reservation behind", async () => {
    vi.spyOn(engine, "start").mockImplementationOnce((id) => {
      engine.exit(id, 0);
      return Promise.resolve();
    });
    const first = await orchestrator.startForMeeting(ROOM, "kontur", 101, FIRST);
    await orchestrator.whenExited(first);
    expect(await orchestrator.startForMeeting(ROOM, "kontur", 202, SECOND)).not.toBe(first);
    expect(engine.specs).toHaveLength(2);
  });
});
