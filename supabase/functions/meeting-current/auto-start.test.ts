import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { autoStartOf, isAutoStartWrite, loadAutoStart, parseAutoStartBody, saveAutoStart } from "./auto-start.ts";

Deno.test("autoStartOf: по умолчанию включено; выключает только явное false", () => {
  assertEquals(autoStartOf({ recorder_auto_start: true }), true);
  assertEquals(autoStartOf({ recorder_auto_start: false }), false);
  assertEquals(autoStartOf(null), true);
  assertEquals(autoStartOf({}), true);
  assertEquals(autoStartOf({ recorder_auto_start: "false" }), true);
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

Deno.test("loadAutoStart: выключено в профиле — false", async () => {
  assertEquals(await loadAutoStart(fakeDb({ data: { recorder_auto_start: false }, error: null }), 1), false);
  assertEquals(await loadAutoStart(fakeDb({ data: null, error: null }), 1), true);
});

Deno.test("isAutoStartWrite: только POST на /auto-start", () => {
  assertEquals(isAutoStartWrite("POST", "/meeting-current/auto-start"), true);
  assertEquals(isAutoStartWrite("POST", "/functions/v1/meeting-current/auto-start/"), true);
  assertEquals(isAutoStartWrite("GET", "/meeting-current/auto-start"), false);
  assertEquals(isAutoStartWrite("POST", "/meeting-current"), false);
});

Deno.test("parseAutoStartBody: только boolean", () => {
  assertEquals(parseAutoStartBody({ auto_start: false }), { ok: true, value: false });
  assertEquals(parseAutoStartBody({ auto_start: true }), { ok: true, value: true });
  for (const bad of [null, undefined, {}, { auto_start: "false" }, { auto_start: 0 }, { auto_start: null }, "x"]) {
    assertEquals(parseAutoStartBody(bad).ok, false, JSON.stringify(bad));
  }
});

Deno.test("saveAutoStart: upsert по telegram_id (строки профиля может не быть); ошибка — текст и лог", async () => {
  let seen: unknown[] = [];
  const db = (error: unknown) => ({
    from: () => ({
      upsert: (...a: unknown[]) => {
        seen = a;
        return Promise.resolve({ error });
      },
    }),
  });
  assertEquals(await saveAutoStart(db(null), 7, true), null);
  assertEquals(seen, [{ telegram_id: 7, recorder_auto_start: true }, { onConflict: "telegram_id" }]);
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await saveAutoStart(db({ message: "boom" }), 7, true), "Could not save auto_start");
  } finally {
    console.error = orig;
  }
});
