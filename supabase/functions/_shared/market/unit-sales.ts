// Выручка пиццерий с 1-го числа текущего месяца для главной («Мои страны», решение владельца 06.11.2026:
// «через децимус давай настроим»). Источник — Децимус GET /api/v1/sales (Dodo IS, сбор раз в сутки);
// публичный API Dodo выручки пиццерии не даёт. Евро — по дневному курсу тем же путём, что mtd.ts.
// Подмен нет: пиццерия без данных, страна без валюты или без курса — не попадают в ответ (у веба «—»),
// а страна, у которой нет данных Децимуса, остаётся с выручкой публичного API (mtd.ts).
import { decimusGet, DecimusNotConfigured } from "../decimus.ts";
import { belgradeToday, type Mtd, todayRate } from "./mtd.ts";

export const UNIT_SALES_TTL_MS = 10 * 60_000;
export const UNIT_SALES_TIMEOUT_MS = 5_000;

export type DecimusSalesUnit = {
  id: string;
  cc: string;
  /** в местной валюте; null — валюта страны неизвестна Децимусу */
  revenue: number | null;
  currency: string | null;
};

export type DecimusSales = {
  /** YYYY-MM */
  month: string;
  units: DecimusSalesUnit[];
  /** страна → момент последней удачной загрузки продаж, ISO UTC */
  loaded: Record<string, string>;
};

/** Выручка в виде, который отдаёт /market/sales; источник у страны — для подписи и отладки. */
export type UnitSales = {
  month: string;
  /** пиццерия (dodo_id, как `id` в /quality) → выручка с 1-го числа, € */
  units: Record<string, number>;
  /** страна → когда загружено, ISO UTC; есть только у стран с данными Децимуса */
  loaded: Record<string, string>;
  /** страна → сумма её пиццерий, € */
  countries: Record<string, number>;
};

export type CountryMtd = Mtd & { source: "decimus" | "dodo_public" };

const cents = (n: number): number => Math.round(n * 100) / 100;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Разбор ответа Децимуса; всё, что не похоже на контракт, — null (а не наполовину верный ответ). */
export function parseDecimusSales(body: unknown): DecimusSales | null {
  if (!isObj(body) || typeof body.month !== "string" || !Array.isArray(body.units) || !isObj(body.loaded)) return null;
  const units: DecimusSalesUnit[] = [];
  for (const u of body.units) {
    if (!isObj(u) || typeof u.id !== "string" || typeof u.cc !== "string") return null;
    const revenue = typeof u.revenue === "number" && Number.isFinite(u.revenue) ? u.revenue : null;
    const currency = typeof u.currency === "string" && u.currency ? u.currency.toUpperCase() : null;
    units.push({ id: u.id.toLowerCase(), cc: u.cc.toUpperCase(), revenue, currency });
  }
  const loaded: Record<string, string> = {};
  for (const [cc, at] of Object.entries(body.loaded)) if (typeof at === "string") loaded[cc.toUpperCase()] = at;
  return { month: body.month, units, loaded };
}

/**
 * Чистый расчёт: ответ Децимуса + курсы (единиц валюты за € по коду валюты) → выручка в евро.
 * Страна попадает в результат целиком или не попадает: нет удачной загрузки, нет валюты или курса у любой её
 * пиццерии — вся страна пропущена (частичная сумма была бы ложной цифрой страны).
 */
export function buildUnitSales(sales: DecimusSales, rates: Record<string, number>): UnitSales {
  const byCountry = new Map<string, DecimusSalesUnit[]>();
  for (const u of sales.units) byCountry.set(u.cc, [...(byCountry.get(u.cc) ?? []), u]);
  const out: UnitSales = { month: sales.month, units: {}, loaded: {}, countries: {} };
  for (const [cc, units] of byCountry) {
    const loaded = sales.loaded[cc];
    const eur = units.map((u) => {
      const rate = u.currency ? rates[u.currency] : undefined;
      return u.revenue != null && rate != null && rate > 0 ? u.revenue / rate : null;
    });
    if (!loaded || eur.some((v) => v == null)) continue;
    units.forEach((u, i) => (out.units[u.id] = cents(eur[i] as number)));
    out.loaded[cc] = loaded;
    out.countries[cc] = cents(eur.reduce<number>((s, v) => s + (v as number), 0));
  }
  return out;
}

