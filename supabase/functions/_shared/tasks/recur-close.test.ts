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

Deno.test("часы базы впереди до 5 с — повтор не пропускает следующий цикл (#1013)", () => {
  for (const age of [-1, -16, -4_999, -5_000, 0, RECUR_DUPLICATE_WINDOW_MS]) {
    assertEquals(
      duplicateRecurClose({ lastClose: close("2026-10-02", age), currentDue: "2026-10-02", nowMs: NOW }),
      { from: "2026-10-01", to: "2026-10-02" },
      `возраст закрытия ${age} мс`,
    );
  }
});

Deno.test("за пределами допуска часов и окна повтора — новый запрос (#1013)", () => {
  for (const age of [-5_001, -60_000, RECUR_DUPLICATE_WINDOW_MS + 1]) {
    assertEquals(
      duplicateRecurClose({ lastClose: close("2026-10-02", age), currentDue: "2026-10-02", nowMs: NOW }),
      null,
      `возраст закрытия ${age} мс`,
    );
  }
  assertEquals(
    duplicateRecurClose({
      lastClose: { note: recurCloseNote("2026-10-01", "2026-10-02"), created_at: "invalid" },
      currentDue: "2026-10-02",
      nowMs: NOW,
    }),
    null,
  );
});
