const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

export async function getEmbedding(text: string): Promise<number[]> {
  return withRetry(async () => {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "OpenAI embeddings error");
    return data.data[0].embedding;
  });
}

// opts.temperature — для классификаторов ставим 0 (детерминизм: иначе gpt-4o-mini на
// дефолтной 1.0 галлюцинирует, напр. подставляет знакомую страну незнакомому городу).
// opts.json — response_format json_object (промпт обязан содержать слово JSON). НЕ включать
// для summary/тезисов (там markdown, не JSON).
export async function chatComplete(
  system: string,
  user: string,
  opts: { temperature?: number; json?: boolean } = {},
): Promise<string> {
  return withRetry(async () => {
    const body: Record<string, unknown> = {
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 2000,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.json) body.response_format = { type: "json_object" };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
    return data.choices[0].message.content;
  });
}
