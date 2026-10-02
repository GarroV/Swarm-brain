// Выводы «Анализа рынка» по образцу хорватского референса: полоса ключевых цифр, карточки
// «Рынок в цифрах», открытия по годам, события и тренд «ранний период против недавнего».
// Всё считается на экране из реестра точек, юрлиц и продаж Dodo — после каждого сбора
// цифры пересчитываются сами, руками их никто не пишет. Без React — под тестами.
import type { MarketBundle, MarketChain, MarketFact, MarketLocation } from "../types.ts";
import { aliveAtYearEnd } from "./marketStats";
import { fmtMoney } from "./marketView";

export const yearOf = (s: string | null | undefined): number | null => (s && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null);

/** Ранний период — четыре года до недавнего; недавний — прошлый и текущий год. Недавний ещё
 *  не закончился, поэтому «в год» считается по прошедшим месяцам: 12 + полных месяцев этого года. */
export type Periods = { early: [number, number]; recent: [number, number]; earlyMonths: number; recentMonths: number };
export function periods(now: Date): Periods {
  const y = now.getFullYear();
  return { early: [y - 5, y - 2], recent: [y - 1, y], earlyMonths: 48, recentMonths: 12 + now.getMonth() };
}

type Loc = Pick<MarketLocation, "chain_key" | "opened" | "status" | "closed" | "city">;

/** Открытия с известным годом (без анонсов и пекарен) в диапазоне лет включительно. */
export function datedOpenings<T extends Loc>(locs: T[], bakery: ReadonlySet<string>, [from, to]: [number, number]): T[] {
  return locs.filter((l) => {
    if (l.status === "planned" || bakery.has(l.chain_key)) return false;
    const y = yearOf(l.opened);
    return y !== null && y >= from && y <= to;
  });
}

export const perYear = (n: number, months: number) => (months > 0 ? Math.round((n / months) * 12 * 10) / 10 : 0);

const countBy = <T>(xs: T[], key: (x: T) => string | null): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return new Map([...m].sort((a, b) => b[1] - a[1]));
};

export type Kpis = {
  restaurants: number;
  bakeries: number;
  bakeryNames: string[];
  openings: number;
  closures: number;
  undated: number;
  from: number;
  newBrands: Array<{ name: string; year: number | null; planned: boolean }>;
  topRevenue: { name: string; year: number; revenue: number; units: number; othersUnits: number } | null;
};

/** Первый год сети в стране: из `first_entry`, иначе по самой ранней точке. */
function entryYear(c: MarketChain, locs: Loc[]): number | null {
  const fromField = yearOf(c.first_entry);
  if (fromField !== null) return fromField;
  const ys = locs.filter((l) => l.chain_key === c.key && l.status !== "planned").map((l) => yearOf(l.opened)).filter((y): y is number => y !== null);
  return ys.length ? Math.min(...ys) : null;
}

/** Выручка сети за год — сумма по её юрлицам. */
export function chainRevenue(b: Pick<MarketBundle, "companies" | "financials">, year: number): Map<string, number> {
  const chainOf = new Map(b.companies.map((c) => [c.id, c.chain_key]));
  const m = new Map<string, number>();
  for (const f of b.financials) {
    const k = chainOf.get(f.company_id);
    if (f.year !== year || f.revenue_eur === null || !k) continue;
    m.set(k, (m.get(k) ?? 0) + f.revenue_eur);
  }
  return m;
}

