import type { AggregatorInfo, AggregatorScore, AggregatorsCountry, AggregatorsData, MapsCountry, MapsData, MapsStat, MapsUnit, MapsUnitStat } from "./marketTypes";
import type { Inspection, InspectionDetail, InspectionFinding, InspectionsData, QualityData, QualityKind, QualityPeriod } from "./api-types/quality";

// Синтетика для DEV_MODE: страны и пиццерии те же, что в mockQuality; оценки детерминированы от индекса.
export function mockMaps(): MapsData {
  const names: [string, string][] = [
    ["BG", "Demo Sofia-1"], ["BG", "Demo Varna-1"], ["RS", "Demo Novi Sad-1"], ["RS", "Demo Belgrade-2"],
    ["PL", "Demo Krakow-1"], ["NG", "Demo Lagos-1"], ["NG", "Demo Abuja-3"], ["KZ", "Demo Almaty-1"], ["KZ", "Demo Astana-2"],
  ];
  const units: MapsUnit[] = names.map(([cc, name], u) => {
    const avg = Math.round((3.4 + ((u * 7) % 15) / 10) * 100) / 100;
    return {
      id: String(u + 1).padStart(32, "d"), name, cc, city: null,
      maps: {
        google: { avg, reviews: 80 + u * 41, prev_avg: Math.round((avg + (u % 3 === 0 ? 0.12 : -0.05)) * 100) / 100 },
        yandex: cc === "KZ" || cc === "RS" ? { avg: Math.min(5, avg + 0.2), reviews: 20 + u * 9, prev_avg: Math.min(5, avg + 0.15) } : null,
      },
    };
  });
  const countries: MapsCountry[] = ["BG", "RS", "PL", "NG", "KZ"].map((cc) => {
    const list = units.filter((x) => x.cc === cc);
    const stat = (k: "google" | "yandex"): MapsStat => {
      const rows = list.map((x) => x.maps[k]).filter((m): m is MapsUnitStat => !!m && m.avg != null);
      const reviews = rows.reduce((a, m) => a + m.reviews, 0);
      const avg = reviews ? rows.reduce((a, m) => a + (m.avg as number) * m.reviews, 0) / reviews : null;
      const prev = reviews ? rows.reduce((a, m) => a + (m.prev_avg ?? m.avg as number) * m.reviews, 0) / reviews : null;
      return { avg: avg == null ? null : Math.round(avg * 100) / 100, reviews, branches: list.length, delta: avg == null || prev == null ? null : Math.round((avg - prev) * 100) / 100 };
    };
    return { cc, as_of: "2026-10-10", maps: { google: stat("google"), yandex: stat("yandex") } };
  });
  return { on: "2026-10-11", compare: "2026-09-11", countries, units, loaded_at: "2026-10-11T03:10:00Z" };
}

// Синтетика для DEV_MODE: у каждой страны свой набор агрегаторов (NG и PL — без Wolt/Glovo, PL — вовсе без), шкалы разные.
export function mockAggregators(): AggregatorsData {
  const aggregators: AggregatorInfo[] = [
    { key: "glovo", title: "Glovo", scale: 100 }, { key: "wolt", title: "Wolt", scale: 10 }, { key: "yandex_eda", title: "Yandex Eats", scale: 5 },
  ];
  const score = (avg: number, scale: number, votes: number, pizzerias: number, delta: number | null): AggregatorScore => ({ avg, scale, votes, pizzerias, delta });
  const countries: AggregatorsCountry[] = [
    { cc: "BG", as_of: "2026-10-18", scores: { glovo: score(91, 100, 1820, 6, 1.5), wolt: score(8.9, 10, 940, 5, -0.12) } },
    { cc: "RS", as_of: "2026-10-18", scores: { wolt: score(9.1, 10, 1210, 2, 0.08), glovo: score(88, 100, 460, 2, -2) } },
    { cc: "KZ", as_of: "2026-10-18", scores: { yandex_eda: score(4.71, 5, 3100, 2, 0.03), wolt: score(8.4, 10, 220, 1, null) } },
    { cc: "NG", as_of: "2026-10-18", scores: {} },
    { cc: "PL", as_of: "2026-10-18", scores: {} },
  ];
  return { on: "2026-10-19", compare: "2026-09-19", aggregators, countries, loaded_at: "2026-10-19T03:10:00Z" };
}

