// Тесты фильтра галлюцинаций Whisper.
// Запуск: deno test supabase/functions/_shared/whisper-hallucinations.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dropConsecutiveRuns,
  hasExcessiveInternalRepeat,
  isRepeatedFiller,
  isSingleTokenSpam,
  isWhisperHallucination,
  WHISPER_HALLUCINATION_RE,
} from "./whisper-hallucinations.ts";

const id = (s: string) => s;

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

// ── «Добро пожаловать на наш канал» (ютуб-интро) + внутрисегментный повтор ──────
Deno.test("regex — «Добро пожаловать на наш канал» ловится (инцидент 99d4e644)", () => {
  assert(WHISPER_HALLUCINATION_RE.test("Добро пожаловать на наш канал!"), "ru intro");
  assert(WHISPER_HALLUCINATION_RE.test("Добро пожаловать на наш канал, с вами я, Сергей Трофимов."), "ru intro + имя");
  assert(WHISPER_HALLUCINATION_RE.test("Welcome to our channel"), "en intro");
});

Deno.test("hasExcessiveInternalRepeat — одна фраза ×69 в одном сегменте = галлюцинация", () => {
  const wall = Array(69).fill("Добро пожаловать на наш канал!").join(" ");
  assert(hasExcessiveInternalRepeat(wall));
  assert(isWhisperHallucination(wall), "и через isWhisperHallucination тоже");
});

Deno.test("hasExcessiveInternalRepeat — короткий повтор ×4 доминирующий ловится", () => {
  assert(hasExcessiveInternalRepeat("Ага. Ага. Ага. Ага."));
});

Deno.test("hasExcessiveInternalRepeat — живая речь из разных фраз НЕ ловится", () => {
  assertEquals(hasExcessiveInternalRepeat("Давайте обсудим план. Согласен. Проверим на стейдже завтра."), false);
});

Deno.test("hasExcessiveInternalRepeat — 3 повтора ниже порога НЕ ловятся", () => {
  assertEquals(hasExcessiveInternalRepeat("Да. Да. Да."), false);
});

Deno.test("hasExcessiveInternalRepeat — длинная фраза, повторённая, НЕ ловится (>REPEAT_MAX_LEN)", () => {
  // Без завершающей пунктуации (её срезает split) фраза остаётся длиннее REPEAT_MAX_LEN=120.
  const longLine =
    "Нам нужно закрыть задачу по миграции базы данных до конца квартала иначе поедут все остальные сроки в проекте и мы точно не успеем к запланированному релизу";
  assert(longLine.length > 120);
  assertEquals(hasExcessiveInternalRepeat(Array(5).fill(longLine).join(". ")), false);
});

// ── dropConsecutiveRuns (петля одинаковых токенов) ──────────────────────────────

Deno.test("dropConsecutiveRuns — петля «sviđanje»×77 вырезается целиком (инцидент 564c2f73)", () => {
  const segs = Array(77).fill("sviđanje");
  assertEquals(dropConsecutiveRuns(segs, id).length, 0);
});

Deno.test("dropConsecutiveRuns — петля «ne»×9 вырезается", () => {
  assertEquals(dropConsecutiveRuns(Array(9).fill("ne"), id).length, 0);
});

Deno.test("dropConsecutiveRuns — реальная речь вокруг петли сохраняется, петля вырезана", () => {
  const segs = [
    "Давайте начнём созвон.",
    ...Array(30).fill("sviđanje"),
    "Хорошо, тогда до завтра.",
  ];
  const out = dropConsecutiveRuns(segs, id);
  assertEquals(out, ["Давайте начнём созвон.", "Хорошо, тогда до завтра."]);
});

Deno.test("dropConsecutiveRuns — живой обмен «Да.»×4 НЕ трогаем (ниже RUN_MIN=6)", () => {
  const segs = ["Да.", "Да.", "Да.", "Да."];
  assertEquals(dropConsecutiveRuns(segs, id), segs);
});

Deno.test("dropConsecutiveRuns — длинная фраза, повторённая ≥6 раз, НЕ вырезается (>REPEAT_MAX_LEN)", () => {
  const longLine =
    "Нам нужно закрыть задачу по миграции базы данных до конца квартала, иначе поедут все остальные сроки в проекте и мы не успеем к релизу вовремя.";
  assert(longLine.length > 120);
  assertEquals(dropConsecutiveRuns(Array(6).fill(longLine), id).length, 6);
});

Deno.test("dropConsecutiveRuns — работает над объектами-сегментами через аксессор", () => {
  const segs = [
    { start: 0, end: 1, text: "ок" },
    ...Array(6).fill(0).map((_, i) => ({ start: i, end: i + 1, text: "sviđanje" })),
    { start: 9, end: 10, text: "поехали" },
  ];
  const out = dropConsecutiveRuns(segs, (s) => s.text);
  assertEquals(out.map((s) => s.text), ["ок", "поехали"]);
});

// ── isSingleTokenSpam (сплошной спам одиночных токенов) ─────────────────────────

Deno.test("isSingleTokenSpam — двух-токенная смесь, обойдённая доминированием, ловится", () => {
  // Точный слепок инцидента 564c2f73: 100 mic-сегментов = 77 «sviđanje» + 13 «ne» + 10 обрывков.
  // «sviđanje» = 77/100 = 0.77 < REPEAT_DOMINANCE(0.8) → isRepeatedFiller слеп; ловит isSingleTokenSpam.
  const scattered = ["moš", "jel", "je", "pa", "nije", "nezadovoljstvu", "ni", "je", "ne", "pa"];
  const texts = [...Array(77).fill("sviđanje"), ...Array(13).fill("ne"), ...scattered];
  assertEquals(texts.length, 100);
  assertEquals(isRepeatedFiller(texts), false, "isRepeatedFiller тут слеп (0.77 < 0.8)");
  assert(isSingleTokenSpam(texts), "isSingleTokenSpam должен поймать сплошной односложный спам");
});

Deno.test("isSingleTokenSpam — часть с реальной многословной репликой НЕ дропается", () => {
  const texts = [...Array(20).fill("ok"), "давайте перейдём к следующему пункту повестки"];
  assertEquals(isSingleTokenSpam(texts), false);
});

Deno.test("isSingleTokenSpam — живой короткий обмен НЕ дропается (есть ≥3-словные реплики)", () => {
  const real = ["Да.", "Согласен полностью с этим.", "Ок.", "Проверим на стейдже завтра утром.", "Договорились."];
  assertEquals(isSingleTokenSpam(real), false);
});

Deno.test("isSingleTokenSpam — мало сегментов → не срабатывает", () => {
  assertEquals(isSingleTokenSpam(["ne", "ne", "ne"]), false);
});
