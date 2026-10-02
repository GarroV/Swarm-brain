// Ручная часть страны в «Анализе рынка»: блоки эталона, вписанные руками (таблица
// mkt_editorial, импорт — ключ editorial снимка). Сервер проверяет только форму верхнего
// уровня; здесь каждый блок разбирается по полям, кривые записи пропускаются, а не роняют
// экран. Нет блока — экран показывает вычисленный вариант или прячет кусок.

type Raw = Record<string, unknown>;

export type EdHeader = { brand: string | null; eyebrow: string | null; title: string | null; lede: string | null; sources: string | null };
export type EdKpi = { value: string | null; label: string | null; note: string | null };
export type EdSummary = { title: string; big: string; text: string };
export type EdEventKind = "entry" | "exit" | "deal" | "open" | "plan" | "pause";
export type EdEvent = { date: string; kind: EdEventKind; chain: string; text: string };
export type EdGrowth = { keys: string[]; hist: Record<string, Record<number, number>>; notes: Record<string, string> };
export type EdPizzaRow = {
  name: string;
  chain: string;
  units: string;
  entry: string;
  rev: Record<string, number | null>;
  per: Record<string, number | null>;
  lfl: string;
  note: string;
};
export type EdDodoMonth = { m: string; usd: number; fx: number; eur: number; units: number; per: number };
export type EdDodoOps = { u: string; m: number; rev: number; agg: number; din: number; own: number; o: number; oagg: number; odin: number; oown: number };
export type EdBasket = { col: string; one: number; two: number; promo: string };
export type EdOpsModel = { chains: string[]; rows: string[][] };
export type EdRating = { chain: string; point: string; city: string; google: number; reviews: number | null; wolt: number | null };
export type EdPlatform = { name: string; slot: number; note: string | null; years: Array<{ year: number; revenue_eur: number }> };
export type EdFigure = { big: string; text: string; source: string | null };
/** company — рег. номер или начало названия юрлица: для строки, у которой нет сети в справочнике. */
export type EdMoneyRow = { prefix: string; chains: string[] | null; company: string | null; label: string | null };
/** Уточнённая дата открытия точки (журнал вычитки эталона): имя точки ровно как в реестре. */
export type EdLocationDate = { name: string; opened: string; note: string | null };
export type EdPreset = { name: string; box: [number, number, number, number] };
export type EdPriceCol = { title: string; chain: string; channel: RegExp | null; cm: number | null; exclude: RegExp | null };

export type Editorial = {
  header: EdHeader | null;
  kpis: EdKpi[];
  summary: EdSummary[];
  texts: Record<string, string>;
  events: EdEvent[];
  growth: EdGrowth | null;
  pizzaTable: EdPizzaRow[];
  dodoMonthly: EdDodoMonth[];
  dodoOps: EdDodoOps[];
  basket: EdBasket[];
  opsModel: EdOpsModel | null;
  ratings: EdRating[];
  platforms: EdPlatform[];
  deliveryFigures: EdFigure[];
  marketFacts: EdFigure[];
  moneyRows: EdMoneyRow[];
  mapPresets: EdPreset[];
  pricesCols: EdPriceCol[];
  locationDates: EdLocationDate[];
};

const EVENT_KINDS: readonly EdEventKind[] = ["entry", "exit", "deal", "open", "plan", "pause"];

const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const textOf = (v: unknown): string | null => str(v) ?? (num(v) !== null ? String(v) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown): string[] => list(v).map(str).filter((s): s is string => s !== null);

function rows<T>(v: unknown, parse: (r: Raw) => T | null): T[] {
  return list(v).map((x) => {
    const r = obj(x);
    return r ? parse(r) : null;
  }).filter((x): x is T => x !== null);
}

function numMap(v: unknown): Record<string, number | null> {
  const r = obj(v);
  if (!r) return {};
  return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, num(x)]));
}

function strMap(v: unknown): Record<string, string> {
  const r = obj(v);
  if (!r) return {};
  return Object.fromEntries(Object.entries(r).flatMap(([k, x]) => (str(x) ? [[k, x as string]] : [])));
}

/** Строка регулярного выражения из ручной заливки; кривая — как будто её нет. */
function regex(v: unknown): RegExp | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new RegExp(s);
  } catch {
    return null;
  }
}

function parseGrowth(v: unknown): EdGrowth | null {
  const r = obj(v);
  if (!r) return null;
  const keys = strList(r.keys);
  if (!keys.length) return null;
  const hist: EdGrowth["hist"] = {};
  for (const [k, years] of Object.entries(obj(r.hist) ?? {})) {
    const pts = Object.entries(obj(years) ?? {}).flatMap(([y, n]) => (num(n) !== null && /^\d{4}$/.test(y) ? [[+y, n as number]] : []));
    if (pts.length) hist[k] = Object.fromEntries(pts);
  }
  return { keys, hist, notes: strMap(r.notes) };
}

function parseOpsModel(v: unknown): EdOpsModel | null {
  const r = obj(v);
  if (!r) return null;
  const chains = strList(r.chains);
  const body = list(r.rows).map((row) => list(row).map((c) => textOf(c) ?? "—")).filter((row) => row.length === chains.length + 1);
  return chains.length && body.length ? { chains, rows: body } : null;
}

const DODO_OPS_KEYS = ["rev", "agg", "din", "own", "o", "oagg", "odin", "oown"] as const;