// Синтетика для DEV_MODE: пиццерии те же, что в mockMaps; есть падение, рост и проверка без прошлой.
export function mockInspections(): InspectionsData {
  const rows: [string, string, string, number, string, number | null][] = [
    ["BG", "Demo Sofia-1", "2026-10-08", 96.5, "A", 93.0], ["RS", "Demo Belgrade-2", "2026-10-06", 81.0, "C", 90.5],
    ["PL", "Demo Krakow-1", "2026-10-05", 92.0, "B", 92.0], ["KZ", "Demo Almaty-1", "2026-10-03", 88.5, "B", null],
    ["NG", "Demo Lagos-1", "2026-09-29", 74.0, "D", 79.5], ["BG", "Demo Varna-1", "2026-09-24", 94.5, "A", 91.0],
    ["RS", "Demo Novi Sad-1", "2026-09-20", 90.0, "B", 87.5], ["KZ", "Demo Astana-2", "2026-09-15", 85.0, "C", 86.0],
    ["NG", "Demo Abuja-3", "2026-09-10", 79.5, "C", 70.0], ["PL", "Demo Krakow-1", "2026-07-01", 92.0, "B", null],
  ];
  const inspections = rows.map(([cc, name, date, score, grade, prev], i): Inspection => {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    return {
      id, unit: { id: String(i + 1).padStart(32, "d"), dodo_id: null, name, cc }, date, kind: "planned", score_pct: score, grade,
      path: `/registry/${id}`, report_url: `https://decimus.example${`/registry/${id}`}`,
      previous: prev == null ? null : { id: `${id.slice(0, -1)}9`, date: "2026-07-01", score_pct: prev, grade: prev >= 90 ? "A" : "B" },
    };
  });
  return { inspections, truncated: false };
}

export function mockInspectionDetail(id: string): InspectionDetail {
  const base = mockInspections().inspections.find((r) => r.id === id) ?? mockInspections().inspections[0];
  const bad = Math.round((100 - base.score_pct) / 2.5);
  const levels = ["critical", "major", "major", "minor", "minor", "minor"];
  const findings: InspectionFinding[] = Array.from({ length: Math.min(bad, 6) }, (_, k) => ({
    n: k + 1, code: `D${k + 1}.${k + 2}`, title_ru: `Пункт методики ${k + 1}`, title_en: `Methodology item ${k + 1}`,
    level: levels[k], zone: k % 2 ? "KIT" : "HALL",
    text: k === 1 ? null : `Demo finding ${k + 1}: the item was not met during the visit.`, repeat: k === 0 && base.previous != null,
  }));
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.level] = (counts[f.level] ?? 0) + 1;
  return {
    inspection: {
      ...base, deductions: Math.round((100 - base.score_pct) * 10) / 10, counts,
      zones: [
        { zone: "KIT", title_ru: "Кухня", title_en: "Kitchen", share: 60, loss: 3.5, left: 56.5, zeroed: false },
        { zone: "HALL", title_ru: "Зал", title_en: "Dining area", share: 25, loss: 25, left: 0, zeroed: true },
        { zone: "OUT", title_ru: "Снаружи", title_en: "Outside", share: 15, loss: 0, left: 15, zeroed: false },
      ],
    },
    findings,
  };
}

// Синтетика для DEV_MODE: выдуманные пиццерии в четырёх странах, баллы детерминированы от индекса.
export function mockQuality(kind: QualityKind): QualityData {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
  const periods: QualityPeriod[] = kind === "rs"
    ? Array.from({ length: 12 }, (_, i) => {
      const m = i >> 1, first = i % 2 === 0;
      return { start: iso(day(2026, m, first ? 1 : 16)), end: iso(day(2026, first ? m : m + 1, first ? 15 : 0)) };
    })
    : Array.from({ length: 12 }, (_, i) => ({ start: iso(day(2026, 6, 6 + i * 7)), end: iso(day(2026, 6, 12 + i * 7)) }));
  const names: [string, string][] = [
    ["BG", "Demo Sofia-1"], ["BG", "Demo Varna-1"], ["RS", "Demo Novi Sad-1"],
    ["RS", "Demo Belgrade-2"], ["PL", "Demo Krakow-1"], ["NG", "Demo Lagos-1"], ["NG", "Demo Abuja-3"],
    ["KZ", "Demo Almaty-1"], ["KZ", "Demo Astana-2"],
  ];
  const base = kind === "rs" ? 84 : 90;
  return {
    kind,
    periods,
    units: names.map(([cc, name], u) => ({
      id: String(u + 1).padStart(32, "d"),
      name,
      cc,
      developer: "Demo Developer",
      scores: periods.map((_, p) => (u + p) % 7 === 3 ? null : Math.min(100, base + ((u * 5 + p * 3) % 15) - 4)),
    })),
  };
}
