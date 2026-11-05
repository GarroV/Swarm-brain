// GET /inspections?from=&to= и GET /inspections/:id — проверки Децимуса (блок 3, решение 11.10.2026):
// список последних подтверждённых проверок и деталь (итог, зоны, нарушения). Тот же прокси, кэш и
// границы, что у /quality: страны — все, без разреза по allowed_markets (решение 05.11.2026: проверки
// общие). Демо настоящих проверок не видит. report_url — ссылка на отчёт в Децимусе (DECIMUS_API_URL + path), клиенту env не нужен.
import { decimusGet, DecimusHttpError, DecimusNotConfigured, decimusPageUrl } from "../_shared/decimus.ts";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import {
  type Inspection,
  type InspectionDetail,
  toInspectionDetail,
  toInspectionsView,
} from "../_shared/inspections-view.ts";

const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const DEFAULT_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WithReport<T> = T & { report_url: string | null };
type ListOut = { inspections: WithReport<Inspection>[]; truncated: boolean };
type DetailOut = { inspection: WithReport<InspectionDetail["inspection"]>; findings: InspectionDetail["findings"] };

const listCache = new Map<string, { at: number; out: ListOut }>();
const detailCache = new Map<string, { at: number; out: DetailOut | null }>();

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const withReport = <T extends { path: string }>(r: T): WithReport<T> => ({ ...r, report_url: decimusPageUrl(r.path) });

function remember<V>(cache: Map<string, { at: number; out: V }>, key: string, out: V): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { at: Date.now(), out });
}

const fresh = <V>(hit: { at: number; out: V } | undefined) => hit && Date.now() - hit.at < CACHE_MS ? hit : null;

export async function handleInspectionRoutes(
  req: Request,
  routePath: string,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  if (routePath === "/inspections") return await handleList(req, isDemo, origin);
  const m = routePath.match(/^\/inspections\/([^/]+)$/);
  return m ? await handleDetail(decodeURIComponent(m[1]), isDemo, origin) : null;
}

async function handleList(req: Request, isDemo: boolean, origin: string): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const now = new Date();
  const from = q.get("from") ?? isoDay(new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS));
  const to = q.get("to") ?? isoDay(now);
  if (!DATE.test(from) || !DATE.test(to)) return apiErr(400, "from and to must be YYYY-MM-DD", origin);
  const empty: ListOut = { inspections: [], truncated: false };
  if (isDemo) return json(empty, 200, origin);
  try {
    const key = `${from}|${to}`;
    const hit = fresh(listCache.get(key));
    if (hit) return json(hit.out, 200, origin);
    const body = await decimusGet("/api/v1/inspections", { from, to });
    const view = toInspectionsView(body, null);
    const out: ListOut = { inspections: view.inspections.map(withReport), truncated: view.truncated };
    remember(listCache, key, out);
    return json(out, 200, origin);
  } catch (e) {
    return failure(e, "inspections", origin);
  }
}

async function handleDetail(id: string, isDemo: boolean, origin: string): Promise<Response> {
  if (!UUID.test(id)) return apiErr(400, "bad inspection id", origin);
  if (isDemo) return apiErr(404, "inspection not found", origin);
  try {
    const key = id.toLowerCase();
    const hit = fresh(detailCache.get(key));
    const out = hit ? hit.out : await loadDetail(id, key);
    return out ? json(out, 200, origin) : apiErr(404, "inspection not found", origin);
  } catch (e) {
    return failure(e, "inspections/:id", origin);
  }
}

/** Деталь из Децимуса; «нет такой» — null (запоминается и это — перебором не пробить кэш). */
async function loadDetail(id: string, key: string): Promise<DetailOut | null> {
  let out: DetailOut | null = null;
  try {
    const view = toInspectionDetail(await decimusGet(`/api/v1/inspections/${id}`), null);
    if (view) out = { inspection: withReport(view.inspection), findings: view.findings };
  } catch (e) {
    if (!(e instanceof DecimusHttpError && e.status === 404)) throw e;
  }
  remember(detailCache, key, out);
  return out;
}

function failure(e: unknown, where: string, origin: string): Response {
  if (e instanceof DecimusNotConfigured) {
    console.error(`[${where}]`, e.message);
    return apiErr(503, "inspections source is not configured", origin);
  }
  return serverError(origin, where, e);
}
