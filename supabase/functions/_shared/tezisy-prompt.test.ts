// Тест композиции промпта тезисов со словарём.
// Запуск: deno test supabase/functions/_shared/tezisy-prompt.test.ts
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HEADINGS_BY_TOPIC_RULE,
  NO_FLIPPED_CLAIMS_RULE,
  NO_INVENTED_LINKS_RULE,
  NO_SUBSTITUTED_NAMES_RULE,
  TEZISY_CORE,
  TEZISY_PROMPT,
} from "./tezisy-prompt.ts";

Deno.test("TEZISY_PROMPT — включает ядро", () => {
  assertStringIncludes(TEZISY_PROMPT, "Ты помощник команды");
});

Deno.test("TEZISY_PROMPT — включает блок словаря и пример Wolt", () => {
  assertStringIncludes(TEZISY_PROMPT, "СЛОВАРЬ ИМЁН СОБСТВЕННЫХ");
  assertStringIncludes(TEZISY_PROMPT, "Wolt");
  assertStringIncludes(TEZISY_PROMPT, "Wolt, НЕ Volt");
});

// Регресс issue #22: ложная связка «двойные цены Болгарии ↔ Интак/НТАК» из соседних реплик.
Deno.test("TEZISY_PROMPT — содержит запрет домысленных связей и правило про отсутствующий ответ", () => {
  assertStringIncludes(TEZISY_PROMPT, NO_INVENTED_LINKS_RULE);
  assertStringIncludes(TEZISY_PROMPT, "НЕ ВЫДУМЫВАЙ СВЯЗИ МЕЖДУ ТЕМАМИ");
  assertStringIncludes(TEZISY_PROMPT, "РАЗНЫЕ НАЗВАНИЯ — РАЗНЫЕ СУЩНОСТИ");
  assertStringIncludes(TEZISY_PROMPT, "ответа НЕТ");
});

Deno.test("TEZISY_CORE — ядро без блока словаря (композиция не мутировала ядро)", () => {
  if (TEZISY_CORE.includes("СЛОВАРЬ ИМЁН СОБСТВЕННЫХ")) {
    throw new Error("TEZISY_CORE не должен содержать блок словаря — он только в TEZISY_PROMPT");
  }
});

// ── Регресс issue #72 (разбор встреч 19.08.2026) ──────────────────────────────

// В записи «заходили на ИСА-2» (Нови Сад), в тезисах — «Београд 2»: нерасслышанное
// название подменено знакомым шаблоном из словаря, место события стало неверным.
Deno.test("TEZISY_PROMPT — запрещает подменять незнакомое название знакомым", () => {
  assertStringIncludes(TEZISY_PROMPT, NO_SUBSTITUTED_NAMES_RULE);
  assertStringIncludes(TEZISY_PROMPT, "ИСА-2");
  assertStringIncludes(TEZISY_PROMPT, "КАК В СТЕНОГРАММЕ");
});

// Разделы «### Карабач» и термин «Чепляски» — слова, которые Whisper расслышал криво,
// поднятые до заголовка/термина. Заголовок обязан быть темой поиска, а не словом встречи.
Deno.test("TEZISY_PROMPT — заголовок раздела по теме, а не по имени собственному", () => {
  assertStringIncludes(TEZISY_PROMPT, HEADINGS_BY_TOPIC_RULE);
  assertStringIncludes(TEZISY_PROMPT, "ЗАГОЛОВОК РАЗДЕЛА — ТЕМА");
});

// «на чеке будет печататься, но в отчёты не уйдёт» → в тезисах ровно наоборот.
Deno.test("TEZISY_PROMPT — запрещает переворачивать направление утверждения", () => {
  assertStringIncludes(TEZISY_PROMPT, NO_FLIPPED_CLAIMS_RULE);
  assertStringIncludes(TEZISY_PROMPT, "НЕ ПЕРЕВОРАЧИВАЙ");
});