/**
 * Выручка страны для строки таблицы: сумма её пиццерий из Децимуса, если она есть, иначе публичный API (как было).
 * День «на который посчитано» у суммы Децимуса — день его загрузки по Белграду.
 */
export function mergeCountryMtd(
  publicMtd: Record<string, Mtd | null>,
  unitSales: UnitSales | null,
): Record<string, CountryMtd | null> {
  const out: Record<string, CountryMtd | null> = {};
  for (const [cc, pub] of Object.entries(publicMtd)) {
    const own = unitSales?.countries[cc];
    const at = unitSales?.loaded[cc];
    out[cc] = own != null && at
      ? { as_of: belgradeToday(new Date(at)), revenue_eur: own, source: "decimus" }
      : pub
      ? { ...pub, source: "dodo_public" }
      : null;
  }
  return out;
}

export type UnitSalesDeps = {
  /** GET /api/v1/sales; кидает при ошибке и таймауте */
  getSales: (ccs: string[], month: string) => Promise<unknown>;
  /** единиц валюты за € на сегодня; кидает, если курса нет */
  rateOf: (currency: string, today: string) => Promise<number>;
  now?: () => Date;
};

const defaultGetJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(UNIT_SALES_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.json();
};

const defaultDeps: UnitSalesDeps = {
  getSales: (ccs, month) => decimusGet("/api/v1/sales", { countries: ccs.join(","), month }, UNIT_SALES_TIMEOUT_MS),
  rateOf: (currency, today) => todayRate(currency, today, { getJson: defaultGetJson }),
};

async function fetchUnitSales(ccs: string[], deps: UnitSalesDeps): Promise<UnitSales | null> {
  const today = belgradeToday(deps.now?.());
  try {
    const parsed = parseDecimusSales(await deps.getSales(ccs, today.slice(0, 7)));
    if (!parsed) {
      console.warn("[market] unit-sales: unexpected Decimus response");
      return null;
    }
    const currencies = [...new Set(parsed.units.map((u) => u.currency).filter((c): c is string => !!c))];
    const rates: Record<string, number> = {};
    await Promise.all(currencies.map(async (cur) => {
      try {
        rates[cur] = await deps.rateOf(cur, today);
      } catch (e) {
        console.warn(`[market] unit-sales rate ${cur}:`, e instanceof Error ? e.message : e);
      }
    }));
    return buildUnitSales(parsed, rates);
  } catch (e) {
    if (e instanceof DecimusNotConfigured) console.warn("[market] unit-sales:", e.message);
    else console.warn("[market] unit-sales:", e instanceof Error ? e.message : e);
    return null;
  }
}

const cache = new Map<string, { at: number; value: UnitSales | null }>();

/**
 * Выручка пиццерий выбранных стран из Децимуса. Кэш в памяти функции на 10 минут (кэшируется и null:
 * упавший Децимус не долбим на каждый заход главной). Не настроен или ошибка → null: у пиццерий «—»,
 * у страны остаётся публичный API.
 */
export async function loadUnitSales(ccs: string[], deps: Partial<UnitSalesDeps> = {}): Promise<UnitSales | null> {
  if (!ccs.length) return null;
  const d: UnitSalesDeps = { ...defaultDeps, ...deps };
  const today = belgradeToday(d.now?.());
  const key = `${today.slice(0, 7)}|${[...ccs].sort().join(",")}`;
  const nowMs = (d.now?.() ?? new Date()).getTime();
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < UNIT_SALES_TTL_MS) return hit.value;
  const value = await fetchUnitSales(ccs, d);
  cache.set(key, { at: nowMs, value });
  return value;
}

/** Для тестов. */
export const clearUnitSalesCache = () => cache.clear();