export function kpis(b: Pick<MarketBundle, "chains" | "locations" | "companies" | "financials">, now: Date): Kpis {
  const y = now.getFullYear();
  const p = periods(now);
  const bakery = new Set(b.chains.filter((c) => c.is_bakery).map((c) => c.key));
  const aliveNow = b.locations.filter((l) => aliveAtYearEnd([l], y, y) === 1);
  const bakeryAlive = countBy(aliveNow.filter((l) => bakery.has(l.chain_key)), (l) => l.chain_key);
  const name = new Map(b.chains.map((c) => [c.key, c.name]));
  const span: [number, number] = [p.early[0], y];
  const closures = b.locations.filter((l) => {
    const c = yearOf(l.closed);
    return l.status === "closed" && !bakery.has(l.chain_key) && c !== null && c >= span[0] && c <= y;
  }).length;
  const regular = b.chains.filter((c) => !c.is_bakery);
  const newBrands = regular
    .map((c) => {
      const real = b.locations.some((l) => l.chain_key === c.key && l.status !== "planned");
      return { name: c.name, year: real ? entryYear(c, b.locations) : null, planned: !real && b.locations.some((l) => l.chain_key === c.key) };
    })
    .filter((n) => n.planned || (n.year !== null && n.year >= p.early[0] - 1))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

  const finYears = b.financials.filter((f) => f.revenue_eur !== null).map((f) => f.year);
  let topRevenue: Kpis["topRevenue"] = null;
  if (finYears.length) {
    const fy = Math.max(...finYears);
    const [top] = [...chainRevenue(b, fy)].sort((a, b) => b[1] - a[1]);
    if (top) {
      const units = aliveNow.filter((l) => l.chain_key === top[0]).length;
      const othersUnits = aliveNow.filter((l) => l.chain_key !== top[0] && !bakery.has(l.chain_key)).length;
      topRevenue = { name: name.get(top[0]) ?? top[0], year: fy, revenue: top[1], units, othersUnits };
    }
  }
  return {
    restaurants: aliveNow.filter((l) => !bakery.has(l.chain_key)).length,
    bakeries: [...bakeryAlive.values()].reduce((a, n) => a + n, 0),
    bakeryNames: [...bakeryAlive.keys()].slice(0, 4).map((k) => name.get(k) ?? k),
    openings: datedOpenings(b.locations, bakery, span).length,
    closures,
    undated: aliveNow.filter((l) => !bakery.has(l.chain_key) && !l.opened).length,
    from: span[0],
    newBrands,
    topRevenue,
  };
}

/** Открытия с датой по годам и сетям — для столбцов «Открытий за год». */
export function openingsByYear(locs: Loc[], bakery: ReadonlySet<string>, years: number[]): Array<{ year: number; byChain: Map<string, number>; total: number }> {
  return years.map((year) => {
    const byChain = countBy(datedOpenings(locs, bakery, [year, year]), (l) => l.chain_key);
    return { year, byChain, total: [...byChain.values()].reduce((a, n) => a + n, 0) };
  });
}

/** Сравнение периодов по группам: открытий в год раньше и сейчас. */
export type TrendRow = { group: string; early: number; recent: number };
export function trend<T extends Loc>(locs: T[], bakery: ReadonlySet<string>, p: Periods, group: (l: T) => string | null): TrendRow[] {
  const e = countBy(datedOpenings(locs, bakery, p.early), group);
  const r = countBy(datedOpenings(locs, bakery, p.recent), group);
  return [...new Set([...e.keys(), ...r.keys()])]
    .map((g) => ({ group: g, early: perYear(e.get(g) ?? 0, p.earlyMonths), recent: perYear(r.get(g) ?? 0, p.recentMonths) }))
    .sort((a, b) => b.early + b.recent - (a.early + a.recent) || a.group.localeCompare(b.group));
}

/** Событие таймлайна: открытие и закрытие — из реестра, сделка и прочее — из фактов. */
export type EventKind = "entry" | "open" | "close" | "pause" | "planned" | "deal" | "event";
export type MarketEvent = { date: string; year: number; kind: EventKind; chain: string | null; text: string };

