// deno test --allow-read miniapp/src/lib/transcriptText.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { transcriptToText, type TranscriptSegment } from "./transcriptText.ts";
import { speakerLabelAt } from "./transcriptSpeaker.ts";

const fmtTime = (s: number) => `00:00:${String(s).padStart(2, "0")}`;
const render = (segs: TranscriptSegment[]) =>
  transcriptToText(segs, { speakerAt: (i) => speakerLabelAt(segs, i, { meName: null, lang: "ru" }), fmtTime });

Deno.test("подпись говорящего только при смене, блоки разделены пустой строкой", () => {
  const text = render(
    [
      { start: 1, text: "привет", speaker: "я" },
      { start: 5, text: "как дела", speaker: "я" },
      { start: 9, text: "хорошо", speaker: "собеседник" },
    ],
  );
  assertEquals(text, "Я\n00:00:01  привет\n00:00:05  как дела\n\nСобеседник\n00:00:09  хорошо");
});

Deno.test("без говорящих — только строки со временем", () => {
  assertEquals(render([{ start: 3, text: "раз" }, { start: 4, text: "два" }]), "00:00:03  раз\n00:00:04  два");
});

Deno.test("пустой транскрипт — пустая строка", () => {
  assertEquals(render([]), "");
});
