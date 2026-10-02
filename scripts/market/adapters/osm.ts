// OpenStreetMap через Overpass: только предлагает точки международных сетей (кандидаты),
// сам ничего не подтверждает. Запрос по тегу brand в границах страны — тяжёлый запрос по
// всем заведениям Overpass не тянет (сверка 02.10.2026).
import { httpGet, parseOverpass, srLatin } from "../lib.ts";
import type { Adapter } from "./types.ts";

const OVERPASS = "https://overpass-api.de/api/interpreter";
// Публичный Overpass отвечает 504/429 по несколько минут подряд (02.10.2026 — трижды за вечер).
const OVERPASS_RETRY_MS = [60_000, 180_000, 300_000];
const esc = (s: string) =>
  s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace(/"/g, '\\"');

/** names — начала тега name для сетей без тега brand: ищутся только среди заведений общепита и
 *  пекарен, иначе запрос по всей стране Overpass не вытягивает. */
export function overpassQuery(
  cc: string,
  brands: string[],
  names: string[] = [],
): string {
  const re = brands.map(esc).join("|");
  const byName = names.length
    ? (() => {
      const nr = names.map(esc).join("|");
      return `nwr["amenity"~"^(fast_food|restaurant|cafe)$"]["name"~"^(${nr})",i](area.a);` +
        `nwr["shop"~"^(bakery|pastry)$"]["name"~"^(${nr})",i](area.a);`;
    })()
    : "";
  return `[out:json][timeout:150];area["ISO3166-1"="${cc}"][admin_level=2]->.a;` +
    `(${
      re ? `nwr["brand"~"^(${re})$",i](area.a);` : ""
    }${byName}node["place"~"^(city|town)$"](area.a););out center tags;`;
}

export const osm: Adapter = {
  id: "osm-overpass",
  about: {
    url: "https://overpass-api.de/api/interpreter",
    what:
      "точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town",
  },
  async collect(cfg) {
    const started_at = new Date().toISOString();
    const base = { country: cfg.country, started_at, source: "osm" as const };
    const brands = Object.fromEntries(
      cfg.chains.filter((c) => c.osmBrands?.length).map((
        c,
      ) => [c.key, c.osmBrands!]),
    );
    try {
      const names = Object.fromEntries(
        cfg.chains.filter((c) => c.osmNames?.length).map((
          c,
        ) => [c.key, c.osmNames!]),
      );
      const all = Object.values(brands).flat();
      const allNames = Object.values(names).flat();
      if (!all.length && !allNames.length) return { ...base, points: [] };
      const r = await httpGet(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${
          encodeURIComponent(overpassQuery(cfg.country, all, allNames))
        }`,
      }, OVERPASS_RETRY_MS);
      return {
        ...base,
        points: parseOverpass(await r.json(), brands, names, {
          toLatin: cfg.cityScript === "sr-Latn" ? srLatin : undefined,
        }),
      };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
