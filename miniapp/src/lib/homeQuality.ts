// Модель РС (стандарты, полумесячные волны) и РКО (клиентский опыт, недели) для главной —
// из двух ответов GET /quality. Чистые функции без React, под тестами (homeQuality.test.ts).
//
// Правило владельца: балл страны = среднее её пиццерий, у которых есть балл в этом периоде.
// Отсюда и среднее подборки из нескольких стран — среднее по всем их пиццериям с баллом,
// а не среднее средних стран.

import { clampRange, monthKey, type MonthRange, type Point } from "./homeChartSeries";

export const RS_NORM = 90;
export const RS_WARN = 85;
export const RS_CRIT = 80;
export const RKO_NORM = 94.6;
export const RKO_WARN = 92;
export const RKO_CRIT = 80;
/** Резкое падение РКО за неделю и РС за волну — сигнал «куда смотреть». */
export const RKO_DROP = 3;
export const RS_DROP = 8;
/** Сколько последних волн РС в спарклайне таблицы пиццерий. */
const RS_HIST_LEN = 6;

/** Ответ GET /quality в той части, что нужна главной (QualityData из lib/api подходит как есть). */
export type QualityInput = {
  periods: Array<{ start: string; end: string }>;
  units: Array<{ id: string; name: string; cc: string; scores: Array<number | null> }>;
};
export type QualityKind = "rs" | "rko";

export type Pizzeria = {
  key: string;
  cc: string;
  name: string;
  /** Балл в последнем периоде с данными и в предыдущем; null — балла нет. */
  rs: number | null;
  rsPrev: number | null;
  /** До шести последних баллов РС (без пропусков), заканчивая последней волной. */
  rsHist: number[];
  /** Раньше балл был, а в последнем периоде его нет. */
  rsMissed: boolean;
  rko: number | null;
  rkoPrev: number | null;
  rkoMissed: boolean;
  /** Баллы, выровненные по периодам модели (rsDates / rkoDates). */
  rsScores: Array<number | null>;
  rkoScores: Array<number | null>;
};

export type CountryQuality = {
  cc: string;
  rs: number | null;
  rsPrev: number | null;
  rko: number | null;
  rkoPrev: number | null;
  rsHistory: Point[];
  rkoHistory: Point[];
  pizzerias: Pizzeria[];
};

type Periods = { dates: Date[]; ends: Date[]; last: number };

