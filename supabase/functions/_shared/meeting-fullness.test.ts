// Тесты арбитража версий встречи по полноте (issue #176).
// Запуск: deno test supabase/functions/_shared/meeting-fullness.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { arbitrateFullness, transcriptVolume } from "./meeting-fullness.ts";

const tr = (...texts: string[]) => ({ segments: texts.map((text) => ({ text })) });

Deno.test("transcriptVolume — суммарная длина распознанного текста", () => {
  assertEquals(transcriptVolume(tr("привет", "как дела")), 6 + 8);
  assertEquals(transcriptVolume({ segments: [] }), 0);
  assertEquals(transcriptVolume(null), 0);
  assertEquals(transcriptVolume({ segments: [{ text: null }, { text: "  " }] }), 0);
});

Deno.test("вдвое более полная версия заменяет опубликованную (живой случай 26.08)", () => {
  // Реальные величины: 469 сегментов / 3325 симв. в базе против 1097 / 7068 у второго рекордера.
  const published = { transcript: tr("а".repeat(3325)) };
  const incoming = { transcript: tr("б".repeat(7068)) };
  assertEquals(arbitrateFullness(incoming, published), { replace: true, reason: "incoming_richer" });
});

Deno.test("близкие по полноте версии не гоняют перезапись (порог ×1.5)", () => {
  const published = { transcript: tr("а".repeat(1000)) };
  assertEquals(arbitrateFullness({ transcript: tr("б".repeat(1400)) }, published).replace, false);
  assertEquals(arbitrateFullness({ transcript: tr("б".repeat(1500)) }, published).replace, true);
});

Deno.test("версия беднее опубликованной не заменяет её — «кто первый» тут ни при чём", () => {
  const published = { transcript: tr("а".repeat(7068)) };
  const r = arbitrateFullness({ transcript: tr("б".repeat(3325)) }, published);
  assertEquals(r, { replace: false, reason: "not_richer" });
});

Deno.test("транскрипт есть только у входящей → она полнее по определению (Granola в базе)", () => {
  // В базе версия Granola: тезисы есть, транскрипта нет вовсе. Приходит запись рекордера.
  const r = arbitrateFullness({ transcript: tr("речь".repeat(50)) }, { transcript: null });
  assertEquals(r, { replace: true, reason: "incoming_has_transcript" });
});

Deno.test("обратный случай: у входящей транскрипта нет — не заменяем", () => {
  const r = arbitrateFullness({ transcript: null }, { transcript: tr("речь".repeat(50)) });
  assertEquals(r, { replace: false, reason: "not_richer" });
});

Deno.test("правленное человеком не перезаписывается — ни в базе, ни у входящей", () => {
  const rich = { transcript: tr("б".repeat(9000)) };
  // Опубликованную правил человек: его текст важнее автоматической полноты.
  assertEquals(
    arbitrateFullness(rich, { transcript: tr("а".repeat(1000)), notesEditedAt: "2026-08-27T10:00:00+00:00" }),
    { replace: false, reason: "published_edited" },
  );
  // Входящую правил человек: решает он (ему показывается, что он правит общую запись).
  assertEquals(
    arbitrateFullness({ ...rich, notesEditedAt: "2026-08-28T10:00:00+00:00" }, { transcript: tr("а".repeat(1000)) }),
    { replace: false, reason: "incoming_edited" },
  );
});

Deno.test("обе версии без транскрипта — замены нет (сравнивать нечем)", () => {
  assertEquals(arbitrateFullness({ transcript: null }, { transcript: null }).replace, false);
});
