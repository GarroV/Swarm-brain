// Тесты словаря имён собственных.
// Запуск: deno test supabase/functions/_shared/glossary.test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MEETING_GLOSSARY,
  glossaryPromptBlock,
  glossaryWhisperHint,
} from "./glossary.ts";

Deno.test("glossaryPromptBlock — содержит canonical и все aliases каждой записи", () => {
  const block = glossaryPromptBlock();
  for (const e of MEETING_GLOSSARY) {
    assertStringIncludes(block, e.canonical);
    for (const a of e.aliases) assertStringIncludes(block, a);
  }
});

Deno.test("glossaryPromptBlock — содержит правило и пример Wolt≠Volt", () => {
  const block = glossaryPromptBlock();
  assertStringIncludes(block, "НЕ придумывай");
  assertStringIncludes(block, "Wolt, НЕ Volt");
});

Deno.test("glossaryWhisperHint — перечисляет все canonical", () => {
  const hint = glossaryWhisperHint();
  for (const e of MEETING_GLOSSARY) assertStringIncludes(hint, e.canonical);
});

Deno.test("MEETING_GLOSSARY — записи валидны (canonical непустой, aliases в нижнем регистре)", () => {
  assert(MEETING_GLOSSARY.length > 0);
  for (const e of MEETING_GLOSSARY) {
    assert(e.canonical.trim().length > 0, `пустой canonical: ${JSON.stringify(e)}`);
    for (const a of e.aliases) assertEquals(a, a.toLowerCase(), `alias не lowercase: ${a}`);
  }
});
