// Разбор снимка страны для «Анализа рынка». Снимок заливает РУЧНЫЕ источники — то, что кодом
// пока не собирается (финансы из Fina, точки локальных сетей без локатора, факты рынка, цены).
// Формат — данные хорватского анализа как есть (короткие ключи точек c/n/a/p/o/est/s/cl/f/src/v/vn).
// Не берём: производные ключи файла (paths/proj/trends/W/H — экран считает их сам). Внутренние
// выгрузки Dodo (продажи по месяцам из отчёта Sales, заказы по каналам из Dodo IS) приходят
// ручными блоками editorial.dodo_monthly / dodo_ops — у сборщика publicapi их нет.
// Битый снимок отклоняется целиком с перечнем причин: частичный импорт оставил бы страну в
// состоянии, которого не было ни в одном источнике.
import {
  type ChainHist,
  LOC_STATUSES,
  type LocStatus,
  type SnapChain,
  type SnapCompany,
  type SnapFact,
  type SnapFinYear,
  type SnapLocation,
  type SnapPrice,
  type Snapshot,
  type Verification,
  VERIFICATIONS,
} from "./types.ts";
import { parseEditorial } from "./editorial.ts";

type R = Record<string, unknown>;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);
const verif = (v: unknown): Verification =>
  VERIFICATIONS.includes(v as Verification) ? (v as Verification) : "unverified";
const YEAR_ONLY = /^\d{4}$/;

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] };

function parseChains(raw: unknown, errors: string[]): SnapChain[] {
  const chains = arr(raw).map((c): SnapChain => ({
    key: str(c.key) ?? "",
    name: str(c.name) ?? "",
    slot: num(c.slot) ?? 0,
    segment: str(c.segment) ?? "other",
    bakery: c.bakery === true,
    origin: str(c.origin),
    operator: str(c.operator),
    first_entry: str(c.first_entry),
    notes: str(c.notes),
    hist: arr(c.hist).flatMap((h): ChainHist[] => {
      const year = num(h.year), count = num(h.count);
      return year !== null && count !== null ? [{ year, count, source: str(h.source) }] : [];
    }),
  }));
  const declared = new Set<string>();
  chains.forEach((c, i) => {
    if (!c.key || !c.name) errors.push(`chains[${i}]: нужны key и name`);
    else if (declared.has(c.key)) errors.push(`chains[${i}]: ключ «${c.key}» уже объявлен`);
    declared.add(c.key);
  });
  return chains;
}

function parseLocations(raw: unknown, keys: Set<string>, errors: string[]): SnapLocation[] {
  return arr(raw).map((l, i): SnapLocation => {
    const c = str(l.c);
    if (!c || !keys.has(c)) errors.push(`locs[${i}]: сеть «${c}» не объявлена в chains`);
    const lat = num(l.lat), lng = num(l.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      errors.push(`locs[${i}]: координаты вне диапазона`);
    }
    if (!LOC_STATUSES.includes(l.s as LocStatus)) errors.push(`locs[${i}]: статус «${l.s}» неизвестен`);
    if (l.v != null && !VERIFICATIONS.includes(l.v as Verification)) {
      errors.push(`locs[${i}]: статус проверки «${l.v}» неизвестен`);
    }
    return {
      chain: c ?? "",
      name: str(l.n) ?? "",
      city: str(l.city),
      address: str(l.a),
      lat: lat ?? 0,
      lng: lng ?? 0,
      placement: str(l.p),
      opened: str(l.o) ?? str(l.oy),
      opened_estimated: l.est === true,
      status: (l.s as LocStatus) ?? "open",
      closed: str(l.cl) ?? str(l.cy),
      format: str(l.f),
      source: str(l.src),
      verification: verif(l.v),
      verification_note: str(l.vn),
    };
  });
}

function parseYears(raw: unknown): SnapFinYear[] {
  return arr(raw).filter((y) => num(y.year) !== null).map((y) => ({
    year: num(y.year)!,
    revenue_eur: num(y.revenue_eur),
    net_profit_eur: num(y.net_profit_eur),
    employees: num(y.employees),
    source: str(y.source),
    verification: verif(y.v),
    // Все пометки записи: по ним экран ставит звёздочку «пересчитано» (DERIVED / «~»), как эталон.
    note: [...new Set([str(y.note), str(y.revenue_note), str(y.v_note)].filter((x): x is string => x !== null))].join(
      " · ",
    ) || null,
  }));
}

