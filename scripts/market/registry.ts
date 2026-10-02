// Парсеры открытых выгрузок реестров. Эстония — ariregister (CC BY 4.0), Румыния — data.gov.ro
// (OGL-ROU / CC BY 4.0). Обе — один файл на всю страну; читаем построчно и берём только
// юрлица из конфига страны.
import type { RegistryYear } from "../../supabase/functions/market-ingest/types.ts";

const unq = (s: string | undefined) => (s ?? "").replace(/^"|"$/g, "");
const ddmmyyyy = (s: string) => s.split(".").reverse().join("-");

/** «Общие данные отчётов»: report_id → (рег. код, год). Из нескольких отчётов за год
 *  (исправления) берётся поданный последним. */
export function parseEeReports(
  lines: Iterable<string>,
  regIds: Set<string>,
): Map<string, { regId: string; year: number }> {
  const best = new Map<
    string,
    { id: string; filed: string; regId: string; year: number }
  >();
  for (const line of lines) {
    const c = line.split(";");
    const regId = unq(c[2]);
    if (!regIds.has(regId)) continue;
    const year = Number(unq(c[5])), filed = ddmmyyyy(unq(c[9]));
    const key = `${regId}:${year}`, cur = best.get(key);
    if (!cur || filed > cur.filed) {
      best.set(key, { id: unq(c[0]), filed, regId, year });
    }
  }
  return new Map(
    [...best.values()].map((b) => [b.id, { regId: b.regId, year: b.year }]),
  );
}

const EE_TAGS: Record<string, "revenue_eur" | "net_profit_eur" | "employees"> =
  {
    Revenue: "revenue_eur",
    TotalAnnualPeriodProfitLoss: "net_profit_eur",
    AverageNumberOfEmployeesInFullTimeEquivalentUnits: "employees",
  };
export function parseEeElements(
  lines: Iterable<string>,
  reports: Map<string, { regId: string; year: number }>,
): RegistryYear[] {
  const out = new Map<string, RegistryYear>();
  for (const line of lines) {
    const c = line.split(";");
    const rep = reports.get(c[0]);
    const field = EE_TAGS[unq(c[3])];
    if (!rep || !field) continue;
    const y = out.get(c[0]) ??
      {
        reg_id: rep.regId,
        year: rep.year,
        revenue_eur: null,
        net_profit_eur: null,
        employees: null,
        source: "https://avaandmed.ariregister.rik.ee",
      };
    y[field] = Number(unq(c[4]));
    out.set(c[0], y);
  }
  return [...out.values()];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
/** Строки «CUI,CAEN,I1..I20»: I13 — чистый оборот, I18 — чистая прибыль, I19 — чистый убыток,
 *  I20 — среднее число сотрудников. ronPerEur — среднегодовой курс ЕЦБ. */
export function parseRoBilant(
  lines: Iterable<string>,
  cuis: Set<string>,
  year: number,
  ronPerEur: number,
): RegistryYear[] {
  const out: RegistryYear[] = [];
  for (const line of lines) {
    const c = line.split(",");
    if (!cuis.has(c[0])) continue;
    const v = (
      i: number,
    ) => (c[i + 1] === "" || c[i + 1] === undefined ? null : Number(c[i + 1]));
    const turnover = v(13), profit = v(18) ?? 0, loss = v(19) ?? 0;
    out.push({
      reg_id: c[0],
      year,
      revenue_eur: turnover === null ? null : round2(turnover / ronPerEur),
      net_profit_eur: round2((profit - loss) / ronPerEur),
      employees: v(20),
      source: `https://data.gov.ro/dataset/situatii_financiare_${year}`,
    });
  }
  return out;
}

/** «3.061.881.000,00» → 3061881000. */
const cwNum = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Страница юрлица CompanyWall (данные APR и других реестров): строки «Ukupni prihodi» (общие
 *  доходы — шире выручки от продаж, это видно в пометке) и «Broj zaposlenih» за три последних
 *  поданных года. Номер MB на странице обязан совпасть с конфигом — иначе ссылка указывает не
 *  на ту фирму. Последний год, повторяющий предыдущий до копейки, — незаполненный год страницы
 *  (так у Glovoapp 2025), его нет. Прибыль не берём: её нет нигде в разделе. */
export function parseCompanyWall(
  html: string,
  regId: string,
  url: string,
  rate: (year: number) => number | null,
): RegistryYear[] {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ") // между «Preuzmi» и годами на живой странице стоит &nbsp;
    .replace(/\s+/g, " ");
  const mb = text.match(/\bMB (\d{8})\b/)?.[1];
  if (mb !== regId) {
    throw new Error(
      `companywall: на странице MB ${
        mb ?? "не найден"
      }, в конфиге ${regId} (${url})`,
    );
  }
  const NUM = "[\\d.]+,\\d{2}";
  const income = text.match(
    new RegExp(`Preuzmi ((?:\\d{4} ?)+) Ukupni prihodi ((?:${NUM} ?)+)`),
  );
  if (!income) {
    throw new Error(`companywall: нет строки «Ukupni prihodi» (${url})`);
  }
  const years = income[1].trim().split(" ").map(Number);
  const values = income[2].trim().split(" ").map(cwNum);
  const staff =
    text.match(new RegExp(`Broj zaposlenih ((?:${NUM} ?)+)`))?.[1]?.trim()
      .split(" ").map(cwNum) ?? [];
  const out: RegistryYear[] = [];
  years.forEach((year, i) => {
    const v = values[i];
    if (i > 0 && i === years.length - 1 && v === values[i - 1]) return;
    const fx = rate(year);
    out.push({
      reg_id: regId,
      year,
      revenue_eur: v && fx ? Math.round(v / fx) : null,
      net_profit_eur: null,
      employees: staff[i] ? Math.round(staff[i]) : null,
      source: `${url} — Ukupni prihodi (общие доходы, APR)`,
    });
  });
  return out;
}
