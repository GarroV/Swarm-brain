// Decimus is the source and history store; Swarm keeps only a short response cache.
import { decimusGet, DecimusHttpError, DecimusNotConfigured } from "../_shared/decimus.ts";
import { apiErr, json } from "./http.ts";

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();
type Source = typeof decimusGet;

export function performanceQuery(url: URL): Record<string, string> | null {
  const raw = url.searchParams.get("countries") ?? "";
  const codes = [...new Set(raw.split(",").map((v) => v.trim().toUpperCase()))].sort();
  if (!codes.length || codes.length > 30 || codes.some((v) => !/^[A-Z]{2}$/.test(v))) return null;
  const query: Record<string, string> = { countries: codes.join(",") };
  const day = url.searchParams.get("as_of");
  if (day !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
    query.as_of = day;
  }
  return query;
}

export async function handlePerformanceRoutes(
  req: Request,
  routePath: string,
  isDemo: boolean,
  origin: string,
  source: Source = decimusGet,
): Promise<Response | null> {
  if (routePath !== "/performance") return null;
  if (req.method !== "GET") return apiErr(405, "method not allowed", origin);
  const query = performanceQuery(new URL(req.url));
  if (!query) return apiErr(400, "countries and a valid as_of date are required", origin);
  if (isDemo) return json({ as_of: query.as_of ?? null, countries: [] }, 200, origin);
  const key = JSON.stringify(query);
  // Tests supply their own source and never share the live cache.
  const useCache = source === decimusGet;
  const hit = useCache ? cache.get(key) : null;
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body, 200, origin);
  try {
    const body = await source("/api/v1/performance", query);
    if (!body || typeof body !== "object" || !Array.isArray((body as { countries?: unknown }).countries)) {
      throw new Error("invalid source shape");
    }
    const allowed = query.countries.split(",");
    const rows = (body as { countries: { cc?: unknown }[] }).countries;
    if (rows.some((row) => !row || typeof row.cc !== "string" || !allowed.includes(row.cc))) {
      throw new Error("invalid source country scope");
    }
    if (useCache) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), body });
    }
    return json(body, 200, origin);
  } catch (error) {
    if (error instanceof DecimusNotConfigured) return apiErr(503, "performance source is not configured", origin);
    // Do not return source exception text, credentials, or response contents.
    const status = error instanceof DecimusHttpError ? error.status : 502;
    const responseStatus = status === 400 ? 400 : status === 403 || status === 401 ? 503 : 502;
    console.warn("[performance] source unavailable", { status });
    return apiErr(
      responseStatus,
      status === 400 ? "invalid performance period" : "performance source is unavailable",
      origin,
    );
  }
}
