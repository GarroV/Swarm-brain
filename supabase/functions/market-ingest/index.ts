// Приём данных сборщиков «Анализа рынка» из GitHub Actions (workflow market-collect).
// Только POST и только с токеном MARKET_INGEST_TOKEN: ключ service role в Actions не кладём,
// у токена нет прав ни на что, кроме таблиц mkt_* через эту функцию.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyIngest } from "./apply.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const TOKEN = Deno.env.get("MARKET_INGEST_TOKEN") ?? "";

/** Сравнение без утечки по времени; пустой ожидаемый токен не пускает никого. */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given),
    b = new TextEncoder().encode(expected);
  if (!expected || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function handleIngest(
  req: Request,
  token = TOKEN,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const given = (req.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  if (!sameSecret(given, token)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (
    !body?.source || !/^[A-Za-z]{2}$/.test(body?.country ?? "") ||
    !body?.started_at
  ) {
    return new Response("Bad payload", { status: 400 });
  }
  try {
    const stats = await applyIngest(
      supabase,
      body,
      new Date().toISOString().slice(0, 10),
    );
    return Response.json({ ok: true, stats });
  } catch (e) {
    console.error("market-ingest", e);
    return Response.json({ ok: false, error: "apply failed" }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve((req) => handleIngest(req));
