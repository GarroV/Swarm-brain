// Румыния: годовые балансы из data.gov.ro (Министерство финансов, открытая лицензия).
// Суммы в RON → евро по среднегодовому курсу ЕЦБ.
import { getJson, httpGet, lines, parseEcbAnnual } from "../lib.ts";
import { parseRoBilant } from "../registry.ts";
import type { Adapter } from "./types.ts";

const CKAN = "https://data.gov.ro/api/3/action/package_show?id=";
const ECB =
  "https://data-api.ecb.europa.eu/service/data/EXR/A.RON.EUR.SP00.A?format=jsondata&startPeriod=2015";
const YEARS_BACK = 3;
type Resource = { name: string; url: string };
type Ckan = { result: { resources: Resource[] } };

/** Файлы года: обычные фирмы (UU), малые/микро (BL_BS_SL) и отчитывающиеся по МСФО (IR —
 *  там Sphera). Колонки у всех трёх одни. Есть копии в .csv — берём .txt. */
export function pickRoFiles(resources: Resource[], year: number): Resource[] {
  const want = [
    `WEB_UU_AN${year}.TXT`,
    `WEB_BL_BS_SL_AN${year}.TXT`,
    `WEB_IR_AN${year}.TXT`,
  ];
  return resources.filter((r) => want.includes(r.name.toUpperCase()));
}

export const roDatagov: Adapter = {
  id: "ro-datagov",
  about: {
    url: "https://data.gov.ro (набор situatii financiare)",
    what:
      "годовая отчётность юрлиц Румынии по CUI из companies: оборот и сотрудники; лей → евро по годовому курсу ЕЦБ",
  },
  async collect(cfg, opts) {
    const started_at = new Date().toISOString();
    const base = {
      country: cfg.country,
      started_at,
      source: "registry" as const,
      adapter: "ro-datagov",
    };
    try {
      const rates = parseEcbAnnual(await getJson(ECB));
      const cuis = new Set(cfg.companies.map((c) => c.regId));
      const thisYear = Number(opts.today.slice(0, 4));
      const out = [];
      for (let y = thisYear - 1; y >= thisYear - YEARS_BACK; y--) {
        // Пакет года назван то с подчёркиванием, то без (situatii_financiare2023), а закрытый
        // дубль отвечает 403. Выгрузку публикуют с опозданием: нет пакета — год пропускаем.
        const pkg = await getJson<Ckan>(CKAN + `situatii_financiare_${y}`)
          .catch(() => getJson<Ckan>(CKAN + `situatii_financiare${y}`))
          .catch(() => null);
        if (!pkg || !rates[y]) {
          console.warn(
            `RO ${y}: нет открытого пакета situatii_financiare или курса ЕЦБ — год пропущен`,
          );
          continue;
        }
        const files = pickRoFiles(pkg.result.resources, y);
        if (!files.length) {
          throw new Error(
            `situatii_financiare_${y}: нет файлов WEB_UU_AN / WEB_BL_BS_SL_AN / WEB_IR_AN`,
          );
        }
        for (const res of files) {
          const r = await httpGet(res.url);
          const picked: string[] = [];
          for await (const l of lines(r.body!)) {
            if (cuis.has(l.slice(0, l.indexOf(",")))) picked.push(l);
          }
          out.push(...parseRoBilant(picked, cuis, y, rates[y]));
        }
      }
      return { ...base, years: out };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