export function events(b: Pick<MarketBundle, "chains" | "locations" | "facts">, from: number): MarketEvent[] {
  const bakery = new Set(b.chains.filter((c) => c.is_bakery).map((c) => c.key));
  const firstOf = new Map<string, string>();
  for (const l of [...b.locations].filter((l) => l.opened && l.status !== "planned").sort((a, z) => a.opened!.localeCompare(z.opened!))) {
    if (!firstOf.has(l.chain_key)) firstOf.set(l.chain_key, l.opened!);
  }
  const out: MarketEvent[] = [];
  const push = (date: string | null, kind: EventKind, chain: string | null, text: string) => {
    const year = yearOf(date);
    if (year !== null && year >= from) out.push({ date: date!, year, kind, chain, text });
  };
  for (const l of b.locations) {
    if (bakery.has(l.chain_key)) continue;
    const place = [l.name, l.city].filter(Boolean).join(", ");
    if (l.status === "planned") push(l.opened, "planned", l.chain_key, place);
    else if (l.opened) push(l.opened, firstOf.get(l.chain_key) === l.opened ? "entry" : "open", l.chain_key, place);
    if (l.status === "closed") push(l.closed, "close", l.chain_key, place);
    if (l.status === "paused") push(l.closed, "pause", l.chain_key, place);
  }
  for (const f of b.facts as MarketFact[]) {
    if (f.topic === "deal") push(f.date, "deal", null, f.text);
    else if (f.topic === "timeline") push(f.date, "event", null, f.text);
  }
  return out.sort((a, z) => a.date.localeCompare(z.date));
}

/** Продажи Dodo год к году: последние до трёх полных месяцев против тех же месяцев год назад.
 *  Сравнивается только то, что есть в обоих годах; нет пары — null. */
export function dodoYoY(dodo: MarketBundle["dodo"], now: Date = new Date()): { months: string[]; change: number; units: [number | null, number | null] } | null {
  const full = fullOperatingMonths(dodo, now);
  const by = new Map(full.map((m) => [m.month, m]));
  const prev = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  const months = full.map((m) => m.month).filter((m) => by.has(prev(m))).sort().slice(-3);
  if (!months.length) return null;
  const sum = (ms: string[]) => ms.reduce((s, m) => s + by.get(m)!.revenue_eur!, 0);
  const cur = sum(months), before = sum(months.map(prev));
  if (!before) return null;
  const last = by.get(months.at(-1)!)!, lastPrev = by.get(prev(months.at(-1)!))!;
  return { months, change: Math.round(((cur - before) / before) * 1000) / 10, units: [lastPrev.units, last.units] };
}

/** Доля открытий в одном городе за период, %. */
export function cityShare(locs: Loc[], bakery: ReadonlySet<string>, span: [number, number], city: string): number | null {
  const o = datedOpenings(locs, bakery, span);
  return o.length ? Math.round((o.filter((l) => l.city === city).length / o.length) * 100) : null;
}

/** Сети по числу открытий за период, по убыванию. */
export const openingsByChain = (locs: Loc[], bakery: ReadonlySet<string>, span: [number, number]) =>
  countBy(datedOpenings(locs, bakery, span), (l) => l.chain_key);

/** Города, где у сети сейчас работают точки, по убыванию. */
/** Ключ города без диакритики и регистра: «București» и «Bucuresti» — один город. */
export const cityKey = (c: string) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/** Города сети по числу работающих точек; написания одного города склеены, имя — самое частое. */
export function chainCities(locs: Loc[], chain: string, year: number): string[] {
  const by = new Map<string, Map<string, number>>();
  for (const l of locs) {
    if (l.chain_key !== chain || !l.city || aliveAtYearEnd([l], year, year) !== 1) continue;
    const k = cityKey(l.city);
    const spell = by.get(k) ?? new Map<string, number>();
    spell.set(l.city, (spell.get(l.city) ?? 0) + 1);
    by.set(k, spell);
  }
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  return [...by.values()].sort((a, b) => total(b) - total(a)).map((m) => [...m].sort((a, b) => b[1] - a[1])[0][0]);
}

/** Доля работающих точек (без пекарен) с известной датой открытия, % — мерило, можно ли
 *  верить темпу и географии открытий. */
