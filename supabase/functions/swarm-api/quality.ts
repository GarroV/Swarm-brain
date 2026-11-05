// GET /quality/aggregators — оценки агрегаторов доставки по странам (Децимус /api/v1/aggregators/ratings,
// два среза: сегодня и 30 дней назад; изменение считает aggregators-view.ts): тот же прокси, кэш и границы.
// GET /quality/maps — рейтинги Google/Яндекс по странам и пиццериям (Децимус /api/v1/maps/ratings,
// блок 2 «Карты»): тот же прокси, кэш и границы по странам, что у /quality.
// GET /quality?kind=rs|rko — баллы РС и РКО по пиццериям для главной. Источник — Децимус
// (решение владельца 08.10.2026: Swarm данных о проверках не хранит и не загружает, а читает
// API Децимуса, GarroV/decimus#567). Здесь — прокси с коротким кэшем: видит весь воркспейс
// («рейтинги видны всем»), страны — все, без разреза по allowed_markets (решение 05.11.2026:
// рейтинги общие). Демо настоящих баллов не видит.
import { decimusGet, DecimusNotConfigured } from "../_shared/decimus.ts";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { type Kind, type QualityView, toView } from "./quality-view.ts";
import { type MapsView, toMapsView } from "./maps-view.ts";
import { type AggregatorsView, toAggregatorsView } from "./aggregators-view.ts";

const CACHE_MS = 5 * 60 * 1000;

const MAPS_COMPARE_DAYS = 30;

const cache = new Map<string, { at: number; view: QualityView }>();
const mapsCache = new Map<string, { at: number; view: MapsView }>();
const aggregatorsCache = new Map<string, { at: number; view: AggregatorsView }>();

async function fetchDecimus(kind: Kind): Promise<QualityView> {
  const body = await decimusGet("/api/v1/ratings/scores", { type: kind });
  return toView(kind, body, null);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Срез на сегодня (UTC) против «30 дней назад»; дата входит в ключ кэша, чтобы после полуночи не отдавать вчерашнее. */
async function fetchMaps(on: string, compare: string): Promise<MapsView> {
  const body = await decimusGet("/api/v1/maps/ratings", { on, compare });
  return toMapsView(body, null);
}

/** Два среза параллельно: сегодня и «30 дней назад». Не пришёл только срез сравнения — оценки отдаём
 * без изменений (в лог), не пришёл сегодняшний — ошибка. */
async function fetchAggregators(on: string, compare: string): Promise<AggregatorsView> {
  const params = (day: string) => ({ on: day });
  const [now, prev] = await Promise.allSettled([
    decimusGet("/api/v1/aggregators/ratings", params(on)),
    decimusGet("/api/v1/aggregators/ratings", params(compare)),
  ]);
  if (now.status === "rejected") throw now.reason;
  if (prev.status === "rejected") console.warn("[quality/aggregators] compare slice failed", prev.reason);
  return toAggregatorsView(now.value, prev.status === "fulfilled" ? prev.value : null, null);
}

export async function handleQualityRoutes(
  req: Request,
  routePath: string,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  if (routePath === "/quality/maps") return await handleMaps(isDemo, origin);
  if (routePath === "/quality/aggregators") return await handleAggregators(isDemo, origin);
  if (routePath !== "/quality") return null;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "rs" && kind !== "rko") return apiErr(400, "kind must be rs or rko", origin);
  if (isDemo) return json({ kind, periods: [], units: [] }, 200, origin);
  try {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.view, 200, origin);
    const view = await fetchDecimus(kind);
    cache.set(kind, { at: Date.now(), view });
    return json(view, 200, origin);
  } catch (e) {
    if (e instanceof DecimusNotConfigured) {
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

async function handleMaps(isDemo: boolean, origin: string): Promise<Response> {
  const now = new Date();
  const on = isoDay(now);
  const compare = isoDay(new Date(now.getTime() - MAPS_COMPARE_DAYS * 86_400_000));
  if (isDemo) return json(emptyMaps(on, compare), 200, origin);
  try {
    const hit = mapsCache.get(on);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.view, 200, origin);
    const view = await fetchMaps(on, compare);
    mapsCache.set(on, { at: Date.now(), view });
    return json(view, 200, origin);
  } catch (e) {
    if (e instanceof DecimusNotConfigured) {
      console.error("[quality/maps]", e.message);
      return apiErr(503, "ratings source is not configured", origin);
    }
    return serverError(origin, "quality/maps", e);
  }
}

const emptyAggregators = (on: string, compare: string): AggregatorsView => ({
  on,
  compare,
  aggregators: [],
  countries: [],
  loaded_at: null,
});

async function handleAggregators(isDemo: boolean, origin: string): Promise<Response> {
  const now = new Date();
  const on = isoDay(now);
  const compare = isoDay(new Date(now.getTime() - MAPS_COMPARE_DAYS * 86_400_000));
  if (isDemo) return json(emptyAggregators(on, compare), 200, origin);
  try {
    const hit = aggregatorsCache.get(on);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.view, 200, origin);
    const view = await fetchAggregators(on, compare);
    aggregatorsCache.set(on, { at: Date.now(), view });
    return json(view, 200, origin);
  } catch (e) {
    if (e instanceof DecimusNotConfigured) {
      console.error("[quality/aggregators]", e.message);
      return apiErr(503, "ratings source is not configured", origin);
    }
    return serverError(origin, "quality/aggregators", e);
  }
}
