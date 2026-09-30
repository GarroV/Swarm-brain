import { assert, assertEquals } from "jsr:@std/assert@1";
import { isIsoDate, pingPatch } from "./ping.ts";

Deno.test("pingPatch: дата ставит пинг и взводит его заново (issue #622)", () => {
  const r = pingPatch("2026-12-01", 42);
  assertEquals(r, { ok: true, fields: { remind_date: "2026-12-01", reminded_at: null, remind_set_by: 42 } });
});

Deno.test("pingPatch: null снимает пинг и чистит след отправки", () => {
  assertEquals(pingPatch(null, 42), {
    ok: true,
    fields: { remind_date: null, reminded_at: null, remind_set_by: null },
  });
});

Deno.test("pingPatch: не-дата — отказ, а не молча записанный мусор", () => {
  for (const bad of ["01.12.2026", "2026-02-30", "", "завтра", 20261201, undefined]) {
    const r = pingPatch(bad, 42);
    assert(!r.ok, `должен отказать: ${String(bad)}`);
  }
});

Deno.test("isIsoDate: високосный день есть, несуществующий — нет", () => {
  assert(isIsoDate("2028-02-29"));
  assert(!isIsoDate("2027-02-29"));
});
