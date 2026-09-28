// Претендент с более длинной записью, когда у держателя уже есть своя версия (T168): владелец
// встречи переходит вместе со стенограммой — только если осталась запись претендента.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rivalOwnershipPatch, rivalRecorders } from "./meeting-rival.ts";
import { CLAIM_LEASE_TTL_SEC } from "./claim-lease.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const HOLDER = 1;
const RIVAL = 2;

Deno.test("ЯДРО: победила запись претендента — к нему переходят владелец, его секунды и сдвиг mic", () => {
  const patch = rivalOwnershipPatch(RIVAL, { recordedSeconds: 2400, micStartOffset: 1.5 }, NOW);
  assertEquals(patch.claim_owner, RIVAL);
  assertEquals(patch.recorded_seconds, 2400);
  assertEquals(patch.mic_start_offset, 1.5);
  assertEquals(patch.agent_last_recording, false);
  assertEquals(Date.parse(String(patch.lease_expires_at)) - Date.parse(NOW), CLAIM_LEASE_TTL_SEC * 1000);
});

const list = [
  { telegram_id: HOLDER, claimed_at: NOW, role: "transcribe", recorded_seconds: 600 },
  { telegram_id: RIVAL, claimed_at: NOW, role: "challenger", recorded_seconds: 2400 },
];

Deno.test("ЯДРО: претендент победил — он transcribe, прежний держатель superseded", () => {
  const roles = rivalRecorders(list, RIVAL, 2400, true, HOLDER).map((r) => r.role);
  assertEquals(roles, ["superseded", "transcribe"]);
});

Deno.test("ЯДРО: осталась версия держателя — претендент defer, держатель не тронут", () => {
  const roles = rivalRecorders(list, RIVAL, 2400, false, HOLDER).map((r) => r.role);
  assertEquals(roles, ["transcribe", "defer"]);
});