export function parseEditorial(raw: unknown): Editorial {
  const e = obj(raw) ?? {};
  const h = obj(e.header);
  return {
    header: h ? { brand: str(h.brand), eyebrow: str(h.eyebrow), title: str(h.title), lede: str(h.lede), sources: str(h.sources) } : null,
    kpis: list(e.kpis).slice(0, 4).map((x) => {
      const r = obj(x) ?? {};
      return { value: textOf(r.value), label: str(r.label), note: str(r.note) };
    }),
    summary: rows(e.summary, (r) => (str(r.title) && str(r.big) ? { title: r.title as string, big: r.big as string, text: str(r.text) ?? "" } : null)),
    texts: strMap(e.texts),
    events: rows(e.events, (r) => {
      const date = str(r.date);
      const kind = EVENT_KINDS.find((k) => k === r.kind);
      if (!date || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) || !kind || !str(r.text)) return null;
      return { date, kind, chain: str(r.chain) ?? "", text: r.text as string };
    }),
    growth: parseGrowth(e.growth),
    pizzaTable: rows(e.pizza_table, (r) =>
      str(r.name) && str(r.chain)
        ? {
          name: r.name as string,
          chain: r.chain as string,
          units: textOf(r.units) ?? "—",
          entry: str(r.entry) ?? "—",
          rev: numMap(r.rev),
          per: numMap(r.per),
          lfl: str(r.lfl) ?? "—",
          note: str(r.note) ?? "",
        }
        : null
    ),
    dodoMonthly: rows(e.dodo_monthly, (r) => {
      const m = str(r.m), eur = num(r.eur);
      if (!m || !/^\d{4}-\d{2}$/.test(m) || eur === null) return null;
      return { m, eur, usd: num(r.usd) ?? 0, fx: num(r.fx) ?? 0, units: num(r.units) ?? 0, per: num(r.per) ?? eur };
    }).sort((a, b) => a.m.localeCompare(b.m)),
    dodoOps: rows(e.dodo_ops, (r) => {
      const u = str(r.u), m = num(r.m);
      if (!u || m === null || m < 1 || m > 12) return null;
      const vals = Object.fromEntries(DODO_OPS_KEYS.map((k) => [k, num(r[k]) ?? 0])) as Record<(typeof DODO_OPS_KEYS)[number], number>;
      return vals.o > 0 ? { u, m, ...vals } : null;
    }),
    basket: rows(e.basket, (r) => (str(r.col) && num(r.one) !== null ? { col: r.col as string, one: r.one as number, two: num(r.two) ?? 0, promo: str(r.promo) ?? "" } : null)),
    opsModel: parseOpsModel(e.ops_model),
    ratings: rows(e.ratings, (r) =>
      str(r.chain) && str(r.point) && num(r.google) !== null
        ? { chain: r.chain as string, point: r.point as string, city: str(r.city) ?? "", google: r.google as number, reviews: num(r.reviews), wolt: num(r.wolt) }
        : null
    ),
    platforms: rows(e.delivery_platforms, (r) => {
      const name = str(r.name);
      if (!name) return null;
      const years = rows(r.years, (y) => (num(y.year) !== null && num(y.revenue_eur) !== null ? { year: y.year as number, revenue_eur: y.revenue_eur as number } : null));
      return years.length ? { name, slot: num(r.slot) ?? 0, note: str(r.note), years } : null;
    }),
    deliveryFigures: rows(e.delivery_figures, figure),
    marketFacts: rows(e.market_facts, figure),
    moneyRows: rows(e.money_rows, (r) => (str(r.prefix) ? { prefix: r.prefix as string, chains: Array.isArray(r.chains) ? strList(r.chains) : null, company: textOf(r.company), label: str(r.label) } : null)),
    mapPresets: rows(e.map_presets, (r) => {
      const box = list(r.box).map(num);
      return str(r.name) && box.length === 4 && box.every((x) => x !== null) ? { name: r.name as string, box: box as EdPreset["box"] } : null;
    }),
    locationDates: rows(e.location_dates, (r) =>
      str(r.name) && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(r.opened)) ? { name: r.name as string, opened: r.opened as string, note: str(r.note) } : null
    ),
    pricesCols: rows(e.prices_cols, (r) =>
      str(r.title) && str(r.chain) ? { title: r.title as string, chain: r.chain as string, channel: regex(r.channel), cm: num(r.cm), exclude: regex(r.exclude) } : null
    ),
  };
}

type Dated = { name: string; opened: string | null; opened_estimated: boolean; verification_note: string | null };

/** Точки с уточнённой датой из ручной части — новыми объектами; в пометке проверки остаётся собранная дата. */
export function applyLocationDates<T extends Dated>(locs: T[], dates: EdLocationDate[]): T[] {
  if (!dates.length) return locs;
  const by = new Map(dates.map((d) => [d.name, d]));
  return locs.map((l) => {
    const d = by.get(l.name);
    if (!d || d.opened === l.opened) return l;
    const was = l.opened ? ` (собрано ${l.opened})` : "";
    return { ...l, opened: d.opened, opened_estimated: false, verification_note: `Дата открытия: ${d.note ?? "ручная часть"}${was}` };
  });
}

function figure(r: Raw): EdFigure | null {
  return str(r.big) && str(r.text) ? { big: r.big as string, text: r.text as string, source: str(r.source) } : null;
}
