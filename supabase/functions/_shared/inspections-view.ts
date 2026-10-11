// Ответы Децимуса GET /api/v1/inspections и /api/v1/inspections/<id> → формат GET /inspections[/:id].
// Чистый модуль под тестом (inspections-view.test.ts): проверки читаются на экране и в ответах
// Claude как факт. Персональных данных в ответах Децимуса нет, и мы их не добавляем.

export type PrevInspection = { id: string; date: string; score_pct: number; grade: string | null };
export type Inspection = {
  id: string;
  unit: { id: string; dodo_id: string | null; name: string; cc: string };
  date: string;
  kind: string | null;
  score_pct: number;
  grade: string | null;
  path: string;
  previous: PrevInspection | null;
};
export type InspectionsView = { inspections: Inspection[]; truncated: boolean };
export type InspectionZone = { zone: string; title_ru: string | null; title_en: string | null; pct: number };
export type InspectionFinding = {
  n: number;
  code: string;
  title_ru: string | null;
  title_en: string | null;
  level: string;
  zone: string;
  text: string | null;
  repeat: boolean;
};
export type InspectionDetail = {
  inspection: Inspection & { deductions: number; counts: Record<string, number>; zones: InspectionZone[] };
  findings: InspectionFinding[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (what: string): never => {
  throw new Error(`decimus: ${what}`);
};
const rec = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad(what);
const uuid = (v: unknown, what: string): string => typeof v === "string" && UUID.test(v) ? v.toLowerCase() : bad(what);
const date = (v: unknown, what: string): string => typeof v === "string" && DATE.test(v) ? v : bad(what);
const pct = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : bad(what);
const str = (v: unknown, what: string): string => typeof v === "string" && v ? v : bad(what);
const strOrNull = (v: unknown, what: string): string | null => v == null ? null : typeof v === "string" ? v : bad(what);
const code = (v: unknown): string => {
  const cc = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(cc) ? cc : bad("кривой код страны");
};
const countOf = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : bad(what);

function previous(v: unknown): PrevInspection | null {
  if (v == null) return null; // старый Децимус поля не отдаёт
  const p = rec(v, "кривая previous");
  return {
    id: uuid(p.id, "кривой id previous"),
    date: date(p.date, "кривая дата previous"),
    score_pct: pct(p.score_pct, "процент previous вне 0–100"),
    grade: strOrNull(p.grade, "кривой класс previous"),
  };
}

function inspection(raw: unknown): Inspection {
  const r = rec(raw, "кривая проверка");
  const u = rec(r.unit, "нет unit проверки");
  return {
    id: uuid(r.id, "кривой id проверки"),
    unit: {
      id: str(u.id, "кривой id пиццерии"),
      dodo_id: strOrNull(u.dodo_id, "кривой dodo_id"),
      name: str(u.name, "нет названия пиццерии"),
      cc: code(u.cc),
    },
    date: date(r.date, "кривая дата проверки"),
    kind: strOrNull(r.kind, "кривой вид проверки"),
    score_pct: pct(r.score_pct, "процент проверки вне 0–100"),
    grade: strOrNull(r.grade, "кривой класс проверки"),
    path: typeof r.path === "string" && r.path.startsWith("/") ? r.path : bad("кривой path"),
    previous: previous(r.previous),
  };
}

const allowed = (countries: string[] | null) => {
  const set = countries ? new Set(countries) : null;
  return (cc: string) => !set || set.has(cc);
};

/** Список проверок → наш формат: новые первыми. Кривое поле — ошибка, в том числе в строках вне разрешённых стран. */
export function toInspectionsView(body: unknown, countries: string[] | null): InspectionsView {
  const b = rec(body, "ответ не объект");
  if (!Array.isArray(b.inspections)) bad("нет inspections");
  const ok = allowed(countries);
  const rows = (b.inspections as unknown[]).map(inspection).filter((r) => ok(r.unit.cc));
  rows.sort((x, y) => y.date.localeCompare(x.date));
  return { inspections: rows, truncated: b.truncated === true };
}

function zone(raw: unknown): InspectionZone {
  const z = rec(raw, "кривая зона");
  return {
    zone: str(z.zone, "нет кода зоны"),
    title_ru: strOrNull(z.title_ru, "кривое название зоны"),
    title_en: strOrNull(z.title_en, "кривое название зоны"),
    pct: pct(z.pct, "процент зоны вне 0–100"),
  };
}

function finding(raw: unknown): InspectionFinding {
  const f = rec(raw, "кривое нарушение");
  return {
    n: typeof f.n === "number" && Number.isInteger(f.n) && f.n >= 1 ? f.n : bad("кривой номер нарушения"),
    code: str(f.code, "нет кода пункта"),
    title_ru: strOrNull(f.title_ru, "кривое название пункта"),
    title_en: strOrNull(f.title_en, "кривое название пункта"),
    level: str(f.level, "нет класса нарушения"),
    zone: str(f.zone, "нет зоны нарушения"),
    text: strOrNull(f.text, "кривой текст нарушения"),
    repeat: f.repeat === true,
  };
}

/** Деталь проверки → наш формат; null — проверка вне стран воркспейса (вызывающий отвечает 404, как на «нет такой»). */
export function toInspectionDetail(body: unknown, countries: string[] | null): InspectionDetail | null {
  const b = rec(body, "ответ не объект");
  const raw = rec(b.inspection, "нет inspection");
  const base = inspection(raw);
  if (!Array.isArray(raw.zones) || !Array.isArray(b.findings)) bad("нет zones/findings");
  const countsRaw = rec(raw.counts, "нет counts");
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsRaw)) counts[k] = countOf(v, "кривой счётчик нарушений");
  const deductions = typeof raw.deductions === "number" && Number.isFinite(raw.deductions) && raw.deductions >= 0
    ? raw.deductions
    : bad("кривые вычеты");
  const zones = (raw.zones as unknown[]).map(zone);
  const findings = (b.findings as unknown[]).map(finding).sort((x, y) => x.n - y.n);
  if (!allowed(countries)(base.unit.cc)) return null;
  return { inspection: { ...base, deductions, counts, zones }, findings };
}
