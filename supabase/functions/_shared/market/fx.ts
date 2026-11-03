// Курсы к евро от национальных банков для валют, которых нет у ЕЦБ (решение владельца, issue #1115).
// Единственный модуль курсов: им пользуются и сборщик Dodo (scripts/market), и ручной ввод (manual.ts).
// Банки, кроме ЦБ РФ, котируют евро в своей валюте, поэтому курс — это просто курс EUR, «единиц валюты за 1 €»,
// в тех же единицах, что у ЕЦБ; кросса через доллар нет.
//
// GEL и KGS — кросс через рубль по курсам ЦБ РФ: nbg.gov.ge за защитой от ботов, nbkr.kg не даёт архива по дате.
// Курс не получен — запись отказывает с причиной, а не пишет пустой евро.

export type FxRate = {
  /** единиц валюты за 1 € */
  rate: number;
  /** «НБРБ» и т. п. — попадает в источник записи */
  bank: string;
  /** по скольким дням усреднено */
  days: number;
  /** период, для которого взят курс: «2026-09», «2025» или «2026-09-15» */
  period: string;
};

export type FxGet = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<string>;

export class FxError extends Error {}

type DayRate = { date: string; rate: number };

type Bank = {
  name: string;
  /** курсы за все дни окна одним запросом (диапазонный API) — иначе undefined и берутся дневные */
  range?: (get: FxGet, from: string, to: string) => Promise<DayRate[]>;
  /** курс на один день */
  day?: (get: FxGet, date: string) => Promise<number>;
};

const ROUND = 10_000;
const round4 = (n: number) => Math.round(n * ROUND) / ROUND;
const POOL = 8;
/** Дневные банки: меньше половины ответивших дней — не курс, а случайность. */
const MIN_SHARE = 0.5;
/** Выходные и праздники: на не опубликованный день берём последний опубликованный курс до него. */
const LOOKBACK_DAYS = 7;

// ── Разборщики ответов банков (чистые, на них тесты) ────────────────────────

const positive = (n: number, what: string): number => {
  if (!Number.isFinite(n) || n <= 0) throw new FxError(`${what}: курс не число`);
  return n;
};

/** НБРБ api.nbrb.by/exrates/rates/dynamics/451 — ряд по дням, BYN за 1 EUR (масштаб EUR = 1). */
export function parseNbrbDynamics(body: string): DayRate[] {
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    throw new FxError("НБРБ: ответ не JSON");
  }
  if (!Array.isArray(j)) throw new FxError("НБРБ: ожидался массив курсов");
  return j.map((r: { Date?: string; Cur_OfficialRate?: number }) => ({
    date: String(r?.Date ?? "").slice(0, 10),
    rate: positive(Number(r?.Cur_OfficialRate), "НБРБ"),
  }));
}

/** Курс валюты `code` (по умолчанию EUR) из XML <Valute>: НБМ, НБТ, ЦБАР, ЦБ РФ (CharCode/Nominal/Value, десятичная запятая).
 *  Возвращает цену одной единицы: Value / Nominal (у KGS в ЦБ РФ Nominal = 100). */
export function parseValuteXml(xml: string, bank: string, code = "EUR"): number {
  const blocks = xml.match(/<Valute\b[\s\S]*?<\/Valute>/g) ?? [];
  const hit = blocks.find((b) =>
    new RegExp(`<CharCode>\\s*${code}\\s*</CharCode>`).test(b) || new RegExp(`<Valute[^>]*\\bCode="${code}"`).test(b)
  );
  if (!hit) throw new FxError(`${bank}: в ответе нет ${code}`);
  const value = /<Value>\s*([\d.,\s]+?)\s*<\/Value>/.exec(hit)?.[1];
  const nominal = /<Nominal>\s*(\d+)[^<]*<\/Nominal>/.exec(hit)?.[1] ?? "1";
  if (!value) throw new FxError(`${bank}: у ${code} нет значения курса`);
  return positive(Number(value.replace(/\s/g, "").replace(",", ".")), bank) / positive(Number(nominal), bank);
}

/** Кросс через рубль по одному дню ЦБ РФ: (EUR/RUB) / (CUR/RUB) — единиц валюты за 1 €. */
export function parseCbrCross(xml: string, currency: string): number {
  const eur = parseValuteXml(xml, "ЦБ РФ", "EUR");
  const cur = parseValuteXml(xml, "ЦБ РФ", currency);
  return round4(eur / cur);
}

