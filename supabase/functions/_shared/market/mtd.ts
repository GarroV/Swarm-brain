// Выручка Dodo с 1-го числа текущего месяца по сегодня для главной (решение владельца 05.11.2026:
// «данные берем от начала месяца к текущей дате»). Источник — публичный API Dodo без ключа;
// в евро по дневному курсу (fx.ts). Ошибка или неизвестная валюта у страны → null, ответ не падает.
import { type EcbJson, parseEcbSeries } from "./ecb.ts";
import { FX_CURRENCIES, type FxGet, fxRate } from "./fx.ts";
import { type CurrentMonth, type FinMetrics, parseCurrentMonth } from "./finmetrics.ts";

export type Mtd = {
  /** день, на который посчитано, YYYY-MM-DD (Белград) */
  as_of: string;
  revenue_eur: number;
  /** прошлый месяц целиком, € */
  prev_month_eur: number;
  /** темп: средние сутки полных дней этого месяца против средних суток прошлого, %; null — 1-е число */
  pace_pct: number | null;
};

export const MTD_TTL_MS = 10 * 60_000;
export const MTD_TIMEOUT_MS = 5_000;

const TZ = "Europe/Belgrade";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Сегодняшняя дата по Белграду, YYYY-MM-DD. */
export const belgradeToday = (now: Date = new Date()): string => DAY_FMT.format(now);

const daysInMonth = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const prevMonthOf = (today: string): string => {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Темп к прошлому месяцу, %. Полных дней нет (1-е число) или прошлый месяц пуст — null. */
export function pacePct(
  fullDaysRevenue: number,
  dayOfMonth: number,
  prevRevenue: number,
  prevDays: number,
): number | null {
  const fullDays = dayOfMonth - 1;
  if (fullDays < 1 || prevRevenue <= 0 || prevDays < 1) return null;
  return ((fullDaysRevenue / fullDays) / (prevRevenue / prevDays) - 1) * 100;
}

/**
 * Чистый расчёт: разобранный текущий месяц + курс (единиц валюты за €) + сегодня по Белграду → Mtd.
 * null — Dodo ещё не переключил месяц (прошлый месяц в ответе не тот, что перед сегодняшним).
 */
export function buildMtd(cm: CurrentMonth, rate: number, today: string): Mtd | null {
  if (cm.prevMonth !== prevMonthOf(today) || !(rate > 0)) return null;
  const day = Number(today.slice(8, 10));
  return {
    as_of: today,
    revenue_eur: cm.mtd / rate,
    prev_month_eur: cm.prevRevenue / rate,
    pace_pct: pacePct(cm.fullDays, day, cm.prevRevenue, daysInMonth(cm.prevMonth)),
  };
}

export type MtdDeps = {
  /** GET → JSON; кидает при ошибке и таймауте */
  getJson: (url: string) => Promise<unknown>;
  fxGet?: FxGet;
  now?: () => Date;
};

const defaultGetJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(MTD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.json();
};

const RATE_LOOKBACK_DAYS = 7;
const shiftDay = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** Последний курс не позже today: динар — НБС (у ЕЦБ ряда RSD нет, как и в сборщике), прочие — ЕЦБ. */
async function ecbOrNbsRate(currency: string, today: string, getJson: MtdDeps["getJson"]): Promise<number> {
  const from = shiftDay(today, -RATE_LOOKBACK_DAYS);
  if (currency === "RSD") {
    const j = await getJson(
      `https://kurs.resenje.org/api/v1/currencies/eur/rates/${from}/count/${RATE_LOOKBACK_DAYS + 1}`,
    ) as {
      rates?: Array<{ date: string; exchange_middle: number }>;
    };
    const last = (j.rates ?? []).filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (!last) throw new Error(`RSD: курса НБС на ${today} и за неделю до него нет`);
    return last.exchange_middle;
  }
  const url =
    `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?format=jsondata&startPeriod=${from}&endPeriod=${today}`;
  const series = parseEcbSeries(await getJson(url) as EcbJson);
  const day = Object.keys(series).sort().at(-1);
  if (!day) throw new Error(`${currency}: курса ЕЦБ на ${today} и за неделю до него нет`);
  return series[day];
}

/** Курс «единиц валюты за 1 €» на сегодня: евро — 1, валюты национальных банков — fxRate, остальные — ЕЦБ/НБС. */
async function todayRate(currency: string, today: string, deps: MtdDeps): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;
  if (FX_CURRENCIES.includes(cur)) return (await fxRate(cur, today, deps.fxGet, today)).rate;
  return await ecbOrNbsRate(cur, today, deps.getJson);
}

/** Одна страна: запрос Dodo + курс. Любой сбой → null. */
export async function loadCountryMtd(cc: string, deps: MtdDeps): Promise<Mtd | null> {
  const today = belgradeToday(deps.now?.());
  try {
    const url = `https://publicapi.dodois.io/${cc.toLowerCase()}/api/v1/FinancialMetrics`;
    const cm = parseCurrentMonth(await deps.getJson(url) as FinMetrics);
    if (!cm) return null;
    const rate = await todayRate(cm.currency, today, deps);
    return buildMtd(cm, rate, today);
  } catch (e) {
    console.warn(`[market] mtd ${cc}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

const cache = new Map<string, { at: number; value: Mtd | null }>();

/** Кэш в памяти функции на 10 минут по стране (кэшируется и null: упавшее API не долбим на каждый заход). */
export async function loadMtd(ccs: string[], deps: Partial<MtdDeps> = {}): Promise<Record<string, Mtd | null>> {
  const d: MtdDeps = { getJson: deps.getJson ?? defaultGetJson, fxGet: deps.fxGet, now: deps.now };
  const nowMs = (d.now?.() ?? new Date()).getTime();
  const entries = await Promise.all(ccs.map(async (cc) => {
    const hit = cache.get(cc);
    if (hit && nowMs - hit.at < MTD_TTL_MS) return [cc, hit.value] as const;
    const value = await loadCountryMtd(cc, d);
    cache.set(cc, { at: nowMs, value });
    return [cc, value] as const;
  }));
  return Object.fromEntries(entries);
}

/** Для тестов. */
export const clearMtdCache = () => cache.clear();
