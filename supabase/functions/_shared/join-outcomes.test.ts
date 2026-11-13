// Исходы заходов бота (#1244): какая нотиса какой исход несёт, как «не пойдёт» календаря становится
// строкой, и что сбой записи не бросает.
import { assertEquals } from "@std/assert";
import { NOTICE_KINDS } from "./notices.ts";
import { JOIN_OUTCOMES, outcomeOfNotice, type OutcomeRecord, recordOutcomes } from "./join-outcomes.ts";

Deno.test("исходы: каждый вид нотисы либо несёт известный исход, либо промежуточный", () => {
  for (const kind of NOTICE_KINDS) {
    const outcome = outcomeOfNotice(kind, true);
    if (outcome !== null) assertEquals(JOIN_OUTCOMES.includes(outcome), true, `${kind} → ${outcome}`);
  }
});

Deno.test("исходы: «жду у двери» — исход только когда боту сказано уходить", () => {
  assertEquals(outcomeOfNotice("door_waiting", false), null);
  assertEquals(outcomeOfNotice("door_waiting", true), "door_timeout");
  assertEquals(outcomeOfNotice("door_denied", false), "door_denied");
  assertEquals(outcomeOfNotice("guest_access_waiting", true), null);
});

Deno.test("исходы: сбой записи не бросает, а пишется в лог", async () => {
  const logs: string[] = [];
  const row: OutcomeRecord = {
    group_id: "g",
    invited_by: 1,
    meeting_id: null,
    calendar_key: null,
    outcome: "captcha",
    source: "notice",
    outcome_key: "m",
    detail: null,
  };
  await recordOutcomes({ record: () => Promise.reject(new Error("boom")) }, [row], (l) => logs.push(l));
  assertEquals(logs.length, 1);
  assertEquals(logs[0].includes("boom"), true);
});
