import { assertEquals } from "@std/assert";
import { duplicateRecurClose, parseRecurCloseNote, RECUR_DUPLICATE_WINDOW_MS, recurCloseNote } from "./recur-close.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const close = (to: string, agoMs: number) => ({
  note: recurCloseNote("2026-10-01", to),
  created_at: new Date(NOW - agoMs).toISOString(),
});

Deno.test("строка журнала читается обратно", () => {
  assertEquals(
    parseRecurCloseNote(recurCloseNote("2026-10-01", "2026-10-02")),
    { from: "2026-10-01", to: "2026-10-02" },
  );
  assertEquals(parseRecurCloseNote("что-то другое"), null);
  assertEquals(parseRecurCloseNote(null), null);
});

Deno.test("повтор того же закрытия в окне — повтор", () => {
  assertEquals(
    duplicateRecurClose({
      lastClose: close("2026-10-02", 5_000),
      currentDue: "2026-10-02",
      nowMs: NOW,
    }),
    { from: "2026-10-01", to: "2026-10-02" },
  );
});

Deno.test("за пределами окна — новый цикл, перекатывать", () => {
  assertEquals(
    duplicateRecurClose({
      lastClose: close("2026-10-02", RECUR_DUPLICATE_WINDOW_MS + 1),
      currentDue: "2026-10-02",
      nowMs: NOW,
    }),
    null,
  );
});

Deno.test("срок поменяли руками после переката — не повтор", () => {
  assertEquals(
    duplicateRecurClose({
      lastClose: close("2026-10-02", 1_000),
      currentDue: "2026-10-07",
      nowMs: NOW,
    }),
    null,
  );
});

Deno.test("закрытий не было — не повтор", () => {
  assertEquals(
    duplicateRecurClose({ lastClose: null, currentDue: "2026-10-02", nowMs: NOW }),
    null,
  );
});
