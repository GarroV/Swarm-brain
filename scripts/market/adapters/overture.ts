// Overture Maps places (CDLA-Permissive) через DuckDB: точки сетей и поиск сетей, которых нет в
// конфиге. Нужен там, где публичный Overpass не вытягивает страну целиком (Испания, Польша…).
// Сверка 11.10.2026: чтение parquet из S3 под Deno работает, ~7–46 с на страну.
import { DuckDBInstance } from "@duckdb/node-api";
import {
  type DiscoveredChain,
  FORMAT_WITH_MCCAFE,
  type OsmPoint,
} from "../../../supabase/functions/market-ingest/types.ts";
import type { CountryConfig } from "../countries/types.ts";
import { distanceM, samePlace } from "../../../supabase/functions/_shared/market/geo.ts";
import { httpGet } from "../lib.ts";
import type { Adapter } from "./types.ts";

const BUCKET = "overturemaps-us-west-2";
const LIST_URL =
  `https://${BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/`;
const CATEGORIES = [
  "fast_food_restaurant",
  "restaurant",
  "pizza_restaurant",
  "burger_restaurant",
  "chicken_restaurant",
  "sandwich_shop",
  "casual_eatery",
  "cafe",
  "coffee_shop",
  "bakery",
  "food_court",
];
/** Сеть с брендом — от 3 точек; без бренда (по имени заведения) — от 5 точек в 3 разных
 *  населённых пунктах: иначе «Pizzeria» и «Kebab» из разных рук склеились бы в «сеть». */
export const MIN_BRANDED = 3;
export const MIN_UNBRANDED = 5;
export const MIN_LOCALITIES = 3;
export const MAX_DISCOVERED = 40;
const MAX_KEY = 40;
/** Overture держит одно заведение двумя записями (разные id, 0–25 м): на карте это одна точка. */
export const DUPLICATE_M = 25;
// Латиница и кириллица: в Беларуси Overture держит пиццерии как «Додо Пицца Беларусь».
const DODO = /dodo\s*pizza|^dodo\b|додо\s*пицц|^додо(?!\p{L})/iu;

export type PlaceRow = {
  id: string;
  name: string | null;
  brand: string | null;
  wikidata: string | null;
  category: string | null;
  locality: string | null;
  address: string | null;
  lat: number;
  lng: number;
};

