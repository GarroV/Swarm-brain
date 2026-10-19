// Ответ Децимуса GET /api/v1/aggregators/ratings (две даты: сегодня и 30 дней назад) → формат
// GET /quality/aggregators. Чистый модуль под тестом (aggregators-view.test.ts): оценки агрегаторов
// читаются на экране как факт. Шкалы у агрегаторов разные (5/10/100) — оценки разных агрегаторов
// не смешиваются никогда, изменение считается внутри одного агрегатора и одной страны.

export type AggregatorInfo = { key: string; title: string; scale: number };
export type AggregatorScore = {
  avg: number | null;
  scale: number;
  votes: number;
  pizzerias: number;
  /** avg сейчас минус avg на дату сравнения; нет одной из оценок — null. */
  delta: number | null;
};
export type AggregatorsCountry = { cc: string; as_of: string | null; scores: Record<string, AggregatorScore> };
export type AggregatorsView = {
  on: string;
  compare: string | null;
  aggregators: AggregatorInfo[];
  countries: AggregatorsCountry[];
  loaded_at: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_-]{1,40}$/i;
const bad = (what: string): never => {
  throw new Error(`decimus: ${what}`);
};
const rec = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad(what);
const count = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : bad("число не целое или отрицательное");
const date = (v: unknown, what: string): string => typeof v === "string" && DATE.test(v) ? v : bad(what);
const code = (v: unknown): string => {
  const cc = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(cc) ? cc : bad("кривой код страны");
};
const round2 = (n: number) => Math.round(n * 100) / 100;

type RawScore = { avg: number | null; scale: number; votes: number; pizzerias: number };
type Parsed = {
  on: string;
  aggregators: AggregatorInfo[];
  countries: { cc: string; as_of: string | null; scores: Record<string, RawScore> }[];
  loaded_at: string | null;
};

/** Один ответ Децимуса. Чужим данным не верим: кривое поле — ошибка, а не тихий ноль;
 * проверяется всё, в том числе страны вне разрешённых — порчу фильтром не прячем. */
function parse(body: unknown, allow: Set<string> | null): Parsed {
  const b = rec(body, "ответ не объект");
  if (!Array.isArray(b.aggregators) || !Array.isArray(b.countries)) bad("нет aggregators/countries");
  const aggregators: AggregatorInfo[] = [];
  for (const raw of b.aggregators as unknown[]) {
    const a = rec(raw, "кривой агрегатор");
    if (typeof a.key !== "string" || !KEY.test(a.key) || typeof a.title !== "string" || !a.title) {
      bad("кривой агрегатор");
    }
    const scale = a.scale;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) bad("кривая шкала агрегатора");
    aggregators.push({ key: a.key as string, title: a.title as string, scale: scale as number });
  }
  const scaleOf = new Map(aggregators.map((a) => [a.key, a.scale]));
  const countries: Parsed["countries"] = [];
  for (const raw of b.countries as unknown[]) {
    const c = rec(raw, "кривая страна");
    const scores: Record<string, RawScore> = {};
    for (const [key, v] of Object.entries(rec(c.scores, "нет scores страны"))) {
      const s = rec(v, "кривая оценка агрегатора");
      const scale = scaleOf.get(key) ?? bad("оценка неизвестного агрегатора");
      const avg = s.avg === null
        ? null
        : typeof s.avg === "number" && s.avg >= 0 && s.avg <= scale
        ? s.avg
        : bad("оценка вне шкалы агрегатора");
      if (s.scale !== scale) bad("шкала оценки не совпадает со шкалой агрегатора");
      scores[key] = { avg, scale, votes: count(s.votes), pizzerias: count(s.pizzerias) };
    }
    const row = { cc: code(c.cc), as_of: c.as_of == null ? null : date(c.as_of, "кривая as_of"), scores };
    if (!allow || allow.has(row.cc)) countries.push(row);
  }
  return {
    on: date(b.on, "кривая on"),
    aggregators,
    countries,
    loaded_at: typeof b.loaded_at === "string" ? b.loaded_at : null,
  };
}

/** Ответы Децимуса на сегодня и на дату сравнения → наш формат. `prev` — null, когда срез сравнения
 * не получили: изменения тогда пустые, а сами оценки показываем. Агрегатор остаётся в списке, только
 * если он есть хотя бы у одной страны выборки. */
export function toAggregatorsView(body: unknown, prev: unknown | null, countries: string[] | null): AggregatorsView {
  const allow = countries ? new Set(countries) : null;
  const now = parse(body, allow);
  const before = prev == null ? null : parse(prev, allow);
  const prevAvg = new Map<string, number | null>();
  for (const c of before?.countries ?? []) {
    for (const [key, s] of Object.entries(c.scores)) prevAvg.set(`${c.cc}|${key}`, s.avg);
  }
  const used = new Set<string>();
  const out: AggregatorsCountry[] = now.countries.map((c) => {
    const scores: Record<string, AggregatorScore> = {};
    for (const [key, s] of Object.entries(c.scores)) {
      used.add(key);
      const was = prevAvg.get(`${c.cc}|${key}`) ?? null;
      scores[key] = { ...s, delta: s.avg == null || was == null ? null : round2(s.avg - was) };
    }
    return { cc: c.cc, as_of: c.as_of, scores };
  });
  return {
    on: now.on,
    compare: before?.on ?? null,
    aggregators: now.aggregators.filter((a) => used.has(a.key)),
    countries: out,
    loaded_at: now.loaded_at,
  };
}
