import { assertEquals } from "jsr:@std/assert@1";
import { resolveDigestScope } from "./digest-scope.ts";

Deno.test("рынки заданы — дайджест строится по ним", () => {
  assertEquals(resolveDigestScope(["RS", "BG"], false), "markets");
});

Deno.test("рынки НЕ заданы — просим настроить, а не показываем весь воркспейс (issue #154)", () => {
  // Регрессия, ради которой модуль и существует: раньше пустой markets означал «показать всё».
  assertEquals(resolveDigestScope([], false), "needs-markets");
});

Deno.test("админский «весь воркспейс» работает и без рынков", () => {
  assertEquals(resolveDigestScope([], true), "workspace");
  assertEquals(resolveDigestScope(["RS"], true), "workspace");
});
