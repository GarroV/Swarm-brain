// Слой базы «Анализа рынка»: импорт снимка (ручные источники), загрузка страны для экрана,
// журнал запусков сборщиков, очередь кандидатов. Таблицы mkt_* — миграция 20261003100000.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Snapshot } from "./types.ts";

const slug = (s: string | null): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Естественный ключ точки: сеть + координаты до 4 знаков (~11 м) + адрес без регистра,
 *  знаков и диакритики. Адрес нужен: у Mlinar десятки пекарен геокодированы по улице или
 *  городу и стоят на одних координатах. Название не входит — его правят при проверке. */
export const locKey = (chain: string, lat: number, lng: number, address: string | null): string =>
  `${chain}:${lat.toFixed(4)}:${lng.toFixed(4)}:${slug(address)}`;

type Res<T> = { data: T | null; error: { message: string } | null };
export async function must<T>(p: PromiseLike<Res<T>>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data as T;
}

const now = () => new Date().toISOString();

const PAGE = 1000;
/** PostgREST отдаёт не больше 1000 строк за запрос и молча обрезает остальное: на стране с
 *  тысячей точек экран показал бы не всё. Читаем страницами, пока не придёт неполная. */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<Res<T[]>>,
  ctx: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0;; from += PAGE) {
    const rows = await must<T[]>(page(from, from + PAGE - 1), ctx);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export type ImportCounts = {
  chains: number;
  locations: number;
  companies: number;
  years: number;
  prices: number;
  facts: number;
  editorial: number;
};

async function importCompanies(sb: SupabaseClient, country: string, s: Snapshot): Promise<number> {
  let years = 0;
  for (const co of s.companies) {
    const row = await must<{ id: string }>(
      sb.from("mkt_companies")
        .upsert({ country, chain_key: co.chain, name: co.name, reg_id: co.reg_id, owner: co.owner, notes: co.notes }, {
          onConflict: "country,name",
        })
        .select("id")
        .single(),
      "company",
    );
    if (!co.years.length) continue;
    await must(
      sb.from("mkt_financials").upsert(
        co.years.map((y) => ({ company_id: row.id, ...y, updated_at: now() })),
        { onConflict: "company_id,year" },
      ),
      "financials",
    );
    years += co.years.length;
  }
  return years;
}

/** Ручные источники, которые залил этот импорт: страница показывает их возраст. */
async function touchManualSources(sb: SupabaseClient, country: string, s: Snapshot): Promise<void> {
  const feeds = [
    s.locations.length ? "locations" : null,
    s.companies.length ? "financials" : null,
    s.prices.length ? "prices" : null,
    s.facts.length ? "facts" : null,
    Object.keys(s.editorial ?? {}).length ? "editorial" : null,
  ].filter((f): f is string => f !== null);
  if (!feeds.length) return;
  await must(
    sb.from("mkt_sources").upsert(
      feeds.map((feeds) => ({
        country,
        adapter: "manual",
        chain_key: "",
        feeds,
        cadence: "manual",
        mode: "manual",
        last_ok_at: now(),
      })),
      { onConflict: "country,adapter,chain_key,feeds" },
    ),
    "sources",
  );
}

export async function importSnapshot(sb: SupabaseClient, cc: string, s: Snapshot): Promise<ImportCounts> {
  const country = cc.toUpperCase();
  await must(
    sb.from("mkt_chains").upsert(
      s.chains.map((c) => ({
        country,
        key: c.key,
        name: c.name,
        slot: c.slot,
        segment: c.segment,
        is_bakery: c.bakery,
        origin: c.origin,
        operator: c.operator,
        first_entry: c.first_entry,
        notes: c.notes,
        hist: c.hist.length ? c.hist : null,
        updated_at: now(),
      })),
      { onConflict: "country,key" },
    ),
    "chains",
  );

  // Точки Dodo — истина в API Dodo (сборщик ведёт их под ключом «dodo:<имя>»). Когда API уже
  // завёл их в стране, ручной снимок их не трогает, иначе каждый импорт рождал бы двойников.
  const { count: apiDodo, error: dodoErr } = await sb.from("mkt_locations").select("id", { count: "exact", head: true })
    .eq("country", country).eq("chain_key", "dodo").like("ext_key", "dodo:%").not(
      "ext_key",
      "match",
      "^dodo:-?[0-9]+\\.[0-9]{4}:",
    );
  if (dodoErr) throw new Error(`dodo api points: ${dodoErr.message}`);
  const own = apiDodo ? s.locations.filter((l) => l.chain !== "dodo") : s.locations;
  // Две записи с одним ключом в одном upsert Postgres не примет — берём последнюю.
  const locs = new Map(own.map((l) => [locKey(l.chain, l.lat, l.lng, l.address), l]));
  if (locs.size) {
    await must(
      sb.from("mkt_locations").upsert(
        [...locs].map(([ext_key, l]) => ({
          country,
          chain_key: l.chain,
          ext_key,
          name: l.name,
          city: l.city,
          address: l.address,
          lat: l.lat,
          lng: l.lng,
          placement: l.placement,
          opened: l.opened,
          opened_estimated: l.opened_estimated,
          status: l.status,
          closed: l.closed,
          format: l.format,
          source: l.source,
          source_kind: l.verification === "internal" ? "dodo" : "snapshot",
          verification: l.verification,
          verification_note: l.verification_note,
          last_seen_at: now(),
        })),
        { onConflict: "country,ext_key" },
      ),
      "locations",
    );
  }

  const years = await importCompanies(sb, country, s);
  if (s.prices.length) {
    await must(
      sb.from("mkt_prices").upsert(
        s.prices.map(({ chain, ...rest }) => ({ country, chain_key: chain, ...rest })),
        { onConflict: "country,chain_key,item,size_cm,channel,seen_on" },
      ),
      "prices",
    );
  }
  if (s.facts.length) {
    const facts = new Map(s.facts.map((f) => [`${f.topic}|${f.text}`, f]));
    await must(
      sb.from("mkt_facts").upsert([...facts.values()].map((f) => ({ country, ...f })), {
        onConflict: "country,topic,text",
      }),
      "facts",
    );
  }
  const blocks = Object.entries(s.editorial ?? {});
  if (blocks.length) {
    // Блок заменяется целиком: ручная часть — снимок на дату, а не накопление.
    await must(
      sb.from("mkt_editorial").upsert(
        blocks.map(([block, payload]) => ({ country, block, payload, updated_at: now() })),
        { onConflict: "country,block" },
      ),
      "editorial",
    );
  }
  await touchManualSources(sb, country, s);

  return {
    chains: s.chains.length,
    locations: locs.size,
    companies: s.companies.length,
    years,
    prices: s.prices.length,
    facts: new Set(s.facts.map((f) => `${f.topic}|${f.text}`)).size,
    editorial: blocks.length,
  };
}

const LOC_COLS = "id, chain_key, ext_key, name, city, address, lat, lng, placement, opened, opened_estimated, " +
  "status, closed, format, source, source_kind, verification, verification_note, missing_weeks, first_seen_at, last_seen_at";

export async function loadCountry(sb: SupabaseClient, cc: string) {
  const country = cc.toUpperCase();
  const [chains, locations, companies, prices, facts, dodo, runs, sources, pending, editorial] = await Promise.all([
    must<Array<{ key: string; name: string; slot: number; segment: string; is_bakery: boolean; hist: unknown }>>(
      sb.from("mkt_chains")
        .select("key, name, slot, segment, is_bakery, origin, operator, first_entry, notes, hist")
        .eq("country", country)
        .order("name"),
      "chains",
    ),
    allRows<unknown>(
      (from, to) => sb.from("mkt_locations").select(LOC_COLS).eq("country", country).order("id").range(from, to),
      "locations",
    ),
    must<Array<{ id: string }>>(
      sb.from("mkt_companies").select("id, chain_key, name, reg_id, owner, notes").eq("country", country),
      "companies",
    ),
    must<unknown[]>(
      sb.from("mkt_prices").select("chain_key, item, item_type, size_cm, price_eur, channel, source, seen_on")
        .eq("country", country),
      "prices",
    ),
    must<unknown[]>(sb.from("mkt_facts").select("topic, date, text, value, source").eq("country", country), "facts"),
    must<unknown[]>(
      sb.from("mkt_dodo_monthly").select("month, revenue_local, currency, revenue_eur, units, orders, complete")
        .eq("country", country)
        .order("month"),
      "dodo",
    ),
    must<unknown[]>(
      sb.from("mkt_runs").select("source, status, started_at, finished_at, stats, error")
        .eq("country", country)
        .order("finished_at", { ascending: false })
        .limit(30),
      "runs",
    ),
    must<Array<{ adapter: string; feeds: string; mode: string }>>(
      sb.from("mkt_sources").select("adapter, chain_key, feeds, cadence, mode, reason, last_ok_at").eq(
        "country",
        country,
      ),
      "sources",
    ),
    sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", country).eq(
      "status",
      "pending",
    ),
    must<Array<{ block: string; payload: unknown }>>(
      sb.from("mkt_editorial").select("block, payload").eq("country", country),
      "editorial",
    ),
  ]);
  const ids = companies.map((c) => c.id);
  const financials = ids.length
    ? await allRows<unknown>(
      (from, to) =>
        sb.from("mkt_financials")
          .select("company_id, year, revenue_eur, employees, source, verification, note")
          .in("company_id", ids)
          .order("company_id")
          .order("year")
          .range(from, to),
      "financials",
    )
    : [];
  return {
    country,
    chains,
    locations,
    companies,
    financials,
    prices,
    facts,
    dodo,
    runs,
    sources,
    pending: pending.count ?? 0,
    editorial: Object.fromEntries(editorial.map((e) => [e.block, e.payload])),
  };
}
export type CountryBundle = Awaited<ReturnType<typeof loadCountry>>;

