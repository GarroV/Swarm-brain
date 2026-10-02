// Еженедельный сбор «Анализа рынка»: для каждой страны отправляет описание (конфиг), затем
// данные каждого авто-источника, чей срок подошёл. Запуск: GitHub Actions market-collect.yml.
//   deno run -A scripts/market/run.ts [--country HR,RO] [--source osm-overpass] [--since 2026-09-01] [--dry-run]
// --dry-run собирает, но не отправляет: печатает, что ушло бы. Код выхода 1, если сбоил хоть
// один источник (сбой записан в журнал запусков, страница покажет его возраст).
import { parseArgs } from "@std/cli/parse-args";
import type { IngestPayload } from "../../supabase/functions/market-ingest/types.ts";
import { ADAPTERS } from "./adapters/index.ts";
import { COUNTRIES } from "./countries/index.ts";
import type { CountryConfig } from "./countries/types.ts";
import { postIngest } from "./lib.ts";

/** Месячные и годовые источники гоняем в первую неделю месяца: выгрузки реестров тяжёлые
 *  и обновляются редко, а повторный прогон ничего не ломает (без изменений — «unchanged»). */
export function isDue(cadence: string, today: string): boolean {
  if (cadence === "weekly") return true;
  if (cadence === "monthly" || cadence === "yearly") {
    return Number(today.slice(8, 10)) <= 7;
  }
  return false;
}

export function dueAdapters(
  cfg: CountryConfig,
  today: string,
  only?: string,
): string[] {
  const auto = cfg.sources.filter((s) => s.mode === "auto");
  const ids = only
    ? auto.filter((s) => s.adapter === only).map((s) => s.adapter)
    : auto.filter((s) => isDue(s.cadence, today)).map((s) => s.adapter);
  return [...new Set(ids)];
}

function summary(p: IngestPayload): string {
  if ("failed" in p) return `СБОЙ: ${p.failed}`;
  if (p.source === "dodo") {
    return `units=${p.units.length} days=${p.days.length} revenue=${
      p.revenue?.month ?? "—"
    }`;
  }
  if (p.source === "osm") return `points=${p.points.length}`;
  if (p.source === "registry") {
    return `years=${p.years.length} ` +
      p.years.map((y) =>
        `${y.reg_id}/${y.year}: rev=${y.revenue_eur} np=${y.net_profit_eur} emp=${y.employees}`
      ).join("; ");
  }
  return "";
}

async function runCountry(
  cfg: CountryConfig,
  args: { source?: string; since?: string; dry: boolean; today: string },
) {
  let failed = 0;
  const send = async (p: IngestPayload) => {
    if (args.dry) return;
    try {
      console.log(`  → ${JSON.stringify(await postIngest(p))}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ отправка: ${e}`);
    }
  };
  const started_at = new Date().toISOString();
  await send({
    country: cfg.country,
    started_at,
    source: "config",
    chains: cfg.chains.map(({ key, name, segment, bakery }) => ({
      key,
      name,
      segment,
      bakery,
    })),
    companies: cfg.companies,
    sources: cfg.sources,
  });
  for (const id of dueAdapters(cfg, args.today, args.source)) {
    const adapter = ADAPTERS[id];
    if (!adapter) {
      console.error(`${cfg.country} ${id}: адаптер не найден`);
      failed++;
      continue;
    }
    const p = await adapter.collect(cfg, {
      since: args.since,
      today: args.today,
    });
    console.log(`${cfg.country} ${id}: ${summary(p)}`);
    if ("failed" in p) failed++;
    await send(p);
  }
  return failed;
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, {
    string: ["country", "source", "since"],
    boolean: ["dry-run"],
  });
  const today = new Date().toISOString().slice(0, 10);
  const ccs = a.country
    ? a.country.toUpperCase().split(",")
    : Object.keys(COUNTRIES);
  let failed = 0;
  for (const cc of ccs) {
    const cfg = COUNTRIES[cc];
    if (!cfg) {
      console.error(`${cc}: нет конфига в scripts/market/countries`);
      failed++;
      continue;
    }
    failed += await runCountry(cfg, {
      source: a.source,
      since: a.since,
      dry: a["dry-run"],
      today,
    });
  }
  if (failed) {
    console.error(`сбоев: ${failed}`);
    Deno.exit(1);
  }
}
