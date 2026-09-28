import { assertEquals } from "jsr:@std/assert";
import { canDeleteDraft, hasSeveralOwners } from "./draftOwners.ts";

const draft = { recorders: [{ telegram_id: 1 }], co_owners: [2] };

Deno.test("совладелец не видит кнопку удаления, записавший — видит", () => {
  assertEquals(canDeleteDraft(draft, 1), true);
  assertEquals(canDeleteDraft(draft, 2), false);
  assertEquals(canDeleteDraft(draft, null), false);
});

Deno.test("несколько владельцев — только общая база; один — выбор остаётся", () => {
  assertEquals(hasSeveralOwners(draft), true);
  assertEquals(hasSeveralOwners({ recorders: [{ telegram_id: 1 }] }), false);
  assertEquals(hasSeveralOwners({ recorders: [{ telegram_id: 1 }], co_owners: [1] }), false);
});
