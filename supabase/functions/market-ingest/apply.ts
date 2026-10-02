// Применение данных сборщиков «Анализа рынка». Правила — спека §«Правила сборщиков»:
// Dodo — истина для своих точек; OSM только предлагает; реестр не перезаписывает проверенное;
// неудачный запуск пишется в журнал и больше ничего не меняет.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchPoints, samePlace } from "../_shared/market/geo.ts";
import { foldDailyOrders, shouldFlagClosed, toEur } from "../_shared/market/rules.ts";
import { allRows, ID_BATCH, locKey, must, recordRun } from "../_shared/market/db.ts";
import { TRUSTED, type Verification } from "../_shared/market/types.ts";
import type { DodoUnit, IngestPayload, OsmPoint, RegistryYear } from "./types.ts";

type Stats = Record<string, number>;
const now = () => new Date().toISOString();
/** Источник в журнале → адаптер в mkt_sources (у реестров адаптер приходит в нагрузке). */
const ADAPTER_OF: Record<string, string> = {
  osm: "osm-overpass",
  dodo: "dodo-publicapi",
};

/** Один открытый кандидат на одну находку: повторный прогон недели не плодит дубли.
 *  Частичный уникальный индекс mkt_candidates_pending_once страхует от гонки двух прогонов. */
async function propose(
  sb: SupabaseClient,
  row: Record<string, unknown> & {
    payload: { key: string; [k: string]: unknown };
  },
) {
  const { data, error } = await sb.from("mkt_candidates").select("id")
    .eq("country", row.country as string).eq("kind", row.kind as string).eq(
      "status",
      "pending",
    )
    .eq("payload->>key", row.payload.key).limit(1);
  if (error) throw new Error(`candidate lookup: ${error.message}`);
  if (data?.length) return;
  const ins = await sb.from("mkt_candidates").insert(row);
  if (ins.error && ins.error.code !== "23505") {
    throw new Error(`candidate: ${ins.error.message}`);
  }
}

export async function applyIngest(
  sb: SupabaseClient,
  p: IngestPayload,
  today: string,
): Promise<Stats> {
  const country = p.country.toUpperCase();
  const adapter = ("adapter" in p && p.adapter) || ADAPTER_OF[p.source] ||
    p.source;
  if ("failed" in p) {
    await recordRun(sb, {
      source: adapter,
      country,
      status: "failed",
      started_at: p.started_at,
      stats: {},
      error: p.failed,
    });
    return {};
  }
  try {
    let stats: Stats = {};
    if (p.source === "config") stats = await applyConfig(sb, country, p);
    else if (p.source === "osm") stats = await applyOsm(sb, country, p.points);
    else if (p.source === "dodo") {
      stats = await applyDodo(sb, country, p, today);
    } else if (p.source === "registry") {
      stats = await applyRegistry(sb, country, p.years);
    }
    if (p.source !== "config") {
      await recordRun(sb, {
        source: adapter,
        country,
        status: "ok",
        started_at: p.started_at,
        stats,
        error: null,
      });
      await must(
        sb.from("mkt_sources").update({ last_ok_at: now() }).eq(
          "country",
          country,
        ).eq("adapter", adapter),
        "source stamp",
      );
    }
    return stats;
  } catch (e) {
    await recordRun(sb, {
      source: adapter,
      country,
      status: "failed",
      started_at: p.started_at,
      stats: {},
      error: String(e),
    });
    throw e;
  }
}

async function applyConfig(
  sb: SupabaseClient,
  country: string,
  p: Extract<IngestPayload, { source: "config" }>,
) {
  await must(
    sb.from("mkt_chains").upsert(
      p.chains.map((c, i) => ({
        country,
        key: c.key,
        name: c.name,
        segment: c.segment,
        is_bakery: c.bakery ?? false,
        slot: c.slot ?? i + 1,
        updated_at: now(),
      })),
      { onConflict: "country,key" },
    ),
    "config chains",
  );
  for (const co of p.companies) {
    await must(
      sb.from("mkt_companies").upsert({
        country,
        chain_key: co.chain,
        name: co.name,
        reg_id: co.regId,
      }, {
        onConflict: "country,name",
      }),
      "config company",
    );
  }
  // last_ok_at не трогаем: его ставит успешный запуск адаптера, а не описание источника.
  await must(
    sb.from("mkt_sources").upsert(
      p.sources.map((s) => ({
        country,
        adapter: s.adapter,
        chain_key: s.chain ?? "",
        feeds: s.feeds,
        cadence: s.cadence,
        mode: s.mode,
        reason: s.reason ?? null,
      })),
      { onConflict: "country,adapter,chain_key,feeds" },
    ),
    "config sources",
  );
  return {
    chains: p.chains.length,
    companies: p.companies.length,
    sources: p.sources.length,
  };
}