/** fin.companies + годовые периоды pizzafin (сливаются по рег. номеру); полугодия — в факты. */
function parseCompanies(B: R, chainKey: (v: unknown) => string | null, facts: SnapFact[]): SnapCompany[] {
  const fin = (B.fin ?? {}) as R;
  const companies: SnapCompany[] = arr(fin.companies).map((co) => ({
    chain: chainKey(co.chain),
    name: str(co.company) ?? str(co.name) ?? "",
    reg_id: str(co.oib) ?? str(co.reg_id),
    owner: str(co.owner),
    notes: str(co.notes),
    years: parseYears(co.years),
  }));
  const pf = (B.pizzafin ?? {}) as R;
  for (const pc of arr(pf.chains)) {
    const reg = str(pc.oib);
    let co = companies.find((c) => reg && c.reg_id === reg);
    if (!co) {
      co = {
        chain: chainKey(pc.chain),
        name: str(pc.company) ?? "",
        reg_id: reg,
        owner: null,
        notes: str(pc.notes),
        years: [],
      };
      companies.push(co);
    }
    for (const p of arr(pc.periods)) {
      const period = str(p.period) ?? "";
      if (YEAR_ONLY.test(period)) {
        const year = Number(period);
        if (!co.years.some((y) => y.year === year)) {
          co.years.push({
            year,
            revenue_eur: num(p.revenue_eur),
            net_profit_eur: num(p.net_profit_eur),
            employees: num(p.employees),
            source: str(p.source),
            verification: verif(p.v ?? "confirmed"),
            note: str(p.note),
          });
        }
      } else if (period) {
        const parts = [
          num(p.revenue_eur) !== null ? `revenue €${p.revenue_eur}` : null,
          num(p.system_sales_eur) !== null ? `system sales €${p.system_sales_eur}` : null,
          num(p.stores_end) !== null ? `stores ${p.stores_end}` : null,
          num(p.lfl_pct) !== null ? `LFL ${p.lfl_pct}%` : null,
        ].filter(Boolean);
        facts.push({
          topic: "market",
          date: period,
          text: `${str(pc.chain) ?? co.name}: ${period}`,
          value: parts.join(", ") || null,
          source: str(p.source),
        });
      }
    }
    co.years.sort((a, b) => a.year - b.year);
  }
  for (const c of arr(pf.commentary)) {
    const t = str(c.quote_or_fact);
    if (t) {
      facts.push({
        topic: "commentary",
        date: null,
        text: `${str(c.chain) ?? ""}: ${t}`,
        value: null,
        source: str(c.source),
      });
    }
  }
  // «Subway — not identified», «Starbucks — n/a»: заглушки без отчётности и рег. номера
  // данных не несут (что сети нет на рынке — это факт, а не юрлицо).
  return companies.filter((c) => c.years.length > 0 || c.reg_id);
}

/** Ключ уникальности mkt_prices: две строки с одним ключом Postgres отвергает целиком
 *  («cannot affect row a second time») — уже после записи сетей и точек. */
const priceKey = (p: SnapPrice) => [p.chain, p.item, p.size_cm, p.channel, p.seen_on].join("|");

function parsePrices(B: R, chainKey: (v: unknown) => string | null): SnapPrice[] {
  const P = (B.prices ?? {}) as R;
  const rows = arr(P.items).flatMap((p): SnapPrice[] => {
    const c = chainKey(p.chain), price = num(p.price_eur);
    if (!c || price === null) return [];
    return [{
      chain: c,
      item: str(p.pizza) ?? str(p.item) ?? "",
      item_type: str(p.pizza_type),
      size_cm: num(p.cm),
      price_eur: price,
      channel: str(p.channel),
      source: str(p.source),
      seen_on: str(P.seen),
    }];
  });
  return [...new Map(rows.map((p) => [priceKey(p), p])).values()];
}

function parseFacts(B: R): SnapFact[] {
  const fin = (B.fin ?? {}) as R, D = (B.delivery ?? {}) as R;
  const insights = Array.isArray(D.insights) ? (D.insights as unknown[]) : [];
  return [
    ...arr(fin.market).map((f): SnapFact => ({
      topic: "market",
      date: str(f.year),
      text: str(f.fact) ?? "",
      value: str(f.value),
      source: str(f.source),
    })),
    ...arr(fin.deals).map((f): SnapFact => ({
      topic: "deal",
      date: str(f.date),
      text: str(f.description) ?? "",
      value: null,
      source: str(f.source),
    })),
    ...arr(D.facts).map((f): SnapFact => ({
      topic: "delivery",
      date: str(f.year),
      text: str(f.fact) ?? "",
      value: str(f.value),
      source: str(f.source),
    })),
    ...arr(D.timeline).map((f): SnapFact => ({
      topic: "timeline",
      date: str(f.date),
      text: str(f.event) ?? "",
      value: null,
      source: str(f.source),
    })),
    ...insights.flatMap((t): SnapFact[] =>
      str(t) ? [{ topic: "insight", date: null, text: str(t)!, value: null, source: null }] : []
    ),
  ];
}

export function validateSnapshot(raw: unknown): SnapshotResult {
  const errors: string[] = [];
  const B = (raw ?? {}) as R;
  if (!Array.isArray(B.chains) || B.chains.length === 0) {
    return { ok: false, errors: ["chains: обязателен непустой массив"] };
  }
  const chains = parseChains(B.chains, errors);
  const keys = new Set(chains.map((c) => c.key));
  const byName = new Map(chains.map((c) => [c.name.toLowerCase(), c.key]));
  const chainKey = (v: unknown): string | null => {
    const s = str(v);
    if (!s) return null;
    if (keys.has(s)) return s;
    // В финансах сеть подписана свободно: «Domino's Pizza», «Mlinar (bakery-café chain…)»,
    // «Leggiero (cafe/bar chain)» против «Leggiero / Leggiero Food» в chains. Сравниваем без
    // пояснения в скобках и по началу строки в обе стороны.
    const lower = s.replace(/\s*\(.*$/, "").trim().toLowerCase();
    return byName.get(lower) ??
      chains.find((c) => {
        const n = c.name.toLowerCase();
        return lower.startsWith(n) || n.startsWith(lower);
      })?.key ?? null;
  };
  const locations = parseLocations(B.locs, keys, errors);
  const facts = parseFacts(B);
  const companies = parseCompanies(B, chainKey, facts);
  const prices = parsePrices(B, chainKey);
  const editorial = parseEditorial(B.editorial, errors);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, snapshot: { chains, locations, companies, prices, facts, dodo: [], editorial } };
}
