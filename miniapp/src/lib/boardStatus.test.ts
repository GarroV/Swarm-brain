import { assertEquals } from "jsr:@std/assert";
import { isBacklogStatus, isOnBoard, isWorkStatus } from "./boardStatus.ts";

Deno.test("cancelled не бэклог и не на доске (#1272)", () => {
  assertEquals(isBacklogStatus("cancelled"), false);
  assertEquals(isWorkStatus("cancelled"), false);
  assertEquals(isOnBoard("cancelled"), false);
});

Deno.test("backlog — бэклог; open/in_progress/done — рабочие", () => {
  assertEquals(isBacklogStatus("backlog"), true);
  for (const s of ["open", "in_progress", "done"]) {
    assertEquals(isWorkStatus(s), true);
    assertEquals(isBacklogStatus(s), false);
  }
});
