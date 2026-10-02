// Общее для сборщиков «Анализа рынка»: HTTP с User-Agent, отправка в market-ingest, парсеры
// открытых источников. Парсеры — чистые функции под тестами (scripts/market/parse.test.ts).
import type {
  DodoUnit,
  IngestPayload,
  OsmPoint,
} from "../../supabase/functions/market-ingest/types.ts";

export const UA = "swarm-market/1.0 (+https://github.com/GarroV/Swarm-brain)";
const TIMEOUT_MS = 170_000;

/** GET с User-Agent (Overpass без него отвечает 406), один повтор через 5 с. */
export async function httpGet(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  for (let attempt = 0;; attempt++) {
    const r = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.ok) return r;
    await r.body?.cancel();
    if (attempt >= 1) {
      throw new Error(`${url.slice(0, 120)} → HTTP ${r.status}`);
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
}
export async function getJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await httpGet(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  return await r.json() as T;
}

export async function postIngest(payload: IngestPayload): Promise<unknown> {
  const url = Deno.env.get("MARKET_INGEST_URL"),
    token = Deno.env.get("MARKET_INGEST_TOKEN");
  if (!url || !token) {
    throw new Error("нет MARKET_INGEST_URL / MARKET_INGEST_TOKEN");
  }
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    throw new Error(
      `ingest → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`,
    );
  }
  return await r.json();
}

const CHANNEL: Record<string, string> = {
  OrdersCountByAggregator: "aggregator",
  OrdersCountByRestaurant: "restaurant",
  OrdersCountByMobile: "mobile",
  OrdersCountBySite: "site",
  OrdersCountByPhone: "phone",
  OrdersCountByKiosk: "kiosk",
  OrdersCountByPizzeria: "pizzeria",
};
export function parseCountBySource(
  j: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(CHANNEL).filter(([k]) => j[k]).map(([k, v]) => [v, j[k]]),
  );
}

type RawUnit = {
  Name: string;
  Type: number;
  State: number;
  BeginDateWork?: string | null;
  OrganizationName?: string | null;
  AddressText?: string | null;
  AddressDetails?: { LocalityName?: string | null } | null;
  Location?: { Latitude: number; Longitude: number } | null;
};
/** Не открывшаяся пиццерия приходит с BeginDateWork «0001-01-01» — это пустое значение,
 *  а не дата: такая точка уехала бы в начало всех графиков. */
const EARLIEST_REAL_YEAR = 1990;
function openedDate(raw: string | null | undefined): string | null {
  if (!raw || Number(raw.slice(0, 4)) < EARLIEST_REAL_YEAR) return null;
  return raw.slice(0, 10);
}

/** Только пиццерии (Type=1); офисы и производства не точки рынка. */
export function parseDodoUnits(raw: RawUnit[]): DodoUnit[] {
  return raw.filter((u) => u.Type === 1).map((u) => ({
    name: u.Name,
    city: u.AddressDetails?.LocalityName ?? null,
    address: u.AddressText ?? null,
    lat: u.Location?.Latitude ?? null,
    lng: u.Location?.Longitude ?? null,
    opened: openedDate(u.BeginDateWork),
    open: u.State === 1,
    organization: u.OrganizationName ?? null,
  }));
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
type FinMetrics = {
  response?: {
    currency?: string;
    previous_month?: { revenue?: number; name?: string; year?: number };
    working_pizzerias?: number;
  };
};
export function parseFinancialMetrics(
  j: FinMetrics,
):
  | {
    month: string;
    amount: number;
    currency: string;
    units: number | null;
    rates?: Record<string, number>;
  }
  | null {
  const pm = j.response?.previous_month;
  const m = MONTHS.indexOf(pm?.name ?? "");
  if (!pm || m < 0 || !pm.year || typeof pm.revenue !== "number") return null;
  return {
    month: `${pm.year}-${String(m + 1).padStart(2, "0")}`,
    amount: pm.revenue,
    currency: j.response?.currency ?? "EUR",
    units: j.response?.working_pizzerias ?? null,
  };
}

type OverpassEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
/** brands: ключ сети → значения тега brand в OSM (без учёта регистра). */
/** Таймаут и нехватку памяти Overpass сообщает не кодом ответа, а строкой `remark` при HTTP 200
 *  и обрезанном списке. Принять такой список — значит записать «точки пропали» и успешный прогон. */
const OVERPASS_FAILURE = /error|timed out|out of memory/i;

/** names: ключ сети → начала тега name — для сетей, у которых в OSM нет тега brand (часто
 *  локальные, бывает кириллицей). Совпадение — имя целиком или имя и дальше пробел. brand важнее. */
export function parseOverpass(
  j: { elements: OverpassEl[]; remark?: string },
  brands: Record<string, string[]>,
  names: Record<string, string[]> = {},
): OsmPoint[] {
  if (j.remark && OVERPASS_FAILURE.test(j.remark)) {
    throw new Error(`overpass: ${j.remark.slice(0, 200)}`);
  }
  const byBrand = new Map(
    Object.entries(brands).flatMap(([key, names]) =>
      names.map((n) => [n.toLowerCase(), key])
    ),
  );
  const prefixes = Object.entries(names).flatMap(([key, ns]) =>
    ns.map((n) => [n.toLowerCase(), key] as const)
  );
  const byName = (name: string | undefined) => {
    const n = (name ?? "").toLowerCase();
    return prefixes.find(([p]) => n === p || n.startsWith(`${p} `))?.[1];
  };
  return j.elements.flatMap((e): OsmPoint[] => {
    const chain = byBrand.get((e.tags?.brand ?? "").toLowerCase()) ??
      byName(e.tags?.name);
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!chain || lat === undefined || lng === undefined) return [];
    const street = [e.tags?.["addr:street"], e.tags?.["addr:housenumber"]]
      .filter(Boolean).join(" ");
    return [{
      chain,
      name: e.tags?.name ?? e.tags?.brand ?? chain,
      lat,
      lng,
      city: e.tags?.["addr:city"] ?? null,
      address: street || null,
      osm_id: `${e.type}/${e.id}`,
    }];
  });
}

