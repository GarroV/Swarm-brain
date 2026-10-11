// GET /quality/maps — рейтинги Google/Яндекс по странам и пиццериям (Децимус /api/v1/maps/ratings,
// блок 2 «Карты»): тот же прокси, кэш и границы по странам, что у /quality.
// GET /quality?kind=rs|rko — баллы РС и РКО по пиццериям для главной. Источник — Децимус
// (решение владельца 08.10.2026: Swarm данных о проверках не хранит и не загружает, а читает
// API Децимуса, GarroV/decimus#567). Здесь — прокси с коротким кэшем: видит весь воркспейс
// («рейтинги видны всем»), страны режутся по allowed_markets воркспейса (null — все) и в
// запросе к Децимусу, и в ответе. Демо настоящих баллов не видит.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { type Kind, type QualityView, toView } from "./quality-view.ts";
import { type MapsView, toMapsView } from "./maps-view.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const MAPS_COMPARE_DAYS = 30;

const cache = new Map<string, { at: number; view: QualityView }>();
const mapsCache = new Map<string, { at: number; view: MapsView }>();

async function workspaceCountries(groupId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  if (error) throw new Error(`allowed_markets: ${error.message}`);
  const markets = (data?.allowed_markets as string[] | null) ?? null;
  return markets ? markets.map((m) => m.trim().toUpperCase()) : null;
}

async function fetchDecimus(kind: Kind, countries: string[] | null): Promise<QualityView> {
  const base = Deno.env.get("DECIMUS_API_URL");
  const token = Deno.env.get("DECIMUS_API_TOKEN");
  if (!base || !token) throw new NotConfigured();
  const url = new URL("/api/v1/ratings/scores", base);
  url.searchParams.set("type", kind);
  if (countries) url.searchParams.set("countries", countries.join(","));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`decimus ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return toView(kind, await res.json(), countries);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Срез на сегодня (UTC) против «30 дней назад»; дата входит в ключ кэша, чтобы после полуночи не отдавать вчерашнее. */
async function fetchMaps(countries: string[] | null, on: string, compare: string): Promise<MapsView> {
  const base = Deno.env.get("DECIMUS_API_URL");
  const token = Deno.env.get("DECIMUS_API_TOKEN");
  if (!base || !token) throw new NotConfigured();
  const url = new URL("/api/v1/maps/ratings", base);
  if (countries) url.searchParams.set("countries", countries.join(","));
  url.searchParams.set("on", on);
  url.searchParams.set("compare", compare);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`decimus ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return toMapsView(await res.json(), countries);
}

class NotConfigured extends Error {
  constructor() {
    super("DECIMUS_API_URL / DECIMUS_API_TOKEN не заданы");
  }
}

export async function handleQualityRoutes(
  req: Request,
  routePath: string,
  groupId: string,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  if (routePath === "/quality/maps") return await handleMaps(groupId, isDemo, origin);
  if (routePath !== "/quality") return null;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "rs" && kind !== "rko") return apiErr(400, "kind must be rs or rko", origin);
  if (isDemo) return json({ kind, periods: [], units: [] }, 200, origin);
  try {
    const countries = await workspaceCountries(groupId);
    if (countries && !countries.length) return json({ kind, periods: [], units: [] }, 200, origin);
    const key = `${kind}|${countries?.join(",") ?? "*"}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.view, 200, origin);
    const view = await fetchDecimus(kind, countries);
    cache.set(key, { at: Date.now(), view });
    return json(view, 200, origin);
  } catch (e) {
    if (e instanceof NotConfigured) {
      console.error("[quality]", e.message);
      return apiErr(503, "ratings source is not configured", origin);
    }
    return serverError(origin, "quality", e);
  }
}

const emptyMaps = (on: string, compare: string): MapsView => ({
  on,
  compare,
  countries: [],
  units: [],
  loaded_at: null,
});

async function handleMaps(groupId: string, isDemo: boolean, origin: string): Promise<Response> {
  const now = new Date();
  const on = isoDay(now);
  const compare = isoDay(new Date(now.getTime() - MAPS_COMPARE_DAYS * 86_400_000));
  if (isDemo) return json(emptyMaps(on, compare), 200, origin);
  try {
    const countries = await workspaceCountries(groupId);
    if (countries && !countries.length) return json(emptyMaps(on, compare), 200, origin);
    const key = `${on}|${countries?.join(",") ?? "*"}`;
    const hit = mapsCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.view, 200, origin);
    const view = await fetchMaps(countries, on, compare);
    mapsCache.set(key, { at: Date.now(), view });
    return json(view, 200, origin);
  } catch (e) {
    if (e instanceof NotConfigured) {
      console.error("[quality/maps]", e.message);
      return apiErr(503, "ratings source is not configured", origin);
    }
    return serverError(origin, "quality/maps", e);
  }
}
