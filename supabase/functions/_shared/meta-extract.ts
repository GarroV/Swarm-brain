// Общий извлекатель стран/типа/даты + логика тега "General" + сборка текста эмбеддинга.
// Единый источник для путей ингеста, у которых нет доступа к swarm-bot/lib (swarm-api,
// read-ai-webhook, ретег-скрипт). Использует общее COUNTRY_PROMPT_RULE — чтобы правило
// анти-конфузии соседних рынков (ME≠RS≠HR≠SI) применялось везде одинаково.
//
// swarm-bot/lib/storage.ts исторически держит свою копию той же логики (buildEntryIndex/
// saveEntry) поверх собственных openai.ts-обёрток — не трогаем, чтобы не задеть множество
// бот-флоу; но новые/починенные пути зовут ЭТОТ модуль.

import { normalizeCountries, COUNTRY_PROMPT_RULE, ENTRY_TYPE_PROMPT_RULE } from "./countries.ts";

const OPENAI = "https://api.openai.com/v1";

export type EntryMeta = { countries: string[]; entry_type: "meeting" | "note"; entry_date: string | null };

// Тег "General" — сентинел «нет конкретного рынка / широкий охват», НЕ страна.
// digest_cron исключает General из персонального дайджеста, MCP-вывод его прячет.
// Правило (единое с saveEntry/granola): specific==0 ИЛИ specific>=3 → дописать General.
export function specificCountries(countries: readonly string[]): string[] {
  return countries.filter((c) => c !== "General");
}

export function applyGeneralSentinel(countries: readonly string[]): string[] {
  const out = [...countries];
  const specific = specificCountries(out);
  if (specific.length === 0 || specific.length >= 3) {
    if (!out.includes("General")) out.push("General");
  }
  return out;
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

// LLM-извлечение стран/типа/даты через общее COUNTRY_PROMPT_RULE. Нормализует в ISO-коды.
// Фейл-безопасно: при любой ошибке — пустые страны/note/null (вызывающий решает про General).
export async function extractEntryMeta(content: string, openaiKey: string): Promise<EntryMeta> {
  try {
    const res = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Проанализируй текст и верни JSON (только JSON, без markdown): {"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":null}\n' +
              COUNTRY_PROMPT_RULE + "\n" + ENTRY_TYPE_PROMPT_RULE + "\nentry_date — дата события из текста, null если нет.",
          },
          { role: "user", content: content.slice(0, 4000) },
        ],
        max_tokens: 200,
      }),
    });
    if (!res.ok) return { countries: [], entry_type: "note", entry_date: null };
    const parsed = JSON.parse((await res.json()).choices[0].message.content);
    return {
      countries: normalizeCountries(Array.isArray(parsed.countries) ? parsed.countries : []),
      entry_type: parsed.entry_type === "meeting" ? "meeting" : "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch {
    return { countries: [], entry_type: "note", entry_date: null };
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
