// Генератор подложек карты «Анализа рынка»: miniapp/public/market/shapes/<CC>.json.
// Рисуется один раз на страну и коммитится; сборщики его не зовут. Источник — Natural Earth
// 10m (public domain, можно в публичный репозиторий): страна, её регионы, соседи и море для
// контекста, озёра, крупные реки, города. Demoland (XD) выдумана и строится здесь же.
//
//   deno run -A scripts/market/build-shapes.ts <папка с ne_10m_*.geojson> [HR,RO,EE,XD]
// Файлы: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson —
// admin_0_countries, admin_1_states_provinces, lakes, rivers_lake_centerlines,
// populated_places_simple.
import { CITIES as DEMO_CITIES } from "../../miniapp/src/lib/marketDemo.ts";
import { clipLine, clipRing, project, type Proj, type Pt, simplify, toPath } from "./shapes-geo.ts";

const W = 750;
const PAD = 0.07; // поле вокруг страны: соседи и море, чтобы контур не висел в пустоте
const TOL = 0.35; // допуск упрощения, px итоговой карты
const MIN_AREA = 6; // озеро меньше 6 px² не видно
const MAX_CITIES = 12;
const RIVER_RANK = 6; // scalerank Natural Earth: меньше — крупнее река
const OUT = new URL("../../miniapp/public/market/shapes/", import.meta.url);

const A3: Record<string, string> = { HR: "HRV", RO: "ROU", EE: "EST" };

type Geom = { type: string; coordinates: unknown };
type Feature = { properties: Record<string, unknown>; geometry: Geom | null };
type City = { name: string; x: number; y: number; capital: boolean; rank: number };

const [dir, only] = Deno.args;
if (!dir) throw new Error("укажи папку с ne_10m_*.geojson");
const load = async (name: string): Promise<Feature[]> =>
  JSON.parse(await Deno.readTextFile(`${dir}/ne_10m_${name}.geojson`)).features;

/** Полигоны фичи как кольца [lng, lat]. */
function rings(g: Geom | null): number[][][] {
  if (!g) return [];
  if (g.type === "Polygon") return g.coordinates as number[][][];
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).flat();
  return [];
}
function lines(g: Geom | null): number[][][] {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates as number[][]];
  if (g.type === "MultiLineString") return g.coordinates as number[][][];
  return [];
}

function frame(lngs: number[], lats: number[]): { proj: Proj; W: number; H: number } {
  const [lo, hi, la0, la1] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const CS = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const dLng = (hi - lo) * (1 + 2 * PAD), dLat = (la1 - la0) + (hi - lo) * CS * 2 * PAD;
  const K = W / (dLng * CS);
  const proj = { K, L0: lo - (hi - lo) * PAD, LAT0: la1 + (hi - lo) * CS * PAD, CS };
  return { proj, W, H: Math.round(dLat * K) };
}

const area = (r: Pt[]) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;

function polyPath(src: number[][][], proj: Proj, H: number, minArea = 0): string {
  const m = 20; // за рамку чуть с запасом, чтобы штрих на краю не обрывался
  return toPath(
    src.map((r) => clipRing(r.map(([lng, lat]) => project(proj, lng, lat)), -m, -m, W + m, H + m))
      .map((r) => simplify([...r, r[0]], TOL).slice(0, -1))
      .filter((r) => r.length > 2 && area(r) >= minArea),
    true,
  );
}

