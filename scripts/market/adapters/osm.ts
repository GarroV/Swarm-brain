// OpenStreetMap через Overpass: только предлагает точки международных сетей (кандидаты),
// сам ничего не подтверждает. Запрос по тегу brand в границах страны — тяжёлый запрос по
// всем заведениям Overpass не тянет (сверка 02.10.2026).
import { httpGet, parseOverpass } from "../lib.ts";
import type { Adapter } from "./types.ts";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const esc = (s: string) =>
  s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace(/"/g, '\\"');

export function overpassQuery(cc: string, brands: string[]): string {
  const re = brands.map(esc).join("|");
  return `[out:json][timeout:150];area["ISO3166-1"="${cc}"][admin_level=2]->.a;` +
    `nwr["brand"~"^(${re})$",i](area.a);out center tags;`;
}

export const osm: Adapter = {
  id: "osm-overpass",
  about: {
    url: "https://overpass-api.de/api/interpreter",
    what:
      "точки сетей по тегам brand / name из OpenStreetMap (osmBrands в конфиге), координаты, адрес, дата открытия, если она есть в теге",
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
      const all = Object.values(brands).flat();
      if (!all.length) return { ...base, points: [] };
      const r = await httpGet(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery(cfg.country, all))}`,
      });
      return { ...base, points: parseOverpass(await r.json(), brands) };
    } catch (e) {
      return { ...base, failed: String(e) };
    }
  },
};
