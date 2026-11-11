import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseMePatch } from "./me-fields.ts";

Deno.test("PATCH /me: пустой набор — полей нет", () => {
  assertEquals(parseMePatch({}), { fields: {} });
});

Deno.test("PATCH /me: recorder_auto_start принимает boolean, в том числе false (#219)", () => {
  assertEquals(parseMePatch({ recorder_auto_start: true }), { fields: { recorder_auto_start: true } });
  assertEquals(parseMePatch({ recorder_auto_start: false }), { fields: { recorder_auto_start: false } });
});

Deno.test("PATCH /me: recorder_auto_start не boolean — отказ (строка, число, null не включают запись молча)", () => {
  for (const v of ["false", "true", 0, 1, null, [], {}]) {
    assertEquals(
      parseMePatch({ recorder_auto_start: v }),
      { error: "recorder_auto_start must be boolean" },
      `должно отклоняться: ${JSON.stringify(v)}`,
    );
  }
});

Deno.test("PATCH /me: прежние поля не изменились — role, markets, ui_backdrop", () => {
  assertEquals(parseMePatch({ role: "bd", ui_backdrop: "dots" }), { fields: { role: "bd", ui_backdrop: "dots" } });
  assertEquals(parseMePatch({ ui_backdrop: null }), { fields: { ui_backdrop: null } });
  assertEquals(parseMePatch({ ui_backdrop: "nope" }), { error: "Unknown ui_backdrop" });
  assertEquals(parseMePatch({ markets: "KZ" }), { fields: {} });
});