type ExistingLoc = {
  id: string;
  chain_key: string;
  ext_key: string;
  lat: number;
  lng: number;
  address?: string | null;
  status?: string;
  verification: Verification;
  source_kind: string;
  missing_weeks: number;
};

/** Находки «новая точка», висящие с прежних прогонов (очередь была до автоприёма; у Хорватии
 *  они пришли до импорта снимка), закрывает полный прогон OSM: добавленная им → accepted,
 *  остальные (точка уже известна или пропала из OSM) → rejected. decided_by 0 — сборщик. */
async function closeStaleFinds(
  sb: SupabaseClient,
  country: string,
  added: Set<string>,
) {
  const pending = await allRows<{ id: string; payload: { key?: string } }>(
    (from, to) =>
      sb.from("mkt_candidates").select("id, payload").eq("country", country)
        .eq("kind", "new_location").eq("status", "pending").order("id")
        .range(from, to),
    "osm stale finds",
  );
  for (const status of ["accepted", "rejected"] as const) {
    const ids = pending.filter((c) => added.has(String(c.payload.key)) === (status === "accepted")).map((c) => c.id);
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      await must(
        sb.from("mkt_candidates").update({
          status,
          decided_by: 0,
          decided_at: now(),
        }).in("id", ids.slice(i, i + ID_BATCH)),
        "osm stale decide",
      );
    }
  }
}

async function applyOsm(
  sb: SupabaseClient,
  country: string,
  points: OsmPoint[],
): Promise<Stats> {
  const chains = [...new Set(points.map((x) => x.chain))];
  const existing = chains.length
    ? await allRows<ExistingLoc>(
      (from, to) =>
        sb.from("mkt_locations")
          .select(
            "id, chain_key, ext_key, lat, lng, address, status, verification, source_kind, missing_weeks",
          )
          .eq("country", country).in("chain_key", chains)
          .order("id").range(from, to),
      "osm existing",
    )
    : [];
  const all = existing.map((e) => ({ ...e, chain: e.chain_key }));
  const live = all.filter((e) => e.status !== "closed");
  // Одно место в OSM часто нарисовано дважды (узлом и контуром здания). Второй объект не находит
  // пары и раньше вставал отдельной точкой рядом с проверенной (Хорватия 02.10.2026: дубли в
  // 8–24 м от точек снимка). Такие «зеркала» — машинные строки без ручных правок — убираются.
  const isMirror = (e: typeof all[number]) =>
    e.source_kind === "osm" && e.verification === "unverified" &&
    samePlace(e, live.filter((x) => x.source_kind !== "osm"));
  const mirrors = live.filter(isMirror).map((e) => e.id);
  for (let i = 0; i < mirrors.length; i += ID_BATCH) {
    await must(
      sb.from("mkt_locations").delete().in("id", mirrors.slice(i, i + ID_BATCH)),
      "osm mirrors",
    );
  }
  const r = matchPoints(live.filter((e) => !mirrors.includes(e.id)), points);
  const seen = r.matched.map((m) => m.existing.id);
  for (let i = 0; i < seen.length; i += ID_BATCH) {
    await must(
      sb.from("mkt_locations").update({ last_seen_at: now(), missing_weeks: 0 })
        .in("id", seen.slice(i, i + ID_BATCH)),
      "osm seen",
    );
  }
  // Город OSM только дописывает пустое поле: известный город (из снимка, локатора, руки) не меняется.
  for (const m of r.matched.filter((m) => m.found.city)) {
    await must(
      sb.from("mkt_locations").update({ city: m.found.city })
        .eq("id", m.existing.id).is("city", null),
      "osm city",
    );
  }
  // Новая точка OSM встаёт сразу, как «не проверено» (решение владельца 02.10.2026: полный
  // автомат). Вставка без перезаписи: точка с тем же ключом, закрытая или поправленная руками,
  // остаётся как есть.
  const added = new Set<string>();
  // Находка рядом с уже известной точкой той же сети (в т.ч. закрытой) — второй объект того же
  // места, а не новая точка.
  const fresh = r.unmatched.filter((f) => !samePlace(f, all));
  const rows = fresh.map((f) => {
    const key = locKey(f.chain, f.lat, f.lng, f.address);
    added.add(key);
    return {
      country,
      chain_key: f.chain,
      ext_key: key,
      name: f.name,
      city: f.city,
      address: f.address,
      lat: f.lat,
      lng: f.lng,
      status: "open",
      source: `https://www.openstreetmap.org/${f.osm_id}`,
      source_kind: "osm",
      verification: "unverified",
      last_seen_at: now(),
    };
  });
  for (let i = 0; i < rows.length; i += ID_BATCH) {
    await must(
      sb.from("mkt_locations").upsert(rows.slice(i, i + ID_BATCH), {
        onConflict: "country,ext_key",
        ignoreDuplicates: true,
      }),
      "osm add",
    );
  }
  await closeStaleFinds(sb, country, added);
  // Пропажа из OSM двигает только точки, которые привёл сам OSM, — проверенные не трогаются.
  let flagged = 0;
  for (const e of r.missing.filter((m) => m.source_kind === "osm")) {
    const weeks = e.missing_weeks + 1;
    await must(
      sb.from("mkt_locations").update({ missing_weeks: weeks }).eq("id", e.id),
      "osm missing",
    );
    if (
      shouldFlagClosed({
        verification: e.verification,
        source_kind: e.source_kind,
        missing_weeks: weeks,
      })
    ) {
      await propose(sb, {
        country,
        kind: "maybe_closed",
        source: "osm",
        target_id: e.id,
        payload: { key: e.ext_key },
      });
      flagged++;
    }
  }
  return {
    points: points.length,
    matched: r.matched.length,
    new_candidates: fresh.length,
    maybe_closed: flagged,
  };
}

