// Тесты резолвинга языка встречи (цепочка фолбэков) и решения о ре-транскрибации.
// Запуск: deno test supabase/functions/_shared/meeting-lang.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  langCode,
  type LangVotePart,
  partsNeedingRetranscribe,
  resolveMeetingLang,
} from "./meeting-lang.ts";

const sys = (lang: string | undefined, segmentCount: number, viaFallback = false): LangVotePart => ({
  track: "sys",
  done: true,
  lang,
  segmentCount,
  viaFallback,
});
const mic = (lang: string | undefined, segmentCount: number, viaFallback = false): LangVotePart => ({
  track: "mic",
  done: true,
  lang,
  segmentCount,
  viaFallback,
});

Deno.test("langCode — известные имена → ISO, мусор → undefined", () => {
  assertEquals(langCode("russian"), "ru");
  assertEquals(langCode("English"), "en");
  assertEquals(langCode("dutch"), "nl"); // расширенная таблица
  assertEquals(langCode("welsh"), "cy"); // раньше молча дропалось → undefined
  assertEquals(langCode("qwerty"), undefined);
  assertEquals(langCode(undefined), undefined);
});

Deno.test("resolveMeetingLang — офлайн RU: тихая sys + русский mic → russian", () => {
  // sys — галлюцинация тишины: 0 реальных сегментов (после фильтра), язык мог остаться "welsh".
  // mic — 785 реальных русских сегментов. Ожидаем russian (шаг 2 цепочки — большинство по всем).
  const parts: LangVotePart[] = [
    sys("welsh", 0),
    mic("russian", 400),
    mic("russian", 385),
  ];
  assertEquals(resolveMeetingLang(parts, "russian"), "russian");
});

Deno.test("resolveMeetingLang — sys только через d.text-фолбэк не якорит", () => {
  const parts: LangVotePart[] = [
    sys("english", 1, /*viaFallback*/ true),
    mic("russian", 100),
  ];
  assertEquals(resolveMeetingLang(parts, "russian"), "russian");
});

Deno.test("resolveMeetingLang — реальный английский sys якорит поверх шумного mic", () => {
  const parts: LangVotePart[] = [
    sys("english", 60),
    sys("english", 40),
    mic("russian", 10), // ложный детект короткого mic
  ];
  assertEquals(resolveMeetingLang(parts, "russian"), "english");
});

Deno.test("resolveMeetingLang — всё пусто/флипнуто → дефолт", () => {
  const parts: LangVotePart[] = [
    sys("welsh", 0),
    mic("english", 0),
  ];
  assertEquals(resolveMeetingLang(parts, "russian"), "russian");
  assertEquals(resolveMeetingLang([], "english"), "english");
});

Deno.test("resolveMeetingLang — минимум сегментов: одиночный сегмент не якорит sys", () => {
  // sys с единственным сегментом (ниже MIN_ANCHOR_SEGMENTS) не должен перекрывать реальный mic.
  const parts: LangVotePart[] = [
    sys("english", 1),
    mic("russian", 50),
  ];
  assertEquals(resolveMeetingLang(parts, "russian"), "russian");
});

Deno.test("partsNeedingRetranscribe — только реальные части с чужим языком", () => {
  const parts: LangVotePart[] = [
    sys("russian", 30), // совпадает
    mic("english", 20), // чужой → ре-транскрибация (idx 1)
    mic("russian", 40), // совпадает
    mic("english", 0), // пусто → нечего чинить
  ];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), [1]);
});

Deno.test("partsNeedingRetranscribe — незавершённые и безъязыкие пропускаются", () => {
  const parts: LangVotePart[] = [
    { track: "mic", done: false, lang: "english", segmentCount: 10 },
    { track: "mic", done: true, lang: undefined, segmentCount: 10 },
  ];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), []);
});

Deno.test("partsNeedingRetranscribe — совпадающий язык не трогаем", () => {
  const parts: LangVotePart[] = [mic("russian", 10), sys("russian", 10)];
  assertEquals(partsNeedingRetranscribe(parts, "russian"), []);
});
