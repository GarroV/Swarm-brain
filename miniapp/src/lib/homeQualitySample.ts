// ОБРАЗЕЦ данных РС и РКО для виджетов главной. Источника в Swarm ещё нет: сейчас цифры живут
// в Google-таблицах «Аналитика IMF», канал загрузки не решён (decisions/2026-10-07-home-dashboard-direction.md).
// Всё ниже — синтетика, детерминированная от кода страны, чтобы виджеты можно было увидеть
// в продукте. Настоящие баллы сюда НЕ кладём: репозиторий публичный.

export const RS_NORM = 90;
export const RS_WARN = 85;
export const RS_CRIT = 80;
export const RKO_NORM = 94.6;
export const RKO_WARN = 92;
export const COLL_NORM = 85;

export type CheckKind = "inspector" | "online" | "self" | "none";

export type PizzeriaSample = {
  cc: string;
  name: string;
  rs: number | null;
  rsPrev: number | null;
  rsHist: number[];
  kind: CheckKind;
  rko: number;
  rkoPrev: number;
  cliRest: number;
  cliDeliv: number;
};

export type CountrySample = {
  cc: string;
  rs: number;
  rsPrev: number;
  rko: number;
  rkoPrev: number;
  coll: number;
  rsWaves: number[];
  rkoWeeks: number[];
  pizzerias: PizzeriaSample[];
};

export const WAVES = 16;
export const WEEKS = 7;

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const KINDS: CheckKind[] = ["inspector", "inspector", "inspector", "online", "self"];

/** Ряд значений, который заканчивается на `last` и бродит вокруг него. */
function walk(rnd: () => number, last: number, len: number, amp: number, lo: number, hi: number): number[] {
  const out = new Array<number>(len);
  let v = last;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = round1(clamp(v, lo, hi));
    v += (rnd() - 0.5) * amp;
  }
  return out;
}

export function countrySample(cc: string): CountrySample {
  const rnd = seeded(cc);
  const rs = Math.round(70 + rnd() * 26);
  const rko = round1(87 + rnd() * 9);
  const rsWaves = walk(rnd, rs, WAVES, 6, 55, 100);
  const rkoWeeks = walk(rnd, rko, WEEKS, 2.4, 80, 100);
  const count = 2 + Math.floor(rnd() * 4);
  const pizzerias = Array.from({ length: count }, (_, i) => pizzeriaSample(cc, i, rs, rko));
  return {
    cc, rs, rsPrev: rsWaves[WAVES - 2], rko, rkoPrev: rkoWeeks[WEEKS - 2],
    coll: Math.round(50 + rnd() * 50), rsWaves, rkoWeeks, pizzerias,
  };
}

function pizzeriaSample(cc: string, i: number, rsBase: number, rkoBase: number): PizzeriaSample {
  const rnd = seeded(`${cc}-${i}`);
  const kind: CheckKind = rnd() < 0.08 ? "none" : KINDS[Math.floor(rnd() * KINDS.length)];
  const rs = kind === "none" ? null : Math.round(clamp(rsBase + (rnd() - 0.5) * 40, 20, 100) / 4) * 4;
  const rsHist = rs == null ? [] : walk(rnd, rs, 6, 14, 10, 100).map((v) => Math.round(v / 4) * 4);
  const rko = round1(clamp(rkoBase + (rnd() - 0.5) * 9, 78, 100));
  return {
    cc, name: `${cc}-${i + 1}`, rs, rsPrev: rs == null ? null : rsHist[4], rsHist, kind,
    rko, rkoPrev: round1(clamp(rko + (rnd() - 0.5) * 5, 78, 100)),
    cliRest: Math.floor(rnd() * 4), cliDeliv: Math.floor(rnd() * 6),
  };
}

/** Взвешенное по числу пиццерий среднее по подборке. */
export function weighted(list: CountrySample[], pick: (c: CountrySample) => number): number | null {
  let s = 0, w = 0;
  for (const c of list) { s += pick(c) * c.pizzerias.length; w += c.pizzerias.length; }
  return w ? s / w : null;
}

export function seriesAvg(list: CountrySample[], pick: (c: CountrySample) => number[], len: number): number[] {
  return Array.from({ length: len }, (_, i) => round1(weighted(list, (c) => pick(c)[i]) ?? 0));
}

const MONTHS_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Подписи полумесячных волн РС, заканчивая волной `last` (по умолчанию «Сентябрь 2» 2026). */
export function waveLabels(lang: 0 | 1, lastMonth = 8, lastHalf: 1 | 2 = 2): string[] {
  const names = lang ? MONTHS_EN : MONTHS_RU;
  const out: string[] = [];
  let m = lastMonth, h: number = lastHalf;
  for (let i = 0; i < WAVES; i++) {
    out.unshift(`${names[(m + 12) % 12]} ${h}`);
    if (h === 2) h = 1; else { h = 2; m -= 1; }
  }
  return out;
}

/** Подписи недель РКО (понедельник), заканчивая неделей с понедельника `lastMonday`. */
export function weekLabels(lastMonday = new Date(2026, 8, 28)): string[] {
  return Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(lastMonday);
    d.setDate(d.getDate() - (WEEKS - 1 - i) * 7);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** Средний ряд по всей сети — для сравнения «моя подборка против IMF». */
export function imfSample(codes: string[]): CountrySample[] {
  return codes.map(countrySample);
}

export const VIOLATIONS: Array<[string, string, number]> = [
  ["Грязный инвентарь / посуда", "Dirty equipment / dishes", 0.95],
  ["Температура теста", "Dough temperature", 0.6],
  ["Правила хранения тары", "Container storage rules", 0.5],
  ["Повреждённый пластиковый инвентарь", "Damaged plastic equipment", 0.35],
  ["Качество теста", "Dough quality", 0.15],
];