export function datedShare(locs: Loc[], bakery: ReadonlySet<string>, year: number): number {
  const alive = locs.filter((l) => !bakery.has(l.chain_key) && aliveAtYearEnd([l], year, year) === 1);
  return alive.length ? Math.round((alive.filter((l) => yearOf(l.opened) !== null).length / alive.length) * 100) : 0;
}

/** Формат точки по тексту источника и названию — четыре корзины эталона (trends.py коллеги):
 *  drive-thru, трасса (A1/A3/A4, «odmorište»), ТЦ (mall, centar, retail, park, food court…),
 *  иначе стрит. Нет ни формата, ни признака в названии — null. */
export type FormatClass = "street" | "mall" | "drive" | "highway";
export function formatClass(format: string | null, name = ""): FormatClass | null {
  const t = ` ${format ?? ""} ${name}`.toLowerCase();
  if (/drive/.test(t)) return "drive";
  if (/highway|motorway| a1\b| a3\b| a4\b|odmorište|autocesta/.test(t)) return "highway";
  if (/mall|centar|center|retail|park|food court|supernova|\bjoy\b|cross|shopping|interspar|hypermarket/.test(t)) return "mall";
  return format ? "street" : null;
}

/** Сети без единой работающей точки убираются отовсюду (правило эталона): с карты, из
 *  таймлайна, чипов и реестра. Анонс считается — сеть, которая только заходит, видна. */
export function dropDeadChains<B extends Pick<MarketBundle, "chains" | "locations">>(b: B): B {
  const live = new Set(b.locations.filter((l) => l.status !== "closed").map((l) => l.chain_key));
  return { ...b, chains: b.chains.filter((c) => live.has(c.key)), locations: b.locations.filter((l) => live.has(l.chain_key)) };
}

/** Месяцы продаж Dodo, пригодные для сравнения: только полные месяцы работы. Месяц без
 *  выручки — пиццерии не работали (пауза или ещё не открыты); первый месяц после такого —
 *  месяц открытия, он неполный. Текущий месяц ещё идёт — не берётся никогда.
 *  Флаг `complete` сюда не относится: он о том, собраны ли заказы за каждый день, а выручка
 *  приходит отдельно и только за прошедший месяц целиком — иначе вся история выручки,
 *  у которой нет дневных заказов, выпала бы. */
export function fullOperatingMonths(dodo: MarketBundle["dodo"], now: Date = new Date()): MarketBundle["dodo"] {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sorted = [...dodo].sort((a, b) => a.month.localeCompare(b.month));
  const nextMonth = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  };
  const working = (m: MarketBundle["dodo"][number] | undefined) => !!m && m.revenue_eur !== null && m.revenue_eur > 0;
  return sorted.filter((m, i) => {
    if (m.month >= current || !working(m)) return false;
    const prev = sorted[i - 1];
    return working(prev) && nextMonth(prev!.month) === m.month;
  });
}

