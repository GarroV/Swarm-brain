import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { autoStartOf, loadAutoStart } from "./auto-start.ts";

Deno.test("autoStartOf: только настоящее true включает; нет строки и мусор — false", () => {
  assertEquals(autoStartOf({ recorder_auto_start: true }), true);
  assertEquals(autoStartOf({ recorder_auto_start: false }), false);
  assertEquals(autoStartOf(null), false);
  assertEquals(autoStartOf({}), false);
  assertEquals(autoStartOf({ recorder_auto_start: "true" }), false);
});

function fakeDb(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }),
  };
}

Deno.test("loadAutoStart: ошибка чтения — false и лог, без исключения", async () => {
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a);
  };
  try {
    assertEquals(await loadAutoStart(fakeDb({ data: null, error: { message: "boom" } }), 1), false);
  } finally {
    console.error = orig;
  }
  assertEquals(errors.length, 1);
});

Deno.test("loadAutoStart: включено в профиле — true", async () => {
  assertEquals(await loadAutoStart(fakeDb({ data: { recorder_auto_start: true }, error: null }), 1), true);
});
