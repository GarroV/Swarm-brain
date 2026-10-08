// Слой базы баллов РС и РКО (таблица quality_scores, миграция 20261008200000): запись разобранного
// листа, чтение для экрана и сводка для MCP. Доступ (кто пишет, какие страны видит) решает
// вызывающий — здесь его нет.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allRows, must } from "../market/db.ts";
import type { ParsedSheet, QualityKind } from "./sheet.ts";
import { staleKeys, type StoredKey } from "./scope.ts";
import { buildQualityView, type QualityView, type StoredScore } from "./view.ts";

const CHUNK = 500;

export type ImportResult = { upserted: number; removed: number };

/** Upsert по ключу (kind, unit_id, period_start), затем удаление исчезнувших баллов в границах
 *  загруженного листа (scope.ts). Два шага не атомарны: упавшее удаление оставит лишние старые
 *  баллы, а не потеряет новые, и повторная загрузка того же листа доводит до конца. */
export async function importParsed(sb: SupabaseClient, parsed: ParsedSheet, by: number): Promise<ImportResult> {
  const at = new Date().toISOString();
  const rows = parsed.scores.map((s) => ({ ...s, kind: parsed.kind, imported_at: at, imported_by: by }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await must(
      sb.from("quality_scores").upsert(rows.slice(i, i + CHUNK), { onConflict: "kind,unit_id,period_start" }),
      "quality_scores upsert",
    );
  }
  if (!parsed.sheetUnits.length || !parsed.periods.length) return { upserted: rows.length, removed: 0 };
  const existing = await allRows<StoredKey>(
    (a, b) =>
      // Без .in(unit_id): две сотни id в адресе запроса упираются в предел длины строки шлюза.
      // Лишние пиццерии отсечёт staleKeys; страны режем и здесь, и там.
      sb.from("quality_scores").select("unit_id, period_start, country_code").eq("kind", parsed.kind)
        .in("country_code", parsed.countries)
        .gte("period_start", parsed.periods[0].start)
        .lte("period_start", parsed.periods.at(-1)!.start).order("unit_id").order("period_start").range(a, b),
    "quality_scores scope",
  );
  const stale = staleKeys(existing, parsed);
  const unitCc = new Map(parsed.sheetUnits.map((u) => [u.id, u.cc]));
  const byUnit = new Map<string, string[]>();
  for (const c of stale) byUnit.set(c.unit_id, [...(byUnit.get(c.unit_id) ?? []), c.period_start]);
  for (const [unit, starts] of byUnit) {
    await must(
      sb.from("quality_scores").delete().eq("kind", parsed.kind).eq("unit_id", unit).eq(
        "country_code",
        unitCc.get(unit)!,
      )
        .in("period_start", starts),
      "quality_scores delete",
    );
  }
  return { upserted: rows.length, removed: stale.length };
}

/** Баллы для экрана. `countries` — открытые воркспейсу страны; null — все. */
export async function loadQuality(
  sb: SupabaseClient,
  kind: QualityKind,
  countries: string[] | null,
): Promise<QualityView> {
  if (countries && !countries.length) return buildQualityView(kind, []);
  const rows = await allRows<StoredScore>((a, b) => {
    let q = sb.from("quality_scores")
      .select("unit_id, unit_name, country_code, developer, period_start, period_end, score").eq("kind", kind);
    if (countries) q = q.in("country_code", countries);
    return q.order("period_start").order("unit_id").range(a, b);
  }, "quality_scores");
  return buildQualityView(kind, rows);
}

export type KindStatus = {
  kind: QualityKind;
  lastImport: string | null;
  latestPeriod: string | null;
  unitsByCountry: Record<string, number>;
};

export async function qualityStatus(
  sb: SupabaseClient,
  kind: QualityKind,
  countries: string[] | null,
): Promise<KindStatus> {
  const empty = { kind, lastImport: null, latestPeriod: null, unitsByCountry: {} };
  if (countries && !countries.length) return empty;
  const rows = await allRows<{ unit_id: string; country_code: string; period_start: string; imported_at: string }>(
    (a, b) => {
      let q = sb.from("quality_scores").select("unit_id, country_code, period_start, imported_at").eq("kind", kind);
      if (countries) q = q.in("country_code", countries);
      return q.order("unit_id").order("period_start").range(a, b);
    },
    "quality_scores status",
  );
  const units = new Map<string, Set<string>>();
  let lastImport: string | null = null;
  let latestPeriod: string | null = null;
  for (const r of rows) {
    const cc = r.country_code.trim();
    const set = units.get(cc) ?? new Set<string>();
    set.add(r.unit_id);
    units.set(cc, set);
    if (!lastImport || r.imported_at > lastImport) lastImport = r.imported_at;
    if (!latestPeriod || r.period_start > latestPeriod) latestPeriod = r.period_start;
  }
  if (!rows.length) return empty;
  const unitsByCountry = Object.fromEntries([...units.entries()].sort().map(([cc, s]) => [cc, s.size]));
  return { kind, lastImport, latestPeriod, unitsByCountry };
}

/** Сколько id пиццерий класть в один запрос: две сотни id в адресе упираются в предел длины
 *  строки шлюза, по 50 — около 1,7 КБ. */
const ID_BATCH = 50;

/** Под какими странами пиццерии листа уже лежат в базе (оба вида рейтинга) — для проверки
 *  «лист не переносит чужую пиццерию» (scope.ts unitMoves). Повторы схлопнуты. */
export async function storedUnitCountries(
  sb: SupabaseClient,
  unitIds: string[],
): Promise<{ unit_id: string; country_code: string }[]> {
  const out = new Map<string, { unit_id: string; country_code: string }>();
  for (let i = 0; i < unitIds.length; i += ID_BATCH) {
    const rows = await allRows<{ unit_id: string; country_code: string }>(
      (a, b) =>
        sb.from("quality_scores").select("unit_id, country_code").in("unit_id", unitIds.slice(i, i + ID_BATCH))
          .order("unit_id").order("kind").order("period_start").range(a, b),
      "quality_scores units",
    );
    for (const r of rows) out.set(`${r.unit_id}|${r.country_code.trim()}`, r);
  }
  return [...out.values()];
}
