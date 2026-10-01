import { assertEquals } from "jsr:@std/assert@1";
import {
  applyGeneralSentinel,
  buildEntryMetaPrompt,
  extractEntryMeta,
  marketTagsFromInput,
  parseEntryMeta,
  specificCountries,
} from "./meta-extract.ts";

// Порог схлопывания 2+ (решение владельца 2026-08-06): ровно 1 рынок → тег; 0 или ≥2 → General.
// См. docs/superpowers/specs/2026-08-06-country-attribution-consolidated.md

Deno.test("applyGeneralSentinel — ровно 1 рынок остаётся тегом", () => {
  assertEquals(applyGeneralSentinel(["RS"]), ["RS"]);
  assertEquals(applyGeneralSentinel(["BG"]), ["BG"]);
});

Deno.test("applyGeneralSentinel — 0 рынков → General", () => {
  assertEquals(applyGeneralSentinel([]), ["General"]);
  assertEquals(applyGeneralSentinel(["General"]), ["General"]);
});

Deno.test("applyGeneralSentinel — ДВА рынка схлопываются в General (новый порог)", () => {
  assertEquals(applyGeneralSentinel(["SI", "RS"]), ["General"]);
  assertEquals(applyGeneralSentinel(["ES", "HU"]), ["General"]);
  assertEquals(applyGeneralSentinel(["PL", "RO"]), ["General"]);
});

Deno.test("applyGeneralSentinel — 3+ рынка → General", () => {
  assertEquals(applyGeneralSentinel(["RS", "BG", "RO"]), ["General"]);
  assertEquals(applyGeneralSentinel(["HU", "RS", "MD", "General"]), ["General"]);
});

Deno.test("applyGeneralSentinel — литеральный General снимается из микса перед подсчётом", () => {
  // [RS, General] = 1 явный рынок → RS (General в миксе не должен «спасать» от схлопа и не должен оставаться)
  assertEquals(applyGeneralSentinel(["RS", "General"]), ["RS"]);
  // [SI, RS, General] = 2 явных → General
  assertEquals(applyGeneralSentinel(["SI", "RS", "General"]), ["General"]);
});

Deno.test("specificCountries — убирает литеральный General", () => {
  assertEquals(specificCountries(["RS", "General"]), ["RS"]);
  assertEquals(specificCountries(["General"]), []);
});

// marketTagsFromInput — рынки, пришедшие ОТ КЛИЕНТА (чипы на вычитке), в теги записи.
// Регрессия issue #166: PATCH прогонял ["General"] через normalizeCountries и получал [] —
// сентинел стирался, запись выпадала из дайджеста совсем.
// Регрессия issue #167: порог 2+ обязан применяться и к ручному выбору (решение владельца 2026-08-28).

Deno.test("marketTagsFromInput — сентинел General выживает нормализацию (issue #166)", () => {
  assertEquals(marketTagsFromInput(["General"]), ["General"]);
});

Deno.test("marketTagsFromInput — пустой выбор = «Общее», а не отсутствие тега", () => {
  assertEquals(marketTagsFromInput([]), ["General"]);
});

Deno.test("marketTagsFromInput — ровно один рынок остаётся тегом и нормализуется в ISO", () => {
  assertEquals(marketTagsFromInput(["RS"]), ["RS"]);
  assertEquals(marketTagsFromInput(["Bulgaria"]), ["BG"]);
  assertEquals(marketTagsFromInput(["Сербия"]), ["RS"]);
});

Deno.test("marketTagsFromInput — 2+ рынка схлопываются в General даже при ручном выборе (issue #167)", () => {
  assertEquals(marketTagsFromInput(["RS", "BG"]), ["General"]);
  assertEquals(marketTagsFromInput(["RS", "BG", "RO"]), ["General"]);
  assertEquals(marketTagsFromInput(["RS", "General"]), ["RS"]);
});

Deno.test("marketTagsFromInput — нераспознанный мусор не превращается в «нет тега»", () => {
  assertEquals(marketTagsFromInput(["Неведомая страна"]), ["General"]);
  assertEquals(marketTagsFromInput(["", "  "]), ["General"]);
});

// ── extractEntryMeta: защита от «галлюцинации года» (issue #582) ─────────────────────
// Единственная реализация — её зовут swarm-api, swarm-bot (granola), swarm-mcp, meeting-publish.
// Модель на день без года дописывает год из обучающих данных (на проде — 2023). Общий путь
// обязан чинить год: дата вне окна −400…+7 дней → тот же день и месяц в ближайшем годе.

const META_TODAY = "2026-08-23";

async function withStubbedOpenAI<T>(
  modelReply: unknown,
  run: (seen: { body: Record<string, unknown> | null }) => Promise<T>,
  status = 200,
): Promise<T> {
  const original = globalThis.fetch;
  const seen: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    seen.body = JSON.parse(String(init?.body ?? "null"));
    const payload = { choices: [{ message: { content: JSON.stringify(modelReply) } }] };
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  }) as typeof fetch;
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("extractEntryMeta — год-галлюцинация модели чинится до ближайшего подходящего", async () => {
  const meta = await withStubbedOpenAI(
    { countries: ["Serbia"], entry_type: "meeting", entry_date: "2023-05-14" },
    () => extractEntryMeta("встреча 14 мая", "test-key", META_TODAY),
  );
  assertEquals(meta, { countries: ["RS"], entry_type: "meeting", entry_date: "2026-05-14" });
});

Deno.test("extractEntryMeta — правдоподобная дата не трогается, мусор → null", async () => {
  const ok = await withStubbedOpenAI(
    { countries: [], entry_type: "note", entry_date: "2026-08-20" },
    () => extractEntryMeta("текст", "test-key", META_TODAY),
  );
  assertEquals(ok.entry_date, "2026-08-20");
  const junk = await withStubbedOpenAI(
    { countries: [], entry_type: "note", entry_date: "на прошлой неделе" },
    () => extractEntryMeta("текст", "test-key", META_TODAY),
  );
  assertEquals(junk.entry_date, null);
});

Deno.test("extractEntryMeta — промпт сообщает модели сегодняшнюю дату (слой 1)", async () => {
  await withStubbedOpenAI({ countries: [], entry_type: "note", entry_date: null }, async (seen) => {
    await extractEntryMeta("текст", "test-key", META_TODAY);
    const messages = seen.body?.messages as Array<{ role: string; content: string }>;
    assertEquals(messages[0].content.startsWith(`Сегодня ${META_TODAY}.`), true);
  });
  assertEquals(buildEntryMetaPrompt(META_TODAY).includes("НИКОГДА не из головы"), true);
});

Deno.test("extractEntryMeta — ошибка OpenAI → пустая мета, а не исключение", async () => {
  const meta = await withStubbedOpenAI({}, () => extractEntryMeta("текст", "test-key", META_TODAY), 500);
  assertEquals(meta, { countries: [], entry_type: "note", entry_date: null });
});

Deno.test("parseEntryMeta — снимает markdown-обёртку и отбрасывает не-строки в странах", () => {
  const raw = '```json\n{"countries":["Bulgaria",7,null],"entry_type":"x","entry_date":"2027-03-05"}\n```';
  assertEquals(parseEntryMeta(raw, META_TODAY), { countries: ["BG"], entry_type: "note", entry_date: "2026-03-05" });
});
