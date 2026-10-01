// Общий извлекатель стран/типа/даты + логика тега "General" + сборка текста эмбеддинга.
// ЕДИНСТВЕННАЯ реализация extractEntryMeta (issue #582): её зовут swarm-api, swarm-bot
// (granola.ts), swarm-mcp (add_knowledge/upload_file), meeting-publish. Использует общее
// COUNTRY_PROMPT_RULE — чтобы правило анти-конфузии соседних рынков (ME≠RS≠HR≠SI)
// применялось везде одинаково — и оба слоя защиты от «галлюцинации года» (_shared/llm-date.ts).
//
// swarm-bot/lib/storage.ts buildEntryIndex — отдельный вызов (тезисы + ключевые слова + мета
// одним запросом), это не копия extractEntryMeta; дату нормализует тем же normalizeExtractedEventDate.

import { COUNTRY_PROMPT_RULE, ENTRY_TYPE_PROMPT_RULE, normalizeCountries } from "./countries.ts";
import { normalizeExtractedEventDate, todayIso } from "./llm-date.ts";

const OPENAI = "https://api.openai.com/v1";

export type EntryMeta = { countries: string[]; entry_type: "meeting" | "note"; entry_date: string | null };

// Тег "General" — сентинел «нет конкретного рынка / широкий охват», НЕ страна.
// digest_cron исключает General из персонального дайджеста, MCP-вывод его прячет.
// Правило (порог схлопывания 2+, решение владельца 2026-08-06): РОВНО 1 явный рынок →
// тег; 0 ИЛИ ≥2 → запись КРОСС-МАРКЕТ = РОВНО ["General"]. Схлопываем, НЕ «список + General»:
// иначе запись всплывает в выдаче/дайджесте КАЖДОЙ из перечисленных стран — это и был баг
// перетега. Двойной тег ([SI,RS]/[ES,HU]) редко реально про ДВА рынка → в General, правится
// при вычитке. Подробно: docs/superpowers/specs/2026-08-06-country-attribution-consolidated.md
export function specificCountries(countries: readonly string[]): string[] {
  return countries.filter((c) => c !== "General");
}

export function applyGeneralSentinel(countries: readonly string[]): string[] {
  const specific = specificCountries(countries);
  if (specific.length !== 1) return ["General"];
  return specific;
}

// Рынки, пришедшие ОТ КЛИЕНТА (чипы на экране вычитки / в карточке встречи) → теги записи.
// Делает ровно две вещи, которых порознь не хватало:
//   • нормализует свободный ввод в ISO (["Bulgaria"] → ["BG"]);
//   • сохраняет сентинел: если явного рынка не осталось — ["General"], а НЕ пустой массив.
// Второе — регрессия issue #166: PATCH встречи прогонял ["General"] через normalizeCountries,
// а тот знает только страны («General» ему не словарное значение) → в базу уезжал [] и запись
// выпадала из дайджеста совсем, хотя человек выбирал «Общее».
// Порог 2+ применяется и к РУЧНОМУ выбору (issue #167, порог переподтверждён владельцем
// 2026-08-28): чипы предзаполнены подсказкой, поэтому «выбрал человек» на практике часто
// значит «предложила система и человек согласился» — а два рынка в записи это кросс-маркет.
export function marketTagsFromInput(raw: readonly string[]): string[] {
  return applyGeneralSentinel(normalizeCountries([...raw]));
}

// Текст для эмбеддинга: база + «Страны: …» + опц. ключевые слова (как в saveEntry/granola).
export function buildEmbeddingInput(baseText: string, countries: readonly string[], keywords?: string): string {
  const specific = specificCountries(countries);
  return [
    baseText,
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
    keywords ? `Ключевые слова: ${keywords}` : "",
  ].filter(Boolean).join("\n").slice(0, 8000);
}

const emptyMeta = (): EntryMeta => ({ countries: [], entry_type: "note", entry_date: null });
const META_INPUT_CHARS = 4000;

// Системный промпт извлечения. Слой 1 против выдуманного года: модель знает сегодняшнюю дату.
export function buildEntryMetaPrompt(today: string): string {
  return `Сегодня ${today}.\n` +
    "Проанализируй текст и верни JSON (только JSON, без markdown):\n" +
    '{"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null"}\n' +
    COUNTRY_PROMPT_RULE + "\n" +
    ENTRY_TYPE_PROMPT_RULE + "\n" +
    "entry_date — дата события из текста, null если нет. Год считай от сегодняшней даты: назван только день и месяц — бери ближайший подходящий год, НИКОГДА не из головы.";
}

// Разбор ответа модели. Слой 2 против выдуманного года: дата вне окна −400…+7 дней
// чинится по году (normalizeExtractedEventDate), непригодная → null.
export function parseEntryMeta(raw: string, today: string): EntryMeta {
  const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
  const countries = Array.isArray(parsed.countries)
    ? (parsed.countries as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  return {
    countries: normalizeCountries(countries),
    entry_type: parsed.entry_type === "meeting" ? "meeting" : "note",
    entry_date: normalizeExtractedEventDate(typeof parsed.entry_date === "string" ? parsed.entry_date : null, today),
  };
}

// LLM-извлечение стран/типа/даты. Нормализует страны в ISO-коды, дату — по году.
// Фейл-безопасно: при любой ошибке — пустые страны/note/null (вызывающий решает про General).
export async function extractEntryMeta(
  content: string,
  openaiKey: string,
  today: string = todayIso(),
): Promise<EntryMeta> {
  try {
    const res = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildEntryMetaPrompt(today) },
          { role: "user", content: content.slice(0, META_INPUT_CHARS) },
        ],
        max_tokens: 200,
      }),
    });
    if (!res.ok) {
      console.error("extractEntryMeta: OpenAI ответил", res.status);
      return emptyMeta();
    }
    return parseEntryMeta((await res.json()).choices[0].message.content, today);
  } catch (e) {
    console.error("extractEntryMeta: извлечение не удалось", e);
    return emptyMeta();
  }
}

// Эмбеддинг text-embedding-3-small. null при ошибке (вызывающий сам решает).
export async function embed(text: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OPENAI}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    return (await res.json()).data[0].embedding;
  } catch {
    return null;
  }
}
