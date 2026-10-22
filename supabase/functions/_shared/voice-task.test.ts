import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeVoiceTask, tomorrowOf, VOICE_TITLE_MAX } from "./voice-task.ts";

const TODAY = "2026-10-22";
const MARKETS = ["RS", "SI", "BG"];
const opts = { today: TODAY, allowedMarkets: MARKETS, transcript: "по Словении подключить агрегаторов" };

Deno.test("срок не назван → завтра", () => {
  assertEquals(normalizeVoiceTask({ title: "Подключить агрегаторов" }, opts)?.due_date, "2026-10-23");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: null }, opts)?.due_date, "2026-10-23");
});

Deno.test("срок — не дата → завтра", () => {
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "завтра" }, opts)?.due_date, "2026-10-23");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "2026-02-30" }, opts)?.due_date, "2026-10-23");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "null" }, opts)?.due_date, "2026-10-23");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: 20261105 }, opts)?.due_date, "2026-10-23");
});

Deno.test("срок раньше сегодняшнего → завтра", () => {
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "2026-10-21" }, opts)?.due_date, "2026-10-23");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "2025-01-01" }, opts)?.due_date, "2026-10-23");
});

Deno.test("срок сегодня и позже остаётся как назван", () => {
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "2026-10-22" }, opts)?.due_date, "2026-10-22");
  assertEquals(normalizeVoiceTask({ title: "x", due_date: "2026-11-05" }, opts)?.due_date, "2026-11-05");
});

Deno.test("завтра переходит через границу месяца и года", () => {
  assertEquals(tomorrowOf("2026-10-31"), "2026-11-01");
  assertEquals(tomorrowOf("2026-12-31"), "2027-01-01");
  assertEquals(normalizeVoiceTask({ title: "x" }, { ...opts, today: "2026-12-31" })?.due_date, "2027-01-01");
});

Deno.test("страна из разрешённых рынков принимается (код и название)", () => {
  assertEquals(normalizeVoiceTask({ title: "x", country: "SI" }, opts)?.country, "SI");
  assertEquals(normalizeVoiceTask({ title: "x", country: "si" }, opts)?.country, "SI");
  assertEquals(normalizeVoiceTask({ title: "x", country: "Словения" }, opts)?.country, "SI");
});

Deno.test("страна вне рынков пространства → null", () => {
  assertEquals(normalizeVoiceTask({ title: "x", country: "ES" }, opts)?.country, null);
  assertEquals(normalizeVoiceTask({ title: "x", country: "Spain" }, opts)?.country, null);
});

Deno.test("страна — мусор или пустота → null", () => {
  assertEquals(normalizeVoiceTask({ title: "x", country: "Атлантида" }, opts)?.country, null);
  assertEquals(normalizeVoiceTask({ title: "x", country: "null" }, opts)?.country, null);
  assertEquals(normalizeVoiceTask({ title: "x", country: null }, opts)?.country, null);
  assertEquals(normalizeVoiceTask({ title: "x", country: 5 }, opts)?.country, null);
});

Deno.test("пустой список рынков — страны нет", () => {
  assertEquals(normalizeVoiceTask({ title: "x", country: "SI" }, { ...opts, allowedMarkets: [] })?.country, null);
});

Deno.test("пустой заголовок → расшифровка целиком", () => {
  assertEquals(normalizeVoiceTask({ title: "  " }, opts)?.title, "по Словении подключить агрегаторов");
  assertEquals(normalizeVoiceTask({}, opts)?.title, "по Словении подключить агрегаторов");
  assertEquals(normalizeVoiceTask({ title: "null" }, opts)?.title, "по Словении подключить агрегаторов");
});

Deno.test("длинная расшифровка в заголовке обрезается", () => {
  const long = "слово ".repeat(100);
  const t = normalizeVoiceTask({}, { ...opts, transcript: long })?.title ?? "";
  assertEquals(t.length <= VOICE_TITLE_MAX, true);
  assertEquals(t.length > 0, true);
});

Deno.test("нет ни заголовка, ни расшифровки → null", () => {
  assertEquals(normalizeVoiceTask({}, { ...opts, transcript: "   " }), null);
  assertEquals(normalizeVoiceTask(null, { ...opts, transcript: "" }), null);
});

Deno.test("мусор вместо объекта модели не роняет разбор", () => {
  assertEquals(normalizeVoiceTask("строка", opts)?.title, "по Словении подключить агрегаторов");
  assertEquals(normalizeVoiceTask([1], opts)?.due_date, "2026-10-23");
});

Deno.test("описание: строка-пустота → null, обычный текст сохраняется", () => {
  assertEquals(normalizeVoiceTask({ title: "x", description: "none" }, opts)?.description, null);
  assertEquals(normalizeVoiceTask({ title: "x", description: " контекст " }, opts)?.description, "контекст");
});

import { parseVoiceReply } from "./voice-task-llm.ts";

Deno.test("конверт chat/completions: объект разбирается, мусор — null", () => {
  const ok = { choices: [{ message: { content: '{"title":"a","description":null,"country":"SI","due_date":null}' } }] };
  assertEquals(parseVoiceReply(ok)?.title, "a");
  assertEquals(parseVoiceReply({ choices: [{ message: { content: "не json" } }] }), null);
  assertEquals(parseVoiceReply({ choices: [{ message: { content: "[1]" } }] }), null);
  assertEquals(parseVoiceReply(null), null);
});
