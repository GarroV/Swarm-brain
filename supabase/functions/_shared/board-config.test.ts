import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_BOARD_CONFIG, parseBoardConfig } from "./board-config.ts";

Deno.test("строки в app_settings нет — дефолты (10 строк)", () => {
  assertEquals(parseBoardConfig(null), DEFAULT_BOARD_CONFIG);
  assertEquals(parseBoardConfig(undefined).task_rows, 10);
});

Deno.test("свои значения ложатся поверх дефолтов, остальное — дефолт", () => {
  const c = parseBoardConfig({ task_rows: 14, panel_width: 900 });
  assertEquals(c.task_rows, 14);
  assertEquals(c.panel_width, 900);
  assertEquals(c.refresh_seconds, 60);
});

Deno.test("неверные значения и чужие ключи игнорируются", () => {
  const c = parseBoardConfig({
    task_rows: "20",
    panel_width: -5,
    meetings_width: 99999,
    notes_height: 12.5,
    refresh_seconds: null,
    evil: 1,
  });
  assertEquals(c, DEFAULT_BOARD_CONFIG);
  assertEquals("evil" in c, false);
});

Deno.test("границы включены, за границей — дефолт", () => {
  assertEquals(parseBoardConfig({ task_rows: 1 }).task_rows, 1);
  assertEquals(parseBoardConfig({ task_rows: 50 }).task_rows, 50);
  assertEquals(parseBoardConfig({ task_rows: 0 }).task_rows, 10);
  assertEquals(parseBoardConfig({ task_rows: 51 }).task_rows, 10);
});

Deno.test("не объект — дефолты", () => {
  assertEquals(parseBoardConfig([1, 2]), DEFAULT_BOARD_CONFIG);
  assertEquals(parseBoardConfig("x"), DEFAULT_BOARD_CONFIG);
});