export async function listCountriesWithData(sb: SupabaseClient): Promise<string[]> {
  const rows = await must<Array<{ country: string }>>(sb.from("mkt_chains").select("country"), "countries");
  return [...new Set(rows.map((r) => r.country))].sort();
}

export type RunRecord = {
  source: string;
  country: string;
  status: "ok" | "failed";
  started_at: string;
  stats: Record<string, number>;
  error: string | null;
};

export async function recordRun(sb: SupabaseClient, run: RunRecord): Promise<void> {
  await must(sb.from("mkt_runs").insert(run), "run");
}

export async function listCandidates(sb: SupabaseClient, cc: string): Promise<unknown[]> {
  return await must<unknown[]>(
    sb.from("mkt_candidates")
      .select("id, kind, source, payload, target_id, created_at")
      .eq("country", cc.toUpperCase())
      .eq("status", "pending")
      .order("created_at"),
    "candidates",
  );
}

type Candidate = {
  id: string;
  country: string;
  kind: string;
  payload: Record<string, unknown>;
  target_id: string | null;
};

async function applyCandidate(sb: SupabaseClient, c: Candidate): Promise<void> {
  const row = (c.payload.row ?? {}) as Record<string, unknown>;
  if (c.kind === "new_location") {
    // Человек подтвердил находку OSM — точка становится проверенной.
    await must(
      sb.from("mkt_locations").upsert({ country: c.country, ...row, source_kind: "osm", verification: "confirmed" }, {
        onConflict: "country,ext_key",
      }),
      "accept new",
    );
  } else if (c.kind === "maybe_closed" && c.target_id) {
    await must(
      sb.from("mkt_locations").update({ status: "closed", closed: now().slice(0, 10) }).eq("id", c.target_id),
      "accept closed",
    );
  } else if (c.kind === "financial_update") {
    await must(
      sb.from("mkt_financials").upsert({ ...row, verification: "confirmed", updated_at: now() }, {
        onConflict: "company_id,year",
      }),
      "accept fin",
    );
  }
}

