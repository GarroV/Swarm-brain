// «Анализ рынка»: чтение данных страны и админ-действия (импорт снимка ручных источников,
// очередь кандидатов от сборщиков). Решение 02.10.2026, спека 2026-10-02-market-analysis-design.
// Данные — рынок страны, не воркспейса: видимость режет canSeeCountry по allowed_markets,
// демо видит только выдуманную XD.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, corsHeaders, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { canSeeCountry } from "../_shared/market/rules.ts";
import {
  acceptAllNewLocations,
  decideCandidate,
  importSnapshot,
  listCandidates,
  listCountriesWithData,
  loadCountry,
} from "../_shared/market/db.ts";
import { validateSnapshot } from "../_shared/market/snapshot.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const COUNTRY_ROUTE = /^\/market\/([A-Za-z]{2})(\/import|\/candidates|\/candidates\/accept-all)?$/;
const DECIDE_ROUTE = /^\/market\/candidates\/([0-9a-f-]{36})\/(accept|reject)$/;

async function allowedMarkets(groupId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  if (error) throw new Error(`allowed_markets: ${error.message}`);
  return (data?.allowed_markets as string[] | null) ?? null;
}

async function decide(id: string, accept: boolean, telegramId: number, isAdmin: boolean, origin: string) {
  if (!isAdmin) return apiErr(403, "Forbidden", origin);
  const r = await decideCandidate(supabase, id, accept, telegramId);
  if (r === "not_found") return apiErr(404, "Not found", origin);
  if (r === "already") return apiErr(409, "Already decided", origin);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function importRoute(req: Request, cc: string, isAdmin: boolean, origin: string) {
  if (!isAdmin) return apiErr(403, "Forbidden", origin);
  const v = validateSnapshot(await req.json().catch(() => null));
  if (!v.ok) return json({ error: "Invalid snapshot", details: v.errors }, 400, origin);
  return json(await importSnapshot(supabase, cc, v.snapshot), 200, origin);
}

export async function handleMarketRoutes(
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  if (routePath !== "/market/countries" && !COUNTRY_ROUTE.test(routePath) && !DECIDE_ROUTE.test(routePath)) {
    return null;
  }
  try {
    const decision = routePath.match(DECIDE_ROUTE);
    if (decision && req.method === "POST") {
      return await decide(decision[1], decision[2] === "accept", telegramId, isAdmin, origin);
    }

    const allowed = await allowedMarkets(groupId);
    const visible = (cc: string) => canSeeCountry(cc, allowed, isDemo);
    if (routePath === "/market/countries" && req.method === "GET") {
      return json((await listCountriesWithData(supabase)).filter(visible), 200, origin);
    }

    const m = routePath.match(COUNTRY_ROUTE);
    if (!m) return null;
    const cc = m[1].toUpperCase();
    if (!visible(cc)) return apiErr(403, "Forbidden", origin);
    if (!m[2] && req.method === "GET") return json(await loadCountry(supabase, cc), 200, origin);
    if (m[2] === "/candidates" && req.method === "GET") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      return json(await listCandidates(supabase, cc), 200, origin);
    }
    if (m[2] === "/import" && req.method === "POST") return await importRoute(req, cc, isAdmin, origin);
    if (m[2] === "/candidates/accept-all" && req.method === "POST") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      return json({ accepted: await acceptAllNewLocations(supabase, cc, telegramId) }, 200, origin);
    }
    return null;
  } catch (e) {
    return serverError(origin, "market", e);
  }
}
