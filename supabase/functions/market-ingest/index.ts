// Приём данных сборщиков «Анализа рынка» из GitHub Actions (workflow market-collect).
// Только POST и только с токеном MARKET_INGEST_TOKEN: ключ service role в Actions не кладём,
// у токена нет прав ни на что, кроме таблиц mkt_* через эту функцию. Решения админа (импорт
// снимка, «принять все») — по отдельному MARKET_ADMIN_TOKEN, которого в Actions нет: утечка
// токена сборщика из CI не даёт принимать решения за админа.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyIngest } from "./apply.ts";
import { validateSnapshot } from "../_shared/market/snapshot.ts";
import { acceptAllNewLocations, importSnapshot } from "../_shared/market/db.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const TOKEN = Deno.env.get("MARKET_INGEST_TOKEN") ?? "";
const ADMIN_TOKEN = Deno.env.get("MARKET_ADMIN_TOKEN") ?? "";
const ADMIN_SOURCES = new Set(["snapshot", "accept_new"]);

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
  adminToken = ADMIN_TOKEN,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const given = (req.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  const isCollector = sameSecret(given, token);
  const isAdmin = sameSecret(given, adminToken);
  if (!isCollector && !isAdmin) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (
    !body?.source || !/^[A-Za-z]{2}$/.test(body?.country ?? "") ||
    !body?.started_at
  ) {
    return new Response("Bad payload", { status: 400 });
  }
  // Каждый токен — только своя работа: сборщик не принимает решений, админ не льёт данные.
  if (ADMIN_SOURCES.has(body.source) ? !isAdmin : !isCollector) {
    return new Response("Forbidden", { status: 403 });
  }
  const admin = await adminAction(body);
  if (admin) return admin;
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

/** Решения админа без его входа: те же кнопки «Импорт снимка» и «Принять все» из «Источников и
 *  свежести», но по токену админа MARKET_ADMIN_TOKEN — чтобы страну можно было довести
 *  скриптом (scripts/market/admin.ts), а не руками в вебе. Права те же: только таблицы mkt_*. */
const COLLECTOR = 0; // decided_by для решений, принятых сборщиком, а не человеком

async function adminAction(
  body: { source: string; country: string; snapshot?: unknown },
): Promise<Response | null> {
  const cc = body.country.toUpperCase();
  if (body.source === "snapshot") {
    const v = validateSnapshot(body.snapshot);
    if (!v.ok) {
      return Response.json({ ok: false, error: "Invalid snapshot", details: v.errors }, {
        status: 400,
      });
    }
    return await guarded(() => importSnapshot(supabase, cc, v.snapshot));
  }
  if (body.source === "accept_new") {
    return await guarded(async () => ({
      accepted: await acceptAllNewLocations(supabase, cc, COLLECTOR),
    }));
  }
  return null;
}

async function guarded(f: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json({ ok: true, stats: await f() });
  } catch (e) {
    console.error("market-ingest admin", e);
    return Response.json({ ok: false, error: "apply failed" }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve((req) => handleIngest(req));