/** Среднегодовой рост между первым и последним годом с выручкой, %. Один год или старт с нуля — null. */
// База роста меньше десятой доли последнего года — это разгон новой сети (Dodo с одной
// пиццерией в первый год), а не рост: такой год пропускаем, иначе выходят тысячи процентов.
const CAGR_MIN_BASE_SHARE = 0.1;
export function cagr(series: Array<[number, number | null]>): number | null {
  const all = series.filter((p): p is [number, number] => p[1] !== null && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const end = all.at(-1)?.[1] ?? 0;
  const v = all.filter((p) => p[1] >= end * CAGR_MIN_BASE_SHARE);
  if (v.length < 2) return null;
  const [[y0, a], [y1, b]] = [v[0], v.at(-1)!];
  return Math.round((Math.pow(b / a, 1 / (y1 - y0)) - 1) * 100);
}

// ── Тексты фактов. Факты — сырые строки ресерча на английском: «revenue €2479392»,
// «EUR 32.0m / 39.2m», «14,351 firms». На экране — те же цифры в принятом виде.
const MULT: Record<string, number> = { bn: 1e9, m: 1e6, M: 1e6, k: 1e3 };
// До 100 тыс. — точная сумма («€1 161/month»): округление до тысяч здесь врёт.
const exactOrShort = (v: number, ru: boolean) =>
  v >= 1e5 ? fmtMoney(v, ru) : `€${Number.isInteger(v) ? v.toLocaleString(ru ? "ru-RU" : "en-US").replace(/\u00a0/g, " ") : ru ? String(v).replace(".", ",") : v}`;
export function prettyFigures(s: string, ru: boolean): string {
  let out = s.replace(/(?:EUR|€)\s?(~)?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(bn|m|M|k)?\b/g, (_, t: string | undefined, n: string, u: string | undefined) =>
    `${t ?? ""}${exactOrShort(Number(n.replace(/,/g, "")) * (u ? MULT[u] : 1), ru)}`
  );
  if (!ru) return out;
  out = out.replace(/\b(\d+(?:\.\d+)?)(bn|m)\b/g, (_, n: string, u: string) => `${n} ${u === "bn" ? "млрд" : "млн"}`);
  return out.replace(/(\d),(\d{3})(?!\d)/g, "$1 $2").replace(/(\d)\.(\d)/g, "$1,$2");
}

/** Карточка факта: заголовок — первая цифра факта, остальное — мелким текстом. */
export type FactCard = { head: string; more: string | null; text: string; date: string | null; source: string | null };
const EMPTY_VALUE = /^(n\/a|not found|no count|none)/i;
const MAX_HEAD = 34;
const MAX_PARTS = 4;
const RANKING = /^\d{1,2}\s+\p{Lu}/u;
const FACT_MAX_AGE_YEARS = 3;
export function factCards(facts: MarketFact[], now: Date, ru: boolean): FactCard[] {
  const seen = new Set<string>();
  const out: FactCard[] = [];
  const fresh = facts
    .filter((f) => f.value && !EMPTY_VALUE.test(f.value.trim()))
    .filter((f) => (yearOfAny(f.date) ?? 0) >= now.getFullYear() - FACT_MAX_AGE_YEARS)
    .sort((a, b) => (yearOfAny(b.date) ?? 0) - (yearOfAny(a.date) ?? 0) || (b.date ?? "").localeCompare(a.date ?? ""));
  for (const f of fresh) {
    // Ряд одного показателя («Domino's Pizza: H1 2024 / H1 2025 / H1 2026») — только свежий.
    const series = f.text.split(":")[0].replace(/[\d.,]+/g, "").trim().toLowerCase();
    if (seen.has(series)) continue;
    // Части факта разделены «;» или «, »: «revenue €2479392, stores 7, LFL 7.8%».
    const [head, ...rest] = f.value!.split(/;\s*|,\s+/).map((x) => x.trim()).filter(Boolean);
    // Рейтинг из пяти и больше мест — список, а не цифра: в карточку не помещается.
    if (!head || head.length > MAX_HEAD || rest.length >= MAX_PARTS || RANKING.test(head)) continue;
    seen.add(series);
    out.push({ head: prettyFigures(head, ru), more: rest.length ? prettyFigures(rest.join("; "), ru) : null, text: f.text, date: f.date, source: f.source });
  }
  return out;
}
const yearOfAny = (s: string | null) => {
  const m = s?.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

/** Примечание сети для людей: без служебных пометок проверки и путей к файлам. */
const INTERNAL_NOTE = /\bAUDIT\b|\bNB\b|\.json\b|\bdata\/|CAUTION|Added in audit|_verify|wrongly|Coordinates|ESTIMATE by/i;
const MAX_NOTE = 140;
export function userNote(s: string | null): string | null {
  if (!s) return null;
  const kept = s.split(/(?<=[.!?])\s+/).filter((x) => !INTERNAL_NOTE.test(x)).join(" ").trim();
  if (!kept) return null;
  return kept.length > MAX_NOTE ? `${kept.slice(0, MAX_NOTE).trimEnd()}…` : kept;
}
