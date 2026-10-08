import { assertEquals } from "jsr:@std/assert";
import { canDeleteDraft, canHideDraft, hasSeveralOwners } from "./draftOwners.ts";

const draft = { recorders: [{ telegram_id: 1 }], co_owners: [2] };

const solo = { recorders: [{ telegram_id: 1 }] };

Deno.test("удалить — только свою встречу с одним владельцем; групповую не стереть у всех (#818)", () => {
  assertEquals(canDeleteDraft(solo, 1), true);
  assertEquals(canDeleteDraft(solo, 2), false);
  assertEquals(canDeleteDraft(draft, 1), false);
  assertEquals(canDeleteDraft(draft, 2), false);
  assertEquals(canDeleteDraft(solo, null), false);
});

Deno.test("групповую встречу скрывают у себя, одиночную — нет (#818)", () => {
  assertEquals(canHideDraft(draft), true);
  assertEquals(canHideDraft(solo), false);
});

Deno.test("несколько владельцев — только общая база; один — выбор остаётся", () => {
  assertEquals(hasSeveralOwners(draft), true);
  assertEquals(hasSeveralOwners({ recorders: [{ telegram_id: 1 }] }), false);
  assertEquals(hasSeveralOwners({ recorders: [{ telegram_id: 1 }], co_owners: [1] }), false);
});
