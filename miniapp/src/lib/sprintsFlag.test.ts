// Флаг «Ленты» спринтов: включён только владельцу (по telegram_id) и по ?sprints=lenta; ?sprints=old выключает.
// Раннер: deno test -A --no-check src/lib/ (bare specifier из deno.json).
import { assertEquals } from "@std/assert";
import { isSprintTimelineEnabled, SPRINTS_OWNER_ID } from "./sprintsFlag.ts";

const owner = { telegram_id: SPRINTS_OWNER_ID };
const other = { telegram_id: 1 };

Deno.test("sprints timeline: включена владельцу и только ему", () => {
  assertEquals(isSprintTimelineEnabled(owner), true);
  assertEquals(isSprintTimelineEnabled(other), false);
  assertEquals(isSprintTimelineEnabled(null), false);
  assertEquals(isSprintTimelineEnabled(undefined), false);
});

Deno.test("sprints timeline: демо-аккаунт с id владельца флага не получает", () => {
  assertEquals(isSprintTimelineEnabled({ ...owner, is_demo: true }), false);
});

Deno.test("sprints timeline: ?sprints=lenta включает любому, ?sprints=old выключает владельцу", () => {
  assertEquals(isSprintTimelineEnabled(other, "?sprints=lenta"), true);
  assertEquals(isSprintTimelineEnabled(null, "?sprints=lenta"), true);
  assertEquals(isSprintTimelineEnabled(owner, "?sprints=old"), false);
  assertEquals(isSprintTimelineEnabled(other, "?x=1&sprints=lenta"), true);
  assertEquals(isSprintTimelineEnabled(other, "?sprints=other"), false);
});
