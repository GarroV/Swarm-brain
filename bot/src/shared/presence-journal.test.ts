import { describe, expect, it } from "vitest";
import { PresenceJournal } from "./presence-journal.ts";

function capture() {
  const lines: string[] = [];
  const journal = new PresenceJournal((line) => {
    lines.push(line);
  });
  const last = () =>
    JSON.parse(lines.at(-1)?.slice("presence ".length) ?? "null") as {
      state: string;
      rosterComplete: boolean;
      indicatorChangedAt: number;
      participants: { key: string; kind: string; indicator: boolean | null }[];
      appeared: string[];
      disappeared: string[];
    };
  return { journal, lines, last };
}

const SELF = { id: "self", name: "Scriba Notetaker", self: true, audioLevel: 0 };
const PERSON = { id: "person", name: "Anna", audioLevel: 0 };

describe("presence evidence, independent of silence decisions", () => {
  it("keeps a silent person visible and does not invent fresh speech from a stuck indicator", () => {
    const { journal, lines, last } = capture();
    const tiles = [SELF, { ...PERSON, audioLevel: 1 }];
    journal.observe(tiles, 2, SELF.name, 0);
    journal.observe(tiles, 2, SELF.name, 1000);
    expect(lines).toHaveLength(1);
    journal.observe(tiles, 2, SELF.name, 60_000);
    expect(last().indicatorChangedAt).toBe(0);
    journal.observe([SELF, PERSON], 2, SELF.name, 70_000);
    journal.observe([SELF, PERSON], 2, SELF.name, 250_000);
    expect(last().state).toBe("participants_visible");
    expect(last().participants.find((p) => p.key === "person")?.indicator).toBe(false);
    expect(last().indicatorChangedAt).toBe(70_000);
  });

  it("distinguishes recorder names, partial rosters and unavailable signals", () => {
    const { journal, last } = capture();
    const tiles = [SELF, { id: "recorder", name: "Read.ai", audioLevel: 0 }];
    journal.observe(tiles, 2, SELF.name, 0);
    expect(last().state).toBe("only_self_or_recorder_names");
    journal.observe(tiles, 3, SELF.name, 1);
    expect(last().state).toBe("unknown");
    expect(last().rosterComplete).toBe(false);
    journal.observe([], null, SELF.name, 2);
    expect(last().state).toBe("unknown");
    expect(last().disappeared).toEqual(["recorder", "self"]);
  });

  it("logs visible roster changes without claiming they are room joins or exits", () => {
    const { journal, last } = capture();
    journal.observe([SELF, PERSON], 2, SELF.name, 0);
    journal.observe([SELF], 1, SELF.name, 1);
    expect(last().disappeared).toEqual(["person"]);
    expect(last().state).toBe("only_self_or_recorder_names");
    journal.observe([SELF, { id: "unknown", name: null }], 2, SELF.name, 2);
    expect(last().state).toBe("unknown");
    expect(last().appeared).toEqual(["unknown"]);
  });

  it("does not count duplicate Meet participant IDs as more people", () => {
    const { journal, last } = capture();
    journal.observe([SELF, PERSON, PERSON], 2, SELF.name, 0);
    expect(last().participants).toHaveLength(2);
    expect(last().rosterComplete).toBe(true);
  });

  it("keeps equal Kontur names distinct and does not treat a brand in a person's name as a bot", () => {
    const { journal, last } = capture();
    journal.observe(
      [
        { name: "Scriba Notetaker", speaking: false },
        { name: "Scriba Notetaker", speaking: false },
      ],
      2,
      "Scriba Notetaker",
      0,
    );
    expect(last().participants).toHaveLength(2);
    expect(last().state).toBe("only_self_or_recorder_names");
    journal.observe([{ name: "Anna from Read.ai", speaking: false }], null, SELF.name, 1);
    expect(last().state).toBe("participants_visible");
    expect(last().rosterComplete).toBe(false);
  });
});