/** Точка Dodo, заведённая раньше не из API (ручной снимок: ключ по координатам и адресу),
 *  и пиццерия из API — одна и та же, если ближе MATCH_RADIUS_M. Такую точку переводим на
 *  ключ API, и upsert ниже обновляет её, а не заводит двойника (поймано на стенде 02.10.2026:
 *  у каждой пиццерии Загреба было по две записи). */
const LOC_KEY = /^dodo:-?\d+\.\d{4}:-?\d+\.\d{4}:/;
async function adoptKnownDodoPoints(
  sb: SupabaseClient,
  country: string,
  units: Array<DodoUnit & { lat: number; lng: number }>,
) {
  if (!units.length) return;
  const known = await must<Array<{ id: string; ext_key: string; lat: number; lng: number }>>(
    sb.from("mkt_locations").select("id, ext_key, lat, lng").eq("country", country).eq("chain_key", "dodo"),
    "dodo known",
  );
  // Ключ снимка — locKey: «dodo:<lat4>:<lng4>:<адрес>»; ключ API — «dodo:<имя пиццерии>».
  const legacy = known.filter((k) => LOC_KEY.test(k.ext_key));
  const taken = new Set(known.map((k) => k.ext_key));
  const fresh = units.filter((u) => !taken.has(`dodo:${u.name}`));
  const r = matchPoints(
    legacy.map((k) => ({ ...k, chain: "dodo" })),
    fresh.map((u) => ({ ...u, chain: "dodo" })),
  );
  for (const m of r.matched) {
    await must(
      sb.from("mkt_locations").update({ ext_key: `dodo:${m.found.name}` }).eq("id", m.existing.id),
      "dodo adopt",
    );
  }
}

async function applyDodo(
  sb: SupabaseClient,
  country: string,
  p: Extract<IngestPayload, { source: "dodo" }>,
  today: string,
): Promise<Stats> {
  await must(
    sb.from("mkt_chains").upsert({
      country,
      key: "dodo",
      name: "Dodo Pizza",
      segment: "pizza",
    }, {
      onConflict: "country,key",
      ignoreDuplicates: true,
    }),
    "dodo chain",
  );
  const withCoords = p.units.filter((u) => u.lat !== null && u.lng !== null);
  await adoptKnownDodoPoints(sb, country, withCoords as Array<DodoUnit & { lat: number; lng: number }>);
  if (withCoords.length) {
    await must(
      sb.from("mkt_locations").upsert(
        withCoords.map((u) => ({
          country,
          chain_key: "dodo",
          ext_key: `dodo:${u.name}`,
          name: `Dodo Pizza ${u.name}`,
          city: u.city,
          address: u.address,
          lat: u.lat,
          lng: u.lng,
          opened: u.opened,
          status: u.open ? "open" : "closed",
          source: "https://publicapi.dodois.io",
          source_kind: "dodo",
          verification: "internal",
          verification_note: u.organization,
          last_seen_at: now(),
          missing_weeks: 0,
        })),
        { onConflict: "country,ext_key" },
      ),
      "dodo units",
    );
  }
  for (const month of [...new Set(p.days.map((d) => d.date.slice(0, 7)))]) {
    await mergeMonthDays(
      sb,
      country,
      month,
      p.days.filter((d) => d.date.startsWith(month)),
      today,
    );
  }
  if (p.revenue) {
    await must(
      sb.from("mkt_dodo_monthly").upsert({
        country,
        month: p.revenue.month,
        revenue_local: p.revenue.amount,
        currency: p.revenue.currency,
        // Без курса месяца евро не выдумываем: пусто, а не сумма в леях под видом евро.
        revenue_eur: toEur(
          p.revenue.amount,
          p.revenue.currency,
          p.revenue.rates ?? {},
        ),
        units: p.revenue.units,
        updated_at: now(),
      }, { onConflict: "country,month" }),
      "dodo revenue",
    );
  }
  return {
    units: p.units.length,
    no_coords: p.units.length - withCoords.length,
    days: p.days.length,
  };
}

