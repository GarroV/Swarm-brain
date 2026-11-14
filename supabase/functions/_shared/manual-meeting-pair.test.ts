import { assertEquals } from "@std/assert";
import { hasManualRefusal, manualPairAllowed, manualPairBusy, sameManualPair } from "./manual-meeting-pair.ts";

const source = {
  id: "source",
  group_id: "fixture",
  identity_kind: "manual",
  status: "awaiting_review",
  recorders: [{ telegram_id: 1 }],
  co_owners: [],
  draft_notes_md: "Synthetic source notes",
};
const target = { ...source, id: "target", identity_kind: "calendar", status: "in_base", co_owners: [2] };
const entry = { group_id: "fixture", owner_id: 1, is_private: false, shared_with: [], archived_at: null };

Deno.test("a refusal for an open meeting still matches after the target is published", () => {
  const refused = { sourceId: "source", meetingId: "target", entryId: null, decision: "separate" as const };
  assertEquals(
    hasManualRefusal(
      [refused],
      "source",
      { meetingId: null, entryId: "published" },
      new Map([["target", "published"]]),
    ),
    true,
  );
  assertEquals(sameManualPair(refused, "other-source", { meetingId: "target", entryId: null }, new Map()), false);
  assertEquals(
    sameManualPair(refused, "source", { meetingId: "other-target", entryId: "unrelated" }, new Map()),
    false,
  );
});

Deno.test("a different recording version of the same published entry is not a new refused pair", () => {
  const refused = { sourceId: "source", meetingId: "target", entryId: null, decision: "separate" as const };
  assertEquals(
    hasManualRefusal(
      [refused],
      "source",
      { meetingId: "new-version", entryId: null },
      new Map([
        ["target", "published"],
        ["new-version", "published"],
      ]),
    ),
    true,
  );
  assertEquals(
    hasManualRefusal([{ ...refused, decision: "merge" }], "source", { meetingId: "target", entryId: null }, new Map()),
    false,
  );
});

Deno.test("published pairs retain both existing mutation guards and every original owner's access", () => {
  assertEquals(manualPairAllowed(source, target, entry, 1, "fixture", false), true);
  assertEquals(
    manualPairAllowed(
      source,
      { ...target, recorders: [{ telegram_id: 2 }], co_owners: [] },
      entry,
      1,
      "fixture",
      false,
    ),
    false,
  );
  assertEquals(manualPairAllowed({ ...source, co_owners: [3] }, target, entry, 1, "fixture", false), false);
});

Deno.test("readable foreign-owned published entry is not a mutation capability", () => {
  assertEquals(manualPairAllowed(source, target, entry, 1, "fixture", false), true);
  assertEquals(manualPairAllowed(source, target, { ...entry, owner_id: 2 }, 1, "fixture", false), false);
  assertEquals(manualPairAllowed(source, target, { ...entry, archived_at: "2026-11-14" }, 1, "fixture", false), false);
});

Deno.test("a public entry does not replace the original reader's existing backing-draft authority", () => {
  const sourceWithPeer = { ...source, co_owners: [2] };
  const targetWithoutPeer = { ...target, recorders: [{ telegram_id: 1 }], co_owners: [], claim_owner: 1 };
  assertEquals(manualPairAllowed(sourceWithPeer, targetWithoutPeer, entry, 1, "fixture", false), false);
  assertEquals(
    manualPairAllowed(sourceWithPeer, { ...targetWithoutPeer, co_owners: [2] }, entry, 1, "fixture", false),
    true,
  );
});

Deno.test("self, non-manual, other-home and incompatible storage are refused", () => {
  assertEquals(manualPairAllowed(source, source, null, 1, "fixture", false), false);
  assertEquals(manualPairAllowed({ ...source, identity_kind: "calendar" }, target, null, 1, "fixture", false), false);
  assertEquals(manualPairAllowed(source, { ...target, group_id: "other" }, null, 1, "fixture", false), false);
  assertEquals(manualPairAllowed(source, target, entry, 1, "fixture", true), false);
  assertEquals(manualPairAllowed(source, target, { ...entry, is_private: true }, 1, "fixture", false), false);
});

Deno.test("recording, processing and incomplete source rows cannot create a background merge intent", () => {
  assertEquals(manualPairBusy(source, target), false);
  assertEquals(manualPairBusy({ ...source, status: "recording" }, target), true);
  assertEquals(manualPairBusy(source, { ...target, status: "processing" }), true);
  assertEquals(manualPairBusy(source, { ...target, summary_status: "processing" }), true);
  assertEquals(manualPairBusy({ ...source, draft_notes_md: " " }, target), true);
  assertEquals(manualPairBusy({ ...source, manual_merge_target_id: "canonical" }, target), true);
});
