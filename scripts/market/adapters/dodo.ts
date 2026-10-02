// Dodo — истина для своих точек и продаж: publicapi.dodois.io, без ключа (решение 02.10.2026).
import {
  getJson,
  parseCountBySource,
  parseDodoUnits,
  parseEcbSeries,
  parseFinancialMetrics,
} from "../lib.ts";
import type { Adapter } from "./types.ts";

const api = (cc: string, path: string) =>
  `https://publicapi.dodois.io/${cc}/api/v1/${path}`;
const DEFAULT_DAYS = 8;
const ecbMonth = (cur: string, month: string) =>
  `https://data-api.ecb.europa.eu/service/data/EXR/M.${cur}.EUR.SP00.A?format=jsondata&startPeriod=${month}&endPeriod=${month}`;

/** Дни с since по вчера включительно: сегодняшний день ещё не закрыт. */
export function daysBetween(since: string, today: string): string[] {
  const out: string[] = [];
  const d = new Date(`${since}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) < today) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const dodo: Adapter = {
  id: "dodo-publicapi",
  async collect(cfg, opts) {
    const started_at = new Date().toISOString();
    const base = { country: cfg.country, started_at, source: "dodo" as const };
    try {
      const since = opts.since ??
        new Date(
          Date.parse(`${opts.today}T00:00:00Z`) - DEFAULT_DAYS * 86_400_000,
        ).toISOString().slice(0, 10);
      const units = parseDodoUnits(
        await getJson(api(cfg.dodoCode, "unitinfo/all")),
      );
      const days = [];
      for (const date of daysBetween(since, opts.today)) {
        const [y, m, d] = date.split("-");
        const counts = parseCountBySource(
          await getJson(
            api(
              cfg.dodoCode,
              `orders/countBySource/${y}/${Number(m)}/${Number(d)}`,
            ),
          ),
        );
        days.push({ date, counts });
      }
      const revenue = parseFinancialMetrics(
        await getJson(api(cfg.dodoCode, "FinancialMetrics")),
      );
      // Не евро (леи) — месячный курс ЕЦБ; курса ещё нет — евро останется пустым, а не ложным.
      if (revenue && revenue.currency !== "EUR") {
        const rate = parseEcbSeries(
          await getJson(ecbMonth(revenue.currency, revenue.month)),
        )[revenue.month];
        if (rate) revenue.rates = { [revenue.currency]: rate };
      }
      return { ...base, units, days, revenue };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