/** ЦБ Армении, SOAP ExchangeRatesByDateRangeByISO: фильтр по ISO сервер игнорирует и отдаёт все валюты — берём строки EUR. */
export function parseCbaRange(xml: string): DayRate[] {
  const rows = xml.match(/<ExchangeRatesByRange\b[\s\S]*?<\/ExchangeRatesByRange>/g) ?? [];
  const out: DayRate[] = [];
  for (const r of rows) {
    if (!/<ISO>EUR<\/ISO>/.test(r)) continue;
    const rate = Number(/<Rate>([\d.]+)<\/Rate>/.exec(r)?.[1]);
    const amount = Number(/<Amount>(\d+)<\/Amount>/.exec(r)?.[1] ?? 1);
    const date = /<RateDate>(\d{4}-\d{2}-\d{2})/.exec(r)?.[1];
    if (!date) throw new FxError("ЦБ Армении: у строки курса нет даты");
    out.push({ date, rate: round4(positive(rate, "ЦБ Армении") / positive(amount, "ЦБ Армении")) });
  }
  if (!out.length) throw new FxError("ЦБ Армении: в ответе нет курсов евро");
  return out;
}

// ── Банки ───────────────────────────────────────────────────────────────────

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** НБГ закрыт защитой от ботов, НБКР не даёт архив по дате: берём ЦБ РФ, кросс через рубль (решение владельца, #1115). */
const cbrBank = (cur: string): Bank => ({
  name: `ЦБ РФ, кросс EUR/RUB и ${cur}/RUB`,
  day: async (get, date) =>
    parseCbrCross(
      await get(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${dmy(date).replaceAll(".", "/")}`),
      cur,
    ),
});

const BANKS: Record<string, Bank> = {
  BYN: {
    name: "НБРБ",
    range: async (get, from, to) =>
      parseNbrbDynamics(await get(`https://api.nbrb.by/exrates/rates/dynamics/451?startdate=${from}&enddate=${to}`)),
  },
  MDL: {
    name: "НБМ",
    day: async (get, date) =>
      parseValuteXml(await get(`https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${dmy(date)}`), "НБМ"),
  },
  AZN: {
    name: "ЦБАР",
    day: async (get, date) => parseValuteXml(await get(`https://www.cbar.az/currencies/${dmy(date)}.xml`), "ЦБАР"),
  },
  TJS: {
    name: "НБТ",
    day: async (get, date) =>
      parseValuteXml(await get(`https://nbt.tj/en/kurs/export_xml.php?date=${date}&export=xmlout`), "НБТ"),
  },
  GEL: cbrBank("GEL"),
  KGS: cbrBank("KGS"),
  AMD: {
    name: "ЦБ Армении",
    range: async (get, from, to) =>
      parseCbaRange(
        await get("https://api.cba.am/exchangerates.asmx", {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: '"http://www.cba.am/ExchangeRatesByDateRangeByISO"',
          },
          body:
            `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
            `<soap:Body><ExchangeRatesByDateRangeByISO xmlns="http://www.cba.am/"><ISO>EUR</ISO>` +
            `<DateFrom>${from}T00:00:00</DateFrom><DateTo>${to}T00:00:00</DateTo>` +
            `</ExchangeRatesByDateRangeByISO></soap:Body></soap:Envelope>`,
        }),
      ),
  },
};

/** Валюты, по которым есть национальный банк. */
export const FX_CURRENCIES: readonly string[] = Object.keys(BANKS);

/** Сообщение об отказе для валюты без источника курса. */
export function fxUnsupportedReason(currency: string): string {
  return `${currency.toUpperCase()}: курса национального банка нет в Swarm — переведи в EUR сам и укажи курс в note`;
}

// ── Даты и усреднение ───────────────────────────────────────────────────────

const PERIOD = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Даты периода, не позже today: месяц — все дни, год — 1, 8, 15 и 22 число каждого месяца (240 дневных запросов в год — много), день — он сам. */
export function periodDates(period: string, today: string, sampleYear = true): string[] {
  const m = PERIOD.exec(period);
  if (!m) throw new FxError(`период «${period}»: ожидался ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД`);
  const y = Number(m[1]);
  if (m[3]) return [period];
  const months = m[2] ? [Number(m[2])] : Array.from({ length: 12 }, (_, i) => i + 1);
  const out: string[] = [];
  for (const mo of months) {
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const days = m[2] || !sampleYear ? Array.from({ length: last }, (_, i) => i + 1) : [1, 8, 15, 22];
    for (const d of days) out.push(iso(new Date(Date.UTC(y, mo - 1, d))));
  }
  return out.filter((d) => d <= today);
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export const defaultGet: FxGet = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new FxError(`${url}: HTTP ${res.status}`);
  return await res.text();
};

const average = (xs: number[]) => round4(xs.reduce((s, x) => s + x, 0) / xs.length);

/** Курс «единиц валюты за 1 €» от национального банка: месяц/год — среднее дневных официальных курсов,
 *  день — курс на эту дату (нет публикации — последний до неё, до недели назад). Не получили — FxError с причиной. */
export async function fxRate(
  currency: string,
  period: string,
  get: FxGet = defaultGet,
  today: string = iso(new Date()),
): Promise<FxRate> {
  const cur = currency.toUpperCase();
  const bank = BANKS[cur];
  if (!bank) throw new FxError(fxUnsupportedReason(cur));
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(period);
  const dates = periodDates(period, today, !bank.range);
  if (!dates.length) throw new FxError(`${bank.name}: период ${period} ещё не начался`);
  const first = dates[0], last = dates[dates.length - 1];
  const from = isDay ? iso(new Date(Date.parse(`${first}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000)) : first;

  let rates: DayRate[];
  try {
    if (bank.range) {
      rates = await bank.range(get, from, last);
    } else {
      const wanted = isDay
        ? Array.from(
          { length: LOOKBACK_DAYS + 1 },
          (_, i) => iso(new Date(Date.parse(`${first}T00:00:00Z`) - i * 86_400_000)),
        )
        : dates;
      if (isDay) {
        // Последний опубликованный: идём от даты назад, пока банк не ответит.
        for (const d of wanted) {
          try {
            return { rate: round4(await bank.day!(get, d)), bank: bank.name, days: 1, period };
          } catch { /* день без публикации — пробуем предыдущий */ }
        }
        throw new FxError(`${bank.name}: курса на ${first} и за неделю до него нет`);
      }
      const settled = await pool(wanted, POOL, (d) => bank.day!(get, d));
      rates = settled.flatMap((s, i) => s.status === "fulfilled" ? [{ date: wanted[i], rate: s.value }] : []);
      if (rates.length < wanted.length * MIN_SHARE) {
        const why = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
        throw new FxError(
          `${bank.name}: курс получен за ${rates.length} из ${wanted.length} дней (${why?.reason ?? "нет ответа"})`,
        );
      }
    }
  } catch (e) {
    if (e instanceof FxError) throw e;
    throw new FxError(`${bank.name}: курс не получен (${e instanceof Error ? e.message : e})`);
  }

  if (isDay) {
    // Диапазонный банк: последний курс не позже даты.
    const upTo = rates.filter((r) => r.date <= first).sort((a, b) => a.date.localeCompare(b.date));
    const hit = upTo[upTo.length - 1];
    if (!hit) throw new FxError(`${bank.name}: курса на ${first} и за неделю до него нет`);
    return { rate: hit.rate, bank: bank.name, days: 1, period };
  }
  const inPeriod = rates.filter((r) => r.date >= first && r.date <= last);
  if (!inPeriod.length) throw new FxError(`${bank.name}: за ${period} курсов нет`);
  return { rate: average(inPeriod.map((r) => r.rate)), bank: bank.name, days: inPeriod.length, period };
}

/** «1 € = 2.9 BYN, НБРБ, среднее за 2026-09 по 30 дням» — пометка для источника записи. */
export function fxNote(currency: string, r: FxRate): string {
  const how = /^\d{4}-\d{2}-\d{2}$/.test(r.period) ? `на ${r.period}` : `среднее за ${r.period} по ${r.days} дн.`;
  return `курс 1 € = ${r.rate} ${currency.toUpperCase()} (${r.bank}, ${how})`;
}
