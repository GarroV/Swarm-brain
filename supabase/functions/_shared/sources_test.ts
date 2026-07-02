import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sourceLabel, ALL_MEETING_SOURCES, ENTRY_MEETING_SOURCES } from "./sources.ts";

Deno.test("sourceLabel: известные источники + fallback", () => {
  assertEquals(sourceLabel("desktop-agent"), "Рекордер");
  assertEquals(sourceLabel("granola"), "Granola");
  assertEquals(sourceLabel("read_ai"), "Read.ai");
  assertEquals(sourceLabel("otter"), "Встреча");
});

Deno.test("ALL_MEETING_SOURCES — все три источника", () => {
  assertEquals(new Set(ALL_MEETING_SOURCES), new Set(["desktop-agent", "granola", "read_ai"]));
});

Deno.test("ENTRY_MEETING_SOURCES — только внешние (пишут в entries), без рекордера", () => {
  assertEquals(new Set(ENTRY_MEETING_SOURCES), new Set(["granola", "read_ai"]));
});
