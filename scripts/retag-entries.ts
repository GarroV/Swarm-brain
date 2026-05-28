/**
 * One-time script: retag entries that have NULL entry_type/entry_date/countries.
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *   deno run --allow-net --allow-env scripts/retag-entries.ts
 *
 * Dry-run (no writes):
 *   DRY_RUN=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *   deno run --allow-net --allow-env scripts/retag-entries.ts
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const DRY_RUN = Deno.env.get("DRY_RUN") === "1";
const BATCH_SIZE = 20;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
  Deno.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Prefer": "return=representation",
};

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

async function extractMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
  try {
    const raw = await chatComplete(
      'Проанализируй текст и верни JSON: {"countries":["Serbia"],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null"}. ' +
      "countries — страны на английском (Serbia, Bulgaria, Montenegro...). " +
      "entry_type — transcript (расшифровка звонка), meeting (заметки встречи), summary (саммари), document (файл/отчёт), note (заметка). " +
      "entry_date — дата события из текста, null если нет.",
      text.slice(0, 3000)
    );
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries : [],
      entry_type: parsed.entry_type ?? "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch (e) {
    console.error("  extractMeta error:", e);
    return { countries: [], entry_type: "note", entry_date: null };
  }
}

async function fetchBatch(offset: number): Promise<Array<{ id: string; content: string; source: string }>> {
  const url = `${SUPABASE_URL}/rest/v1/entries?select=id,content,source&entry_type=is.null&order=created_at.asc&limit=${BATCH_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fetch failed: ${err}`);
  }
  return res.json() as Promise<Array<{ id: string; content: string; source: string }>>;
}

async function updateEntry(id: string, patch: { countries: string[]; entry_type: string; entry_date: string | null }): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/entries?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Update failed for ${id}: ${err}`);
  }
}

async function main() {
  console.log(`Starting retag${DRY_RUN ? " (DRY RUN)" : ""}...`);
  let offset = 0;
  let total = 0;

  while (true) {
    const batch = await fetchBatch(offset);
    if (!batch.length) break;

    for (const entry of batch) {
      const meta = await extractMeta(entry.content);
      console.log(`  [${entry.id.slice(0, 8)}] source=${entry.source} → type=${meta.entry_type} date=${meta.entry_date ?? "null"} countries=[${meta.countries.join(", ")}]`);
      if (!DRY_RUN) {
        await updateEntry(entry.id, meta);
      }
      total++;
      // Small delay to avoid hammering OpenAI
      await new Promise(r => setTimeout(r, 150));
    }

    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log(`Done. Processed ${total} entries.`);
}

main().catch(e => { console.error(e); Deno.exit(1); });
