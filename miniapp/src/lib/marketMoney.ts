// Таблица «Выручки операторов» по правилам эталона: годы с 2021 по последний год отчётности,
// число в € млн, звёздочка у пересчитанного значения, среднегодовой рост от первой выручки,
// спарклайн и подбор юрлиц под строки ручной части (editorial.money_rows).
import type { MarketCompany, MarketFinancial } from "../types.ts";

export const MONEY_FIRST_YEAR = 2021;

/** Годы таблицы: с первого года эталона по последний год, за который есть отчётность. */
export function moneyYears(financials: Array<Pick<MarketFinancial, "year" | "revenue_eur">>, thisYear: number, first = MONEY_FIRST_YEAR): number[] {
  const last = Math.max(...financials.filter((f) => f.revenue_eur !== null && f.year <= thisYear).map((f) => f.year), -Infinity);
  if (!Number.isFinite(last) || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** f() эталона: от 10 млн — один знак, меньше — два. Ненулевое меньше 5 тыс. — «<0,01», а не ноль. */
export function fmtMln(v: number | null, ru: boolean): string | null {
  if (v === null) return null;
  const m = v / 1e6;
  const s = m > 0 && m < 0.005 ? "<0.01" : m >= 10 ? m.toFixed(1) : m.toFixed(2);
  return ru ? s.replace(".", ",") : s;
}

// Пометка пересчёта в записи ресерча («DERIVED from … YoY», «~»).
const DERIVED = /DERIVED|~/;
/** Звёздочка эталона: год перед последним годом отчётности пересчитан из прироста последнего года. */
export function isDerived(f: Pick<MarketFinancial, "year" | "note" | "source"> | undefined, lastYear: number): boolean {
  return !!f && f.year === lastYear - 1 && DERIVED.test(`${f.note ?? ""} ${f.source ?? ""}`);
}

/** Точки спарклайна 80×22 эталона: шаг по годам на ширину 80, высота 18 от минимума к максимуму. */
export function sparkPoints(rev: Array<number | null>, width = 80): Array<[number, number]> {
  const pts = rev.map((x, i) => (x ? [i, x] as [number, number] : null)).filter((p): p is [number, number] => p !== null);
  if (pts.length < 2) return [];
  const mx = Math.max(...pts.map((p) => p[1])), mn = Math.min(...pts.map((p) => p[1]));
  const step = width / Math.max(rev.length - 1, 1);
  return pts.map(([i, x]) => [i * step, 20 - ((x - mn) / (mx - mn || 1)) * 18]);
}

export type MoneyRowPick = { company: MarketCompany; name: string; chains: string[] | null };

/** Строки ручной части → юрлица: название сети или юрлица начинается с префикса строки, иначе
 *  юрлицо одной из сетей строки. Юрлица без отчётности и ненайденные строки пропускаются. */
export function pickMoneyRows(
  rows: Array<{ prefix: string; chains: string[] | null; company?: string | null }>,
  companies: MarketCompany[],
  chainName: (key: string | null) => string | null,
  hasFinancials: (companyId: string) => boolean,
): MoneyRowPick[] {
  const pool = companies.filter((c) => hasFinancials(c.id));
  return rows.flatMap((r) => {
    const byCompany = r.company ? pool.find((c) => c.reg_id === r.company || c.name.startsWith(r.company!)) : undefined;
    const byName = byCompany ?? pool.find((c) => (chainName(c.chain_key) ?? "").startsWith(r.prefix) || c.name.startsWith(r.prefix));
    const company = byName ?? (r.chains ? pool.find((c) => c.chain_key !== null && r.chains!.includes(c.chain_key)) : undefined);
    if (!company) return [];
    return [{ company, name: (byCompany ? r.prefix : chainName(company.chain_key) ?? r.prefix).replace(/\s*\(.*\)/, ""), chains: r.chains }];
  });
}
