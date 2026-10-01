// Дедуп публикации и видимость (#579): личная публикация не прикрепляется к командной записи
// и не переписывает её, командная — к личной.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchesPublishVisibility } from "./meeting-dedup.ts";

const team = { is_private: false, owner_id: 111, shared_with: null };
const mine = { is_private: true, owner_id: 111, shared_with: null };
const sharedWithMe = { is_private: true, owner_id: 222, shared_with: [111] };
const others = { is_private: true, owner_id: 222, shared_with: null };

Deno.test("matchesPublishVisibility: командная публикация — только командные записи", () => {
  assertEquals(matchesPublishVisibility(team, false, 111), true);
  assertEquals(matchesPublishVisibility(mine, false, 111), false);
  assertEquals(matchesPublishVisibility(sharedWithMe, false, 111), false);
});

Deno.test("matchesPublishVisibility: личная публикация — только свои личные (владелец или соавтор)", () => {
  assertEquals(matchesPublishVisibility(team, true, 111), false);
  assertEquals(matchesPublishVisibility(mine, true, 111), true);
  assertEquals(matchesPublishVisibility(sharedWithMe, true, 111), true);
  assertEquals(matchesPublishVisibility(others, true, 111), false);
  assertEquals(matchesPublishVisibility(mine, true, null), false);
});

Deno.test("matchesPublishVisibility: без видимости публикации (вебхук) — фильтр не вмешивается", () => {
  assertEquals(matchesPublishVisibility(team, undefined, undefined), true);
  assertEquals(matchesPublishVisibility(mine, undefined, 111), true);
});
