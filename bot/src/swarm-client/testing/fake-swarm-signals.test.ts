import { describe, expect, it } from "vitest";
import { takeSignalledInvite } from "./fake-swarm-signals.ts";
import type { InviteRecord } from "./fake-swarm-types.ts";

function row(id: string): InviteRecord {
  return {
    taken: false,
    used: false,
    invite: {
      id,
      invited_by: 744,
      platform: "meet",
      join_url: "https://meet.google.com/abc-defg-hij",
      created_at: "2026-11-28T00:00:00Z",
      expires_at: "2099-11-28T01:00:00Z",
      grant_token: `test-grant-${id}`,
    },
  };
}

describe("targeted push support in the smoke double", () => {
  it("takes one id, replays before acknowledgement, and leaves another invite untouched", () => {
    const one = row("one"),
      two = row("two");
    const rows = new Map([
      ["one", one],
      ["two", two],
    ]);
    const grants = new Set<string>();
    expect(takeSignalledInvite({ id: "one" }, rows, grants)?.responseBody.invites).toEqual([
      one.invite,
    ]);
    expect(takeSignalledInvite({ id: "one" }, rows, grants)?.responseBody.invites).toEqual([
      one.invite,
    ]);
    expect(takeSignalledInvite({ id: "one", started: true }, rows, grants)?.status).toBe(200);
    expect(takeSignalledInvite({ id: "one" }, rows, grants)?.responseBody.invites).toEqual([]);
    expect(two.taken).toBe(false);
    expect(grants).toEqual(new Set([one.invite.grant_token]));
  });

  it("unknown or expired delivery never becomes successful empty work", () => {
    const expired = row("expired");
    const rows = new Map([
      [
        "expired",
        { ...expired, invite: { ...expired.invite, expires_at: "2000-01-01T00:00:00Z" } },
      ],
    ]);
    expect(takeSignalledInvite({ id: "unknown" }, rows, new Set())?.status).toBe(404);
    expect(takeSignalledInvite({ id: "expired" }, rows, new Set())?.status).toBe(410);
  });
});