/** Дни храним внутри месяца (orders._days) и сумму каналов пересчитываем из них:
 *  повторная отправка той же недели не удваивает месяц. */
async function mergeMonthDays(
  sb: SupabaseClient,
  country: string,
  month: string,
  days: Array<{ date: string; counts: Record<string, number> }>,
  today: string,
) {
  const { data: cur, error } = await sb.from("mkt_dodo_monthly").select(
    "orders",
  ).eq("country", country)
    .eq("month", month).maybeSingle();
  if (error) throw new Error(`dodo month: ${error.message}`);
  const stored = (cur?.orders as { _days?: Record<string, Record<string, number>> } | null)
    ?._days ?? {};
  const merged = {
    ...stored,
    ...Object.fromEntries(days.map((d) => [d.date, d.counts])),
  };
  const [folded] = foldDailyOrders(
    Object.entries(merged).map(([date, counts]) => ({ date, counts })),
    today,
  );
  await must(
    sb.from("mkt_dodo_monthly").upsert({
      country,
      month,
      orders: { ...folded.orders, _days: merged },
      complete: folded.complete,
      updated_at: now(),
    }, { onConflict: "country,month" }),
    "dodo orders",
  );
}

type FinRow = {
  revenue_eur: number | null;
  net_profit_eur: number | null;
  employees: number | null;
  verification: string;
};
const n = (
  v: number | string | null | undefined,
): number | null => (v === null || v === undefined ? null : Number(v));
const sameNumbers = (cur: FinRow, y: RegistryYear): boolean =>
  n(cur.revenue_eur) === n(y.revenue_eur) &&
  n(cur.net_profit_eur) === n(y.net_profit_eur) &&
  n(cur.employees) === n(y.employees);

async function applyRegistry(
  sb: SupabaseClient,
  country: string,
  years: RegistryYear[],
): Promise<Stats> {
  const companies = await must<Array<{ id: string; reg_id: string }>>(
    sb.from("mkt_companies").select("id, reg_id").eq("country", country).not(
      "reg_id",
      "is",
      null,
    ),
    "reg companies",
  );
  const byReg = new Map(companies.map((c) => [c.reg_id, c.id]));
  const stats = {
    years: years.length,
    written: 0,
    proposed: 0,
    unchanged: 0,
    unknown_companies: 0,
  };
  for (const y of years) {
    const company_id = byReg.get(y.reg_id);
    if (!company_id) {
      stats.unknown_companies++;
      continue;
    }
    const { data: cur, error } = await sb.from("mkt_financials")
      .select("revenue_eur, net_profit_eur, employees, verification")
      .eq("company_id", company_id).eq("year", y.year).maybeSingle();
    if (error) throw new Error(`reg year: ${error.message}`);
    const row = {
      company_id,
      year: y.year,
      revenue_eur: y.revenue_eur,
      net_profit_eur: y.net_profit_eur,
      employees: y.employees,
      source: y.source,
    };
    if (cur && sameNumbers(cur as FinRow, y)) {
      stats.unchanged++;
    } else if (cur && TRUSTED.includes(cur.verification as Verification)) {
      await propose(sb, {
        country,
        kind: "financial_update",
        source: "registry",
        payload: { key: `${company_id}:${y.year}`, row },
      });
      stats.proposed++;
    } else {
      await must(
        sb.from("mkt_financials").upsert({
          ...row,
          verification: "official",
          updated_at: now(),
        }, {
          onConflict: "company_id,year",
        }),
        "reg write",
      );
      stats.written++;
    }
  }
  return stats;
}
