// GET /quality?kind=rs|rko — баллы РС и РКО по пиццериям для главной (решение владельца 08.10.2026,
// docs/decisions/2026-10-07-home-dashboard-direction.md). Видит весь воркспейс («рейтинги видны
// всем»), страны режутся по allowed_markets воркспейса (null — все). Демо настоящих баллов не
// видит: у него своя витрина, а не выгрузки сети. Загрузка — только MCP quality_import.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { loadQuality } from "../_shared/quality/store.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function workspaceCountries(groupId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  if (error) throw new Error(`allowed_markets: ${error.message}`);
  const markets = (data?.allowed_markets as string[] | null) ?? null;
  return markets ? markets.map((m) => m.trim().toUpperCase()) : null;
}

export async function handleQualityRoutes(
  req: Request,
  routePath: string,
  groupId: string,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  if (routePath !== "/quality" || req.method !== "GET") return null;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "rs" && kind !== "rko") return apiErr(400, "kind must be rs or rko", origin);
  try {
    const countries = isDemo ? [] : await workspaceCountries(groupId);
    return json(await loadQuality(supabase, kind, countries), 200, origin);
  } catch (e) {
    return serverError(origin, "quality", e);
  }
}
