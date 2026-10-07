import { assertEquals } from "jsr:@std/assert";
import { speakerLabelAt, speakerName } from "./transcriptSpeaker.ts";

const ru = { meName: "Vasiliy Garro", lang: "ru" as const };

Deno.test("«я» — имя записавшего, «собеседник» — по-человечески, имена бота — как есть (#819)", () => {
  assertEquals(speakerName("я", ru), "Vasiliy Garro");
  assertEquals(speakerName("я", { meName: null, lang: "en" }), "Me");
  assertEquals(speakerName("собеседник", { meName: null, lang: "en" }), "Other side");
  assertEquals(speakerName("Ksenia Zabardaeva", ru), "Ksenia Zabardaeva");
  assertEquals(speakerName("  ", ru), null);
});

Deno.test("подпись только при смене говорящего", () => {
  const segs = [{ speaker: "я" }, { speaker: "я" }, { speaker: "собеседник" }, {}, { speaker: "я" }];
  assertEquals(segs.map((_, i) => speakerLabelAt(segs, i, ru)), [
    "Vasiliy Garro", null, "Собеседник", null, "Vasiliy Garro",
  ]);
});