export type QualityModel = {
  countries: CountryQuality[];
  rs: Periods;
  rko: Periods;
  /** Месяцы с данными — границы выбора периода графика; null — данных нет. */
  rsBounds: MonthRange | null;
  rkoBounds: MonthRange | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;

/** «ГГГГ-ММ-ДД» → местная полночь: разбивка графика берёт местные день и месяц. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function periodsOf(input: QualityInput): Periods {
  let last = -1;
  input.periods.forEach((_, i) => { if (input.units.some((u) => u.scores[i] != null)) last = i; });
  return { dates: input.periods.map((p) => localDate(p.start)), ends: input.periods.map((p) => localDate(p.end)), last };
}

function boundsOf(input: QualityInput, p: Periods): MonthRange | null {
  const first = input.periods.findIndex((_, i) => input.units.some((u) => u.scores[i] != null));
  if (first < 0) return null;
  return { from: monthKey(p.dates[first]), to: monthKey(p.dates[p.last]) };
}

const at = (scores: Array<number | null>, i: number) => (i >= 0 ? scores[i] ?? null : null);
const nameKey = (cc: string, name: string) => `${cc}|${name.trim().toLowerCase()}`;

/** Пиццерии обоих видов: одна и та же — по id, иначе по стране и имени без учёта регистра. */
function unionUnits(rs: QualityInput, rko: QualityInput): Array<{ key: string; cc: string; name: string; rs: Array<number | null>; rko: Array<number | null> }> {
  const out: Array<{ key: string; cc: string; name: string; rs: Array<number | null>; rko: Array<number | null> }> = [];
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  const empty = (n: number) => new Array<number | null>(n).fill(null);
  const put = (u: QualityInput["units"][number], kind: QualityKind) => {
    const found = byId.get(u.id) ?? byName.get(nameKey(u.cc, u.name));
    if (found != null) {
      out[found] = { ...out[found], [kind]: u.scores };
      return;
    }
    out.push({ key: u.id, cc: u.cc, name: u.name, rs: empty(rs.periods.length), rko: empty(rko.periods.length), [kind]: u.scores });
    byId.set(u.id, out.length - 1);
    byName.set(nameKey(u.cc, u.name), out.length - 1);
  };
  rs.units.forEach((u) => put(u, "rs"));
  rko.units.forEach((u) => put(u, "rko"));
  return out;
}

function hadBefore(scores: Array<number | null>, last: number): boolean {
  return last > 0 && scores[last] == null && scores.slice(0, last).some((v) => v != null);
}

function mean(values: Array<number | null>): number | null {
  const got = values.filter((v): v is number => v != null);
  return got.length ? got.reduce((s, v) => s + v, 0) / got.length : null;
}

/** Ряд среднего по пиццериям; периоды, где ни у кого нет балла, пропускаются. */
function historyOf(pizzerias: Pizzeria[], periods: Periods, kind: QualityKind): Point[] {
  const out: Point[] = [];
  periods.dates.forEach((date, i) => {
    const v = mean(pizzerias.map((p) => (kind === "rs" ? p.rsScores : p.rkoScores)[i]));
    if (v != null) out.push({ date, value: round1(v) });
  });
  return out;
}

export function buildQuality(rsData: QualityInput, rkoData: QualityInput): QualityModel {
  const rs = periodsOf(rsData), rko = periodsOf(rkoData);
  const pizzerias: Pizzeria[] = unionUnits(rsData, rkoData).map((u) => ({
    key: u.key, cc: u.cc, name: u.name,
    rs: at(u.rs, rs.last), rsPrev: at(u.rs, rs.last - 1),
    rsHist: u.rs.slice(0, rs.last + 1).filter((v): v is number => v != null).slice(-RS_HIST_LEN),
    rsMissed: hadBefore(u.rs, rs.last),
    rko: at(u.rko, rko.last), rkoPrev: at(u.rko, rko.last - 1),
    rkoMissed: hadBefore(u.rko, rko.last),
    rsScores: u.rs, rkoScores: u.rko,
  }));
  const codes = [...new Set(pizzerias.map((p) => p.cc))].sort();
  const countries = codes.map((cc) => countryFrom(cc, pizzerias.filter((p) => p.cc === cc), rs, rko));
  return { countries, rs, rko, rsBounds: boundsOf(rsData, rs), rkoBounds: boundsOf(rkoData, rko) };
}

function countryFrom(cc: string, pizzerias: Pizzeria[], rs: Periods, rko: Periods): CountryQuality {
  return {
    cc, pizzerias,
    rs: mean(pizzerias.map((p) => p.rs)), rsPrev: mean(pizzerias.map((p) => p.rsPrev)),
    rko: mean(pizzerias.map((p) => p.rko)), rkoPrev: mean(pizzerias.map((p) => p.rkoPrev)),
    rsHistory: historyOf(pizzerias, rs, "rs"), rkoHistory: historyOf(pizzerias, rko, "rko"),
  };
}

/** Страна из модели; если по ней баллов ещё нет — пустая, а не ошибка. */
export function countryOf(model: QualityModel, cc: string): CountryQuality {
  return model.countries.find((c) => c.cc === cc)
    ?? { cc, rs: null, rsPrev: null, rko: null, rkoPrev: null, rsHistory: [], rkoHistory: [], pizzerias: [] };
}

/** Среднее подборки — по всем пиццериям её стран, у которых есть балл. */
export function selectionMean(list: CountryQuality[], pick: (p: Pizzeria) => number | null): number | null {
  return mean(list.flatMap((c) => c.pizzerias.map(pick)));
}

/** История подборки одной линией — среднее по всем её пиццериям в каждом периоде. */
export function selectionHistory(model: QualityModel, list: CountryQuality[], kind: QualityKind): Point[] {
  return historyOf(list.flatMap((c) => c.pizzerias), kind === "rs" ? model.rs : model.rko, kind);
}

/** Границы графика и период по умолчанию: последние `months` месяцев, прижатые к данным. */
export function chartBounds(bounds: MonthRange, months: number): { bounds: MonthRange; defaults: MonthRange } {
  return { bounds, defaults: clampRange({ from: bounds.to - (months - 1), to: bounds.to }, bounds) };
}

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_RU_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Последняя волна РС с баллами: «Сентябрь 2» и «16–30 сентября» (EN: «September 2», «Sep 16–30»). */
export function latestWave(model: QualityModel, lang: 0 | 1): { name: string; days: string } | null {
  const i = model.rs.last;
  if (i < 0) return null;
  const s = model.rs.dates[i], e = model.rs.ends[i];
  const half = s.getDate() < 16 ? 1 : 2;
  const sameMonth = s.getMonth() === e.getMonth();
  const name = `${(lang ? MONTHS_EN : MONTHS_RU)[s.getMonth()]} ${half}`;
  if (!sameMonth) return { name, days: `${ddmm(s)} — ${ddmm(e)}` };
  const days = lang
    ? `${MONTHS_EN[s.getMonth()].slice(0, 3)} ${s.getDate()}–${e.getDate()}`
    : `${s.getDate()}–${e.getDate()} ${MONTHS_RU_GEN[s.getMonth()]}`;
  return { name, days };
}

/** Последняя неделя РКО с баллами: «28.09 — 04.10». */
export function latestWeek(model: QualityModel): string | null {
  const i = model.rko.last;
  return i < 0 ? null : `${ddmm(model.rko.dates[i])} — ${ddmm(model.rko.ends[i])}`;
}
