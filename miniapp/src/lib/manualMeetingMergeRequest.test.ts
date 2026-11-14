import { assertEquals } from "@std/assert";
import {
  createManualMeetingMergeApi,
  type ManualMergeDecisionInput,
  manualMergeErrorKind,
} from "./manualMeetingMergeRequest.ts";

Deno.test("manual merge client reads without cache and sends only explicit decision, scope and snapshot", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const api = createManualMeetingMergeApi(
    <T>(url: string, options?: RequestInit) => {
      calls.push([url, options]);
      return Promise.resolve(null as T);
    },
  );
  await api.candidate("source/id?", "personal");
  const input = {
    target: { kind: "entry", id: "target", author: 100 },
    decision: "separate",
    base: "personal",
    snapshotToken: "opaque $&",
    actor: 100,
    content: "not a writable field",
  };
  await api.decide("source/id?", input as ManualMergeDecisionInput);
  assertEquals(calls, [
    ["/agent-meetings/source%2Fid%3F/manual-merge-candidate?base=personal", {
      cache: "no-store",
    }],
    ["/agent-meetings/source%2Fid%3F/manual-merge-decision", {
      method: "POST",
      body:
        '{"target":{"kind":"entry","id":"target"},"decision":"separate","base":"personal","snapshotToken":"opaque $&"}',
    }],
  ]);
});

Deno.test("manual merge conflicts require a fresh choice; server/provider text is never copied to UI", () => {
  assertEquals(
    manualMergeErrorKind({
      status: 409,
      body: { code: "MEETING_BUSY", error: "provider detail" },
    }),
    "busy",
  );
  for (const code of ["PAIR_CHANGED", "DECISION_EXISTS", "unknown"]) {
    assertEquals(
      manualMergeErrorKind({ status: 409, body: { code } }),
      "changed",
    );
  }
  assertEquals(manualMergeErrorKind({ status: 404 }), "missing");
  assertEquals(
    manualMergeErrorKind({ status: 503, body: { error: "provider detail" } }),
    "failed",
  );
  assertEquals(manualMergeErrorKind(new Error("network detail")), "failed");
});