/** Курс динара: у ЕЦБ ряда RSD нет (404), берём средний курс Национального банка Сербии за период
 *  («2026-09» — месяц, «2025» — год; exchange_middle, динаров за 1 €), по дням периода; зеркало kurs.resenje.org. Дней нет — null. */
export function parseNbsAverage(
  j: { rates: Array<{ date: string; exchange_middle: number }> },
  period: string,
): number | null {
  const days = j.rates.filter((r) => r.date.startsWith(`${period}-`));
  if (!days.length) return null;
  const avg = days.reduce((s, r) => s + r.exchange_middle, 0) / days.length;
  return Math.round(avg * 10_000) / 10_000;
}

type EcbJson = {
  dataSets: Array<
    {
      series: Record<
        string,
        { observations: Record<string, [number | null, ...unknown[]]> }
      >;
    }
  >;
  structure: {
    dimensions: { observation: Array<{ values: Array<{ id: string }> }> };
  };
};
/** Ряд курсов ЕЦБ: период («2025» или «2026-09») → единиц валюты за 1 €. */
export function parseEcbSeries(j: EcbJson): Record<string, number> {
  const periods = j.structure.dimensions.observation[0]?.values ?? [];
  const series = Object.values(j.dataSets[0]?.series ?? {})[0];
  if (!series) return {};
  return Object.fromEntries(
    Object.entries(series.observations).flatMap(([i, [v]]) =>
      typeof v === "number" && periods[Number(i)]
        ? [[periods[Number(i)].id, v]]
        : []
    ),
  );
}

/** Среднегодовой курс ЕЦБ (EXR/A.<CUR>.EUR.SP00.A): год → единиц валюты за 1 €. */
export function parseEcbAnnual(j: EcbJson): Record<number, number> {
  return Object.fromEntries(
    Object.entries(parseEcbSeries(j)).map(([y, v]) => [Number(y), v]),
  );
}

/** Строки текстового потока по одной, без загрузки файла в память (выгрузки реестров — сотни МБ). */
export async function* lines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) {
    const parts = (tail + dec.decode(chunk, { stream: true })).split("\n");
    tail = parts.pop() ?? "";
    for (const p of parts) yield p.replace(/\r$/, "");
  }
  tail += dec.decode();
  if (tail) yield tail.replace(/\r$/, "");
}

/** Скачать архив во временный файл и отдать строки первого файла внутри (`unzip -p`). */
export async function* zipLines(url: string): AsyncGenerator<string> {
  const tmp = await Deno.makeTempFile({ suffix: ".zip" });
  try {
    const r = await httpGet(url);
    const f = await Deno.open(tmp, { write: true, truncate: true });
    await r.body!.pipeTo(f.writable);
    const p = new Deno.Command("unzip", {
      args: ["-p", tmp],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    yield* lines(p.stdout);
    const st = await p.status;
    if (!st.success) throw new Error(`unzip ${url.slice(-60)}: код ${st.code}`);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}
