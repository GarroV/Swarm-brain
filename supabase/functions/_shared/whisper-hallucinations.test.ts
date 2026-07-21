// Тесты фильтра галлюцинаций Whisper.
// Запуск: deno test supabase/functions/_shared/whisper-hallucinations.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isRepeatedFiller,
  isWhisperHallucination,
  WHISPER_HALLUCINATION_RE,
} from "./whisper-hallucinations.ts";

Deno.test("regex — валлийское «аутро» и мультиязычные варианты ловятся", () => {
  assert(WHISPER_HALLUCINATION_RE.test("Diolch yn fawr am wylio'r fideo!"), "welsh");
  assert(WHISPER_HALLUCINATION_RE.test("Gracias por ver el video"), "spanish");
  assert(WHISPER_HALLUCINATION_RE.test("Obrigado por assistir"), "portuguese");
  assert(WHISPER_HALLUCINATION_RE.test("Merci d'avoir regardé cette vidéo"), "french");
  assert(WHISPER_HALLUCINATION_RE.test("ご視聴ありがとうございました"), "japanese");
  assert(WHISPER_HALLUCINATION_RE.test("感谢观看"), "chinese");
});

Deno.test("regex — реальная речь НЕ матчится", () => {
  assertEquals(WHISPER_HALLUCINATION_RE.test("Давайте обсудим план на следующую неделю"), false);
  assertEquals(WHISPER_HALLUCINATION_RE.test("Let's review the deployment checklist"), false);
});

Deno.test("isRepeatedFiller — валлийский повтор по всей части ловится", () => {
  const welsh = Array(8).fill("Diolch yn fawr am wylio'r fideo!");
  assert(isRepeatedFiller(welsh));
});

Deno.test("isRepeatedFiller — «thank you for watching» повтор ловится", () => {
  const en = Array(6).fill("Thank you for watching");
  assert(isRepeatedFiller(en));
});

Deno.test("isRepeatedFiller — доминирующий повтор среди небольшого шума ловится", () => {
  const texts = [
    "谢谢观看", "谢谢观看", "谢谢观看", "谢谢观看", "谢谢观看", "谢谢观看", "谢谢观看", ".",
  ];
  assert(isRepeatedFiller(texts));
});

Deno.test("isRepeatedFiller — короткий живой обмен «Да.»«Да.» НЕ дропается", () => {
  // Реальный разговор: короткое «да» встречается, но не доминирует и повторов мало.
  const real = ["Да.", "Согласен.", "Да.", "Проверим на стейдже.", "Ок, договорились."];
  assertEquals(isRepeatedFiller(real), false);
});

Deno.test("isRepeatedFiller — 4 подряд «Да.» ниже порога (живая скороговорка) НЕ дропается", () => {
  assertEquals(isRepeatedFiller(["Да.", "Да.", "Да.", "Да."]), false);
});

Deno.test("isRepeatedFiller — длинная фраза, повторённая по делу, НЕ дропается", () => {
  const longLine =
    "Нам нужно закрыть задачу по миграции базы данных до конца квартала, иначе поедут все остальные сроки в проекте и мы не успеем к релизу вовремя.";
  assert(longLine.length > 120, "тестовая фраза должна быть длиннее REPEAT_MAX_LEN");
  assertEquals(isRepeatedFiller(Array(6).fill(longLine)), false);
});

Deno.test("isRepeatedFiller — мало сегментов → не срабатывает", () => {
  assertEquals(isRepeatedFiller([]), false);
  assertEquals(isRepeatedFiller(["Спасибо за просмотр", "Спасибо за просмотр"]), false);
});

Deno.test("isWhisperHallucination — валлийский аутро теперь ловится чёрным списком", () => {
  assert(isWhisperHallucination("Diolch yn fawr am wylio'r fideo!"));
});