const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’‘´`]/g, "'")
    .toLowerCase();
const norm = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, "");
// #1134: an exact generic label is not a chain, regardless of venue/city count.
// Check admission before merging, so unbranded generic rows cannot attach to a brand.
// Explicit configured matches are resolved first and remain authoritative.
const GENERIC_UNBRANDED_NAMES = new Set(
  ["кофейня", "пиццерия", "кафе", "столовая", "pizzeria", "kebab"].map(norm),
);
const isLetter = (c: string | undefined) => !!c && /\p{L}/u.test(c);

/** Начало строки совпало с образцом целым словом: «Domino's Pizza Deutschland» ~ «Domino's». */
function startsWithWord(value: string, prefix: string): boolean {
  const v = fold(value).trim(), p = fold(prefix).trim();
  return !!p && v.startsWith(p) && !isLetter(v[p.length]);
}

function matchConfig(row: PlaceRow, cfg: CountryConfig): string | null {
  for (const ch of cfg.chains) {
    const byBrand = row.brand &&
      ch.osmBrands?.some((b) => startsWithWord(row.brand!, b));
    const byName = row.name &&
      [...(ch.osmNames ?? []), ...(ch.osmBrands ?? [])].some((n) =>
        startsWithWord(row.name!, n)
      );
    if (byBrand || byName) return ch.key;
  }
  return null;
}

const SEGMENT_BY_NAME: Array<[string, RegExp]> = [
  ["pizza", /pizz|pica|пицц/],
  ["burger", /burger/],
  ["chicken", /chicken|kfc|popeyes/],
  ["coffee", /coffee|caf[eé]|kaffee|kawiarnia|cofe|кофе/],
  [
    "bakery",
    /bakery|b[aä]ckerei|piekarnia|pekar|panader|kepyk|p[eé]ks[eé]g|cukiern|пекар|кондитер/,
  ],
  ["asian", /sushi|wok|asia|noodle/],
  ["grill", /kebab|d[oö]ner|grill|shawarma/],
  ["sandwich", /sandwich|subway/],
];
const SEGMENT_BY_CATEGORY: Record<string, string> = {
  pizza_restaurant: "pizza",
  burger_restaurant: "burger",
  chicken_restaurant: "chicken",
  sandwich_shop: "sandwich",
  cafe: "coffee",
  coffee_shop: "coffee",
  bakery: "bakery",
};

/** Сегмент по названию (регулярки), а если название ничего не говорит — по категории,
 *  за которую большинство точек сети. */
export function classify(name: string, categories: string[]): string {
  const n = name.toLowerCase();
  for (const [seg, re] of SEGMENT_BY_NAME) if (re.test(n)) return seg;
  const votes = new Map<string, number>();
  for (const c of categories) {
    const seg = SEGMENT_BY_CATEGORY[c];
    if (seg) votes.set(seg, (votes.get(seg) ?? 0) + 1);
  }
  const top = [...votes].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] * 2 > categories.length ? top[0] : "other";
}

function mostFrequent(values: string[]): string {
  const c = new Map<string, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
}

function slug(name: string, taken: Set<string>, fallback: string): string {
  const base = fold(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, MAX_KEY - 4).replace(/-+$/g, "") || fallback;
  let key = base, i = 2;
  while (taken.has(key)) key = `${base}-${i++}`;
  taken.add(key);
  return key;
}

const isMcCafe = (row: PlaceRow) =>
  [row.name, row.brand].some((v) => !!v && /\bmccafe\b/.test(fold(v)));

const toPoint = (row: PlaceRow, chain: string): OsmPoint => ({
  ...(isMcCafe(row) ? { format: FORMAT_WITH_MCCAFE } : {}),
  chain,
  name: row.name ?? row.brand ?? chain,
  lat: row.lat,
  lng: row.lng,
  city: row.locality,
  address: row.address,
  osm_id: row.id,
});

const isBranded = (g: PlaceRow[]) => g.some((r) => r.brand);

/** Двойники — по общему samePlace: ближе DUPLICATE_M или одинаковый адрес в пределах
 *  канонического допуска 5 км. Иначе один магазин в текущем пакете считается дважды. */
function uniquePlaces<T>(items: T[], point: (item: T) => OsmPoint): T[] {
  const kept = new Map<string, OsmPoint[]>();
  return items.filter((item) => {
    const p = point(item);
    const same = kept.get(p.chain) ?? [];
    if (samePlace(p, same, DUPLICATE_M)) return false;
    kept.set(p.chain, [...same, p]);
    return true;
  });
}

/** McCafé сидит рядом с McDonald's, но не обязательно в тех же 25 м (на проде 25–50 м, адрес записан
 *  по-разному): пара «с пометкой / без» склеивается до 50 м, если номера домов не спорят (#1113). */
export const MCCAFE_PAIR_M = 50;
const numbersOf = (a: string | null) => new Set(a?.match(/\d+/g) ?? []);
const numbersConflict = (a: OsmPoint, b: OsmPoint) => {
  const x = numbersOf(a.address), y = numbersOf(b.address);
  return x.size > 0 && y.size > 0 && ![...x].some((n) => y.has(n));
};
const samePoint = (p: OsmPoint, k: OsmPoint) =>
  samePlace(p, [k], DUPLICATE_M) ||
  (!p.format !== !k.format && distanceM(p, k) <= MCCAFE_PAIR_M && !numbersConflict(p, k));

/** Двойники точек схлопываются в одну. McCafé в одном месте с McDonald's — одна точка
 *  McDonald's с пометкой format (#1113): остаётся строка без McCafé в названии, пометка не теряется. */
export function dropDuplicates(points: OsmPoint[]): OsmPoint[] {
  const out: OsmPoint[] = [];
  const slots = new Map<string, number[]>();
  for (const p of points) {
    const mine = slots.get(p.chain) ?? [];
    slots.set(p.chain, mine);
    const at = mine.find((i) => samePoint(p, out[i]));
    if (at === undefined) {
      mine.push(out.push(p) - 1);
      continue;
    }
    const k = out[at];
    const format = k.format ?? p.format;
    const base = k.format && !p.format ? p : k;
    out[at] = format ? { ...base, format } : base;
  }
  return out;
}

/** Чистая функция без сети: строки Overture → точки сетей из конфига + найденные сети. */
export function discover(
  rows: PlaceRow[],
  cfg: CountryConfig,
): { points: OsmPoint[]; chains: DiscoveredChain[] } {
  const points: OsmPoint[] = [];
  const groups = new Map<string, PlaceRow[]>();
  for (const row of rows) {
    // Dodo приходит из публичного API Dodo, из карты его не берём.
    if (DODO.test(row.brand ?? "") || DODO.test(row.name ?? "")) continue;
    const key = matchConfig(row, cfg);
    if (key) {
      points.push(toPoint(row, key));
      continue;
    }
    const label = row.brand ?? row.name;
    if (!label) continue;
    const normalized = norm(label);
    if (
      !normalized || (!row.brand && GENERIC_UNBRANDED_NAMES.has(normalized))
    ) continue;
    const gk = row.wikidata
      ? `w:${row.wikidata}`
      : `${row.brand ? "b" : "n"}:${normalized}`;
    groups.set(gk, [...(groups.get(gk) ?? []), row]);
  }
  // Одна сеть бывает в Overture под разными wikidata и без них — склеиваем по названию.
  const merged = new Map<string, PlaceRow[]>();
  for (const g of groups.values()) {
    const nk = norm(mostFrequent(g.map((r) => (r.brand ?? r.name)!)));
    merged.set(nk, [...(merged.get(nk) ?? []), ...g]);
  }
  const found = [...merged.values()]
    .map((g) => ({
      rows: uniquePlaces(g, (r) => toPoint(r, "discovery")),
      branded: isBranded(g),
    }))
    .filter(({ rows: g, branded }) =>
      branded ? g.length >= MIN_BRANDED : (
        g.length >= MIN_UNBRANDED &&
        new Set(g.map((r) => r.locality).filter(Boolean)).size >=
          MIN_LOCALITIES
      )
    )
    .sort((a, b) => b.rows.length - a.rows.length)
    .slice(0, MAX_DISCOVERED);
  const taken = new Set(cfg.chains.map((c) => c.key));
  const chains: DiscoveredChain[] = [];
  for (const { rows: g } of found) {
    const name = mostFrequent(g.map((r) => (r.brand ?? r.name)!));
    const fallback = `chain-${
      (g[0].wikidata ?? norm(name)).toLowerCase().slice(0, 12)
    }`;
    const key = slug(name, taken, fallback);
    const segment = classify(name, g.map((r) => r.category ?? ""));
    chains.push(
      segment === "bakery"
        ? { key, name, segment, bakery: true }
        : { key, name, segment },
    );
    for (const row of g) points.push(toPoint(row, key));
  }
  return { points: dropDuplicates(points), chains };
}

/** Самый свежий релиз: префиксы release/YYYY-MM-DD.N/ из листинга бакета. */
export function latestRelease(xml: string): string {
  const all = [
    ...xml.matchAll(
      /<Prefix>release\/(\d{4}-\d{2}-\d{2})\.(\d+)\/<\/Prefix>/g,
    ),
  ].map((m) => ({ id: `${m[1]}.${m[2]}`, date: m[1], n: Number(m[2]) }));
  if (!all.length) throw new Error("overture: в листинге бакета нет релизов");
  all.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  return all[all.length - 1].id;
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function placesQuery(
  release: string,
  country: string,
  [w, s, e, n]: [number, number, number, number],
): string {
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error(`overture: страна «${country}»`);
  }
  return `SELECT id, names.primary AS name, brand.names.primary AS brand,
    brand.wikidata AS wikidata, basic_category AS category,
    addresses[1].locality AS locality, addresses[1].freeform AS address,
    (bbox.ymin + bbox.ymax) / 2 AS lat, (bbox.xmin + bbox.xmax) / 2 AS lng
  FROM read_parquet('s3://${BUCKET}/release/${release}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN ${w} AND ${e} AND bbox.ymin BETWEEN ${s} AND ${n}
    AND addresses[1].country = ${sqlStr(country)}
    AND operating_status IS DISTINCT FROM 'permanently_closed'
    AND basic_category IN (${CATEGORIES.map(sqlStr).join(", ")})`;
}

async function fetchRows(cfg: CountryConfig): Promise<PlaceRow[]> {
  if (!cfg.bbox) {
    throw new Error(`overture: у ${cfg.country} нет bbox в конфиге`);
  }
  const release = latestRelease(await (await httpGet(LIST_URL)).text());
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
    const reader = await conn.runAndReadAll(
      placesQuery(release, cfg.country, cfg.bbox),
    );
    return reader.getRowObjectsJson() as unknown as PlaceRow[];
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

export const overture: Adapter = {
  id: "overture",
  about: {
    url: "https://docs.overturemaps.org/guides/places/",
    what:
      "точки сетей из Overture Maps places (последний релиз, parquet в S3, через DuckDB): заведения общепита и пекарни страны в её bbox, без закрытых; сети из конфига — по бренду (osmBrands, допускается суффикс страны) или началу названия (osmNames), остальные сети находятся сами (бренд от 3 точек, без бренда от 5 точек в 3 населённых пунктах, не больше 40); точка — центр bbox объекта",
  },
  async collect(cfg) {
    const started_at = new Date().toISOString();
    const base = {
      country: cfg.country,
      started_at,
      source: "overture" as const,
    };
    try {
      const { points, chains } = discover(await fetchRows(cfg), cfg);
      return { ...base, points, rejected: [], chains };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
