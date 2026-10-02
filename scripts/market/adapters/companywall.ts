// CompanyWall (companywall.rs, .si, .me…): страница юрлица с итогами из государственного реестра
// (в Сербии — APR, где отчётность закрыта капчей; в Словении — AJPES; в Черногории — налоговая). Только страницы юрлиц (/firma/, в .si — /podjetje/), разрешённые robots.txt;
// поиск по сайту robots запрещает, поэтому ссылка на каждую фирму записана в конфиге (companies.url).
import { getJson, httpGet, parseEcbAnnual, parseNbsAverage } from "../lib.ts";
import { parseCompanyWall } from "../registry.ts";
import type { Adapter } from "./types.ts";

const nbsYear = (y: number) =>
  `https://kurs.resenje.org/api/v1/currencies/eur/rates/${y}-01-01/count/366`;
const ECB = (cur: string) =>
  `https://data-api.ecb.europa.eu/service/data/EXR/A.${cur}.EUR.SP00.A?format=jsondata&startPeriod=2015`;

/** Годовой курс «единиц валюты за 1 €»: евро — 1, динар — средний НБС, прочее — ЕЦБ. */
async function yearRates(
  currency: string,
  years: number[],
): Promise<(y: number) => number | null> {
  if (currency === "EUR") return () => 1;
  if (currency === "RSD") {
    const map = new Map<number, number | null>();
    for (const y of years) {
      map.set(y, parseNbsAverage(await getJson(nbsYear(y)), String(y)));
    }
    return (y) => map.get(y) ?? null;
  }
  const ecb = parseEcbAnnual(await getJson(ECB(currency)));
  return (y) => ecb[y] ?? null;
}

export const companywall: Adapter = {
  id: "companywall",
  about: {
    url:
      "https://www.companywall.<страна>/firma|podjetje/<slug>/<id> (ссылки — в companies.url конфига)",
    what:
      "общие доходы (Ukupni prihodi / Celotni prihodki) и сотрудники юрлиц за три последних поданных года из государственного реестра (APR / AJPES); номер юрлица (MB / MŠ) на странице сверяется с конфигом; не евро → евро по среднегодовому курсу (динар — НБС)",
  },
  async collect(cfg, opts) {
    const started_at = new Date().toISOString();
    const base = {
      country: cfg.country,
      started_at,
      source: "registry" as const,
      adapter: "companywall",
    };
    try {
      const thisYear = Number(opts.today.slice(0, 4));
      const rate = await yearRates(
        cfg.currency ?? "EUR",
        [1, 2, 3, 4].map((d) => thisYear - d),
      );
      const years = [];
      const errors: string[] = [];
      for (const co of cfg.companies.filter((c) => c.url)) {
        try {
          const html = await (await httpGet(co.url!)).text();
          years.push(...parseCompanyWall(html, co.regId, co.url!, rate));
        } catch (e) {
          errors.push(`${co.name}: ${e}`); // одна сломанная страница не роняет остальные
        }
      }
      if (errors.length) {
        console.warn(`companywall ${cfg.country}: ${errors.join("; ")}`);
      }
      if (!years.length && errors.length) {
        return { ...base, failed: errors.join("; ").slice(0, 500) };
      }
      return { ...base, years };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