export async function decideCandidate(
  sb: SupabaseClient,
  id: string,
  accept: boolean,
  by: number,
): Promise<"ok" | "not_found" | "already"> {
  const { data: c, error } = await sb.from("mkt_candidates")
    .select("id, country, kind, payload, target_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`candidate: ${error.message}`);
  if (!c) return "not_found";
  if (c.status !== "pending") return "already";
  if (accept) await applyCandidate(sb, c as Candidate);
  await must(
    sb.from("mkt_candidates")
      .update({ status: accept ? "accepted" : "rejected", decided_by: by, decided_at: now() })
      .eq("id", id),
    "decide",
  );
  return "ok";
}

/** Первичная заливка страны без ручного снимка: все находки точек от OSM принимаются разом,
 *  но остаются «не проверено» — человек их не смотрел, и пропажа из OSM по-прежнему
 *  предлагает закрытие. «Возможно закрыта» и правки финансов сюда не входят: по одной. */
/** Сколько id влезает в один `.in()`: он уходит в URL, и на ~350 uuid шлюз отвечает
 *  «URI too long» (поймано на Румынии 02.10.2026). */
export const ID_BATCH = 100;
export async function acceptAllNewLocations(sb: SupabaseClient, cc: string, by: number): Promise<number> {
  const country = cc.toUpperCase();
  const pending = await allRows<{ id: string; payload: { row?: Record<string, unknown> } }>(
    (from, to) =>
      sb.from("mkt_candidates").select("id, payload").eq("country", country).eq("kind", "new_location")
        .eq("status", "pending").order("id").range(from, to),
    "pending new",
  );
  for (let i = 0; i < pending.length; i += ID_BATCH) {
    const chunk = pending.slice(i, i + ID_BATCH);
    const rows = new Map(chunk.map((c) => [String(c.payload.row?.ext_key), c.payload.row ?? {}]));
    await must(
      sb.from("mkt_locations").upsert(
        [...rows.values()].map((row) => ({ country, ...row, source_kind: "osm", verification: "unverified" })),
        { onConflict: "country,ext_key" },
      ),
      "accept all",
    );
    await must(
      sb.from("mkt_candidates").update({ status: "accepted", decided_by: by, decided_at: now() })
        .in("id", chunk.map((c) => c.id)),
      "accept all decide",
    );
  }
  return pending.length;
}
