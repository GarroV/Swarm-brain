import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { meUiPrefs, parseMePatch, UI_SCHEMES } from "./me-fields.ts";

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

Deno.test("PATCH /me: ui_scheme принимает известную схему и null, чужое — отказ", () => {
  for (const id of UI_SCHEMES) assertEquals(parseMePatch({ ui_scheme: id }), { fields: { ui_scheme: id } });
  assertEquals(parseMePatch({ ui_scheme: null }), { fields: { ui_scheme: null } });
  for (const v of ["nope", "", "NUAR", 1, true, [], {}]) {
    assertEquals(
      parseMePatch({ ui_scheme: v }),
      { error: "Unknown ui_scheme" },
      `должно отклоняться: ${JSON.stringify(v)}`,
    );
  }
});

Deno.test("PATCH /me: ui_scheme не трогает соседние поля и не появляется без запроса", () => {
  assertEquals(parseMePatch({ ui_scheme: "nuar", ui_backdrop: "dots" }), {
    fields: { ui_scheme: "nuar", ui_backdrop: "dots" },
  });
  assertEquals(parseMePatch({ ui_backdrop: "dots" }), { fields: { ui_backdrop: "dots" } });
});

Deno.test("GET /me: схема и фон из профиля отдаются как есть, нет строки или NULL — null", () => {
  assertEquals(meUiPrefs({ ui_backdrop: "dots", ui_scheme: "nuar" }), { ui_backdrop: "dots", ui_scheme: "nuar" });
  assertEquals(meUiPrefs({ ui_backdrop: null }), { ui_backdrop: null, ui_scheme: null });
  assertEquals(meUiPrefs(null), { ui_backdrop: null, ui_scheme: null });
});
