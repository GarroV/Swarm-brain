// Тесты резолвинга языка встречи (язык-нейтральный, взвешенный по РЕАЛЬНОЙ речи) и решения о
// ре-транскрибации. Запуск: deno test supabase/functions/_shared/meeting-lang.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  langCode,
  type LangVotePart,
  partsNeedingRetranscribe,
  resolveMeetingLang,
} from "./meeting-lang.ts";

// charCount — сумма длин текста реальных сегментов (после фильтра галлюцинаций).
const part = (
  lang: string | undefined,
  charCount: number,
  opts: { viaFallback?: boolean; done?: boolean } = {},
): LangVotePart => ({
  done: opts.done ?? true,
  lang,
  charCount,
  viaFallback: opts.viaFallback ?? false,
});

Deno.test("langCode — известные имена → ISO, мусор → undefined", () => {
  assertEquals(langCode("russian"), "ru");
  assertEquals(langCode("English"), "en");
  assertEquals(langCode("dutch"), "nl"); // расширенная таблица
  assertEquals(langCode("welsh"), "cy");
  assertEquals(langCode("qwerty"), undefined);
  assertEquals(langCode(undefined), undefined);
});

Deno.test("resolveMeetingLang — RU остаётся RU: русская речь + один флипнутый low-char english", () => {
  // Тихий чанк мис-детектнулся как english, но несёт мало реальных символов → не может
  // перебить чанки, где реально говорили по-русски. Побеждает язык с бОльшим объёмом речи.
  const parts: LangVotePart[] = [
    part("russian", 4200),
    part("russian", 3800),
    part("english", 30), // флипнутая тишина, крохи
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("resolveMeetingLang — EN остаётся EN: английская речь + мелкий русский чанк (НЕ форсим ru)", () => {
  const parts: LangVotePart[] = [
    part("english", 5000),
    part("english", 4200),
    part("russian", 40), // мелкий флипнутый чанк
  ];
  const r = resolveMeetingLang(parts);
  assertEquals(r, "english");
  assert(r !== "russian"); // КЛЮЧЕВОЕ: никакого форс-ru байаса
});

Deno.test("resolveMeetingLang — взвешивание по речи: пачка крохотных english не перебивает один большой russian", () => {
  const parts: LangVotePart[] = [
    part("russian", 6000),
    part("english", 25),
    part("english", 22),
    part("english", 28),
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("resolveMeetingLang — нет реальной речи → undefined (НЕ ru, без пина)", () => {
  // Все части — галлюцинация тишины (0 реальных символов после фильтра) либо без языка.
  const parts: LangVotePart[] = [
    part("welsh", 0),
    part("english", 0),
    part(undefined, 0),
  ];
  assertEquals(resolveMeetingLang(parts), undefined);
  assertEquals(resolveMeetingLang([]), undefined);
});

Deno.test("resolveMeetingLang — смешанная 60/40 → язык большинства речи", () => {
  const parts: LangVotePart[] = [
    part("russian", 600),
    part("english", 400),
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("resolveMeetingLang — онлайн RU-звонок с реальным собеседником резолвится RU", () => {
  // Речь есть на обеих дорожках (трек больше не важен для голоса) — побеждает russian по объёму.
  const parts: LangVotePart[] = [
    part("russian", 3000), // собеседник (sys)
    part("russian", 2500), // владелец (mic)
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("resolveMeetingLang — реальный английский собеседник резолвится EN поверх шумного мелкого mic", () => {
  const parts: LangVotePart[] = [
    part("english", 3000),
    part("english", 2000),
    part("russian", 40), // ложный детект короткого mic
  ];
  assertEquals(resolveMeetingLang(parts), "english");
});

Deno.test("resolveMeetingLang — d.text-фолбэк не голосует (ненадёжная речь)", () => {
  const parts: LangVotePart[] = [
    part("english", 500, { viaFallback: true }), // фолбэк d.text — исключён из голоса
    part("russian", 100),
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("resolveMeetingLang — near-empty часть ниже порога не голосует", () => {
  const parts: LangVotePart[] = [
    part("english", 5), // ниже MIN_REAL_CHARS
    part("russian", 100),
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
  // одинокая под-пороговая часть → нечего пинить
  assertEquals(resolveMeetingLang([part("english", 5)]), undefined);
});

Deno.test("resolveMeetingLang — незавершённая часть не голосует", () => {
  const parts: LangVotePart[] = [
    part("english", 5000, { done: false }),
    part("russian", 100),
  ];
  assertEquals(resolveMeetingLang(parts), "russian");
});

Deno.test("partsNeedingRetranscribe — только реальные части с чужим языком", () => {
  const parts: LangVotePart[] = [
    part("russian", 300), // совпадает
    part("english", 200), // чужой → ре-транскрибация (idx 1)
    part("russian", 400), // совпадает
    part("english", 0), // пусто → нечего чинить
  ];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), [1]);
});

Deno.test("partsNeedingRetranscribe — незавершённые и безъязыкие пропускаются", () => {
  const parts: LangVotePart[] = [
    { done: false, lang: "english", charCount: 100 },
    { done: true, lang: undefined, charCount: 100 },
  ];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), []);
});

Deno.test("partsNeedingRetranscribe — совпадающий язык не трогаем", () => {
  const parts: LangVotePart[] = [part("russian", 100), part("russian", 100)];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), []);
});