function linePath(src: number[][][], proj: Proj, H: number): string {
  return toPath(
    src.flatMap((l) => clipLine(l.map(([lng, lat]) => project(proj, lng, lat)), 0, 0, W, H))
      .map((r) => simplify(r, TOL)),
    false,
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

async function real(cc: string) {
  const [countries, regions, lakes, rivers, places] = await Promise.all([
    load("admin_0_countries"),
    load("admin_1_states_provinces"),
    load("lakes"),
    load("rivers_lake_centerlines"),
    load("populated_places_simple"),
  ]);
  const me = countries.find((f) => f.properties.ADM0_A3 === A3[cc]);
  if (!me) throw new Error(`${cc}: нет в admin_0`);
  // Рамку считаем по крупным кольцам: у Хорватии сотни островков, они в кадре и так.
  const own = rings(me.geometry);
  const pts = own.flat();
  const { proj, H } = frame(pts.map((p) => p[0]), pts.map((p) => p[1]));
  const inFrame = (r: number[][]) =>
    r.some(([lng, lat]) => {
      const [x, y] = project(proj, lng, lat);
      return x > -50 && x < W + 50 && y > -50 && y < H + 50;
    });
  const near = countries.filter((f) => f !== me && rings(f.geometry).some(inFrame));
  const cities: City[] = places
    .filter((f) => f.properties.adm0_a3 === A3[cc])
    .sort((a, b) => Number(b.properties.pop_max) - Number(a.properties.pop_max))
    .slice(0, MAX_CITIES)
    .map((f, rank) => {
      const [x, y] = project(proj, Number(f.properties.longitude), Number(f.properties.latitude));
      return { name: String(f.properties.name), x: round(x), y: round(y), capital: f.properties.adm0cap === 1, rank };
    });
  return {
    W,
    H,
    proj,
    path: polyPath(own, proj, H),
    land: polyPath(near.flatMap((f) => rings(f.geometry)), proj, H),
    regions: polyPath(regions.filter((f) => f.properties.adm0_a3 === A3[cc]).flatMap((f) => rings(f.geometry)), proj, H),
    lakes: polyPath(lakes.flatMap((f) => rings(f.geometry)).filter(inFrame), proj, H, MIN_AREA),
    rivers: linePath(
      rivers.filter((f) => f.properties.featurecla === "River" && Number(f.properties.scalerank) <= RIVER_RANK)
        .flatMap((f) => lines(f.geometry)),
      proj,
      H,
    ),
    cities,
    source: "Natural Earth 10m (public domain)",
  };
}

/** Demoland: остров в Атлантике, где лежат выдуманные точки демо. Берег — ломаная, изрезанная
 *  фрактальным смещением середин (детерминированный шум), плюс острова, регионы, река, озеро и
 *  кромка «материка»: демо — первое, что видит внешний человек, и картофелина там не годится.
 *  Регионы и река рисуются с запасом за берег — экран обрезает их контуром страны. */
function demoland() {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const fractal = (base: Pt[], depth: number, rough: number, open = false): Pt[] => {
    let ring = base;
    for (let k = 0; k < depth; k++) {
      ring = ring.flatMap((p, i): Pt[] => {
        if (open && i === ring.length - 1) return [p];
        const q = ring[(i + 1) % ring.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const off = rnd() * len * rough;
        // смещение поперёк ребра: так рождаются бухты и мысы
        const mid: Pt = [(p[0] + q[0]) / 2 - ((q[1] - p[1]) / (len || 1)) * off, (p[1] + q[1]) / 2 + ((q[0] - p[0]) / (len || 1)) * off];
        return [p, mid];
      });
    }
    return ring;
  };
  const main = fractal([
    [-34.6, 45.62], [-33.9, 45.7], [-33.4, 45.45], [-32.7, 45.5], [-32.2, 45.2], [-31.6, 45.05], [-31.25, 44.75],
    [-31.35, 44.1], [-31.9, 43.55], [-32.3, 43.32], [-32.7, 43.2], [-33.7, 43.18], [-34.2, 43.05], [-34.7, 43.35],
    [-35.25, 43.9], [-35.1, 44.25], [-35.15, 44.6], [-35.0, 45.2],
  ], 6, 0.32);
  const isle = (lng: number, lat: number, r: number): Pt[] =>
    fractal(Array.from({ length: 7 }, (_, i): Pt => {
      const a = (i / 7) * Math.PI * 2;
      return [lng + Math.cos(a) * r * 1.4, lat + Math.sin(a) * r];
    }), 4, 0.3);
  const islands = [isle(-30.85, 44.3, 0.11), isle(-31.0, 43.85, 0.06), isle(-34.95, 42.95, 0.08), isle(-35.55, 44.85, 0.07)];
  const mainland = fractal([[-37, 46.5], [-34.6, 46.5], [-34.9, 46.05], [-35.45, 45.8], [-35.9, 45.3], [-37, 45.0]], 6, 0.3);
  const lake: Pt[] = isle(-33.05, 44.55, 0.07);
  const regionLines: Pt[][] = [
    [[-33.3, 46], [-33.15, 45.2], [-33.4, 44.6], [-33.2, 43.9], [-33.35, 42.8]],
    [[-36, 44.05], [-34.6, 44.2], [-33.4, 44.6]],
    [[-33.2, 43.9], [-32.3, 44.2], [-31.6, 44.35], [-30.5, 44.4]],
    [[-33.15, 45.2], [-32.4, 45.0], [-31.9, 45.4]],
  ];
  const river: Pt[][] = [[[-33.05, 44.55], [-32.75, 44.35], [-32.55, 44.0], [-32.35, 43.7], [-32.25, 43.35]]];
  const pts = [...main, ...islands.flat()];
  const { proj, H } = frame(pts.map((p) => p[0]), pts.map((p) => p[1]));
  const cities: City[] = [...DEMO_CITIES].sort((a, b) => b[3] - a[3]).map(([name, lat, lng], rank) => {
    const [x, y] = project(proj, lng, lat);
    return { name, x: round(x), y: round(y), capital: rank === 0, rank };
  });
  return {
    W,
    H,
    proj,
    path: polyPath([main, ...islands], proj, H),
    land: polyPath([mainland], proj, H),
    regions: linePath(regionLines.map((l) => fractal(l, 5, 0.22, true)), proj, H),
    lakes: polyPath([lake], proj, H),
    rivers: linePath(river.map((l) => fractal(l, 5, 0.3, true)), proj, H),
    cities,
    source: "fictional",
  };
}

for (const cc of (only ?? "HR,RO,EE,XD").split(",")) {
  const shape = cc === "XD" ? demoland() : await real(cc);
  const json = JSON.stringify(shape);
  await Deno.writeTextFile(new URL(`${cc}.json`, OUT), json);
  console.log(`${cc}: ${shape.W}×${shape.H}, ${(json.length / 1024).toFixed(0)} KB, городов ${shape.cities.length}`);
}
