// Тест композиции промпта тезисов со словарём.
// Запуск: deno test supabase/functions/_shared/tezisy-prompt.test.ts
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEZISY_CORE, TEZISY_PROMPT } from "./tezisy-prompt.ts";

Deno.test("TEZISY_PROMPT — включает ядро", () => {
  assertStringIncludes(TEZISY_PROMPT, "Сделай тезисы встречи");
});

Deno.test("TEZISY_PROMPT — включает блок словаря и пример Wolt", () => {
  assertStringIncludes(TEZISY_PROMPT, "СЛОВАРЬ ИМЁН СОБСТВЕННЫХ");
  assertStringIncludes(TEZISY_PROMPT, "Wolt");
  assertStringIncludes(TEZISY_PROMPT, "Wolt, НЕ Volt");
});

Deno.test("TEZISY_CORE — ядро без блока словаря (композиция не мутировала ядро)", () => {
  if (TEZISY_CORE.includes("СЛОВАРЬ ИМЁН СОБСТВЕННЫХ")) {
    throw new Error("TEZISY_CORE не должен содержать блок словаря — он только в TEZISY_PROMPT");
  }
});
