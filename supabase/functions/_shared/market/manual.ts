// Ручной ввод «Анализа рынка» по одной записи — вход для MCP (решение владельца 03.10.2026:
// «через клод десктоп через коннекторы подгрузить или поправить информацию»). Пишет в те же
// таблицы, что сборщики и импорт снимка. Автоматика проверенные руками записи не перетирает:
// OSM удаляет только свои непроверенные точки, реестр по проверенной выручке шлёт кандидата.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { locKey, markManualFed, must } from "./db.ts";
import { EDITORIAL_BLOCKS, type EditorialBlock, parseEditorial } from "./editorial.ts";

export type Change<T> = { ok: true; before: T | null; after: T } | { ok: false; error: string };

const now = () => new Date().toISOString();
const COUNTRY = /^[A-Z]{2}$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Фиксированные курсы к евро: валюты, привязанные к евро навсегда (лев, куна). Плавающий курс
 *  на дату отчёта модель не знает — такую сумму просим переводить в евро самому, с пометкой. */
export const FIXED_EUR_RATES: Readonly<Record<string, number>> = { EUR: 1, BGN: 1.95583, HRK: 7.5345 };

export function toEur(amount: number, currency: string): number | null {
  const rate = FIXED_EUR_RATES[currency.toUpperCase()];
  return rate ? Math.round(amount / rate) : null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Общие проверки входа: страна кодом ISO и источник. Без источника цифра на экране — не факт. */
export function baseCheck(country: unknown, source: unknown): string | null {
  if (typeof country !== "string" || !COUNTRY.test(country.toUpperCase())) return "country — код страны из двух букв";
  if (!text(source)) return "source обязателен: ссылка на документ или пометка, откуда цифра";
  return null;
}

async function chainExists(sb: SupabaseClient, country: string, chain: string): Promise<boolean> {
  const { count, error } = await sb.from("mkt_chains").select("key", { count: "exact", head: true })
    .eq("country", country).eq("key", chain);
  if (error) throw new Error(`chain check: ${error.message}`);
  return (count ?? 0) > 0;
}

// ── Сеть ─────────────────────────────────────────────────────────────────────

export type ChainInput = { key: string; name: string; kind?: string; origin?: string; notes?: string };
type ChainRow = { key: string; name: string; is_bakery: boolean; segment: string | null; origin: string | null };

export async function upsertChain(sb: SupabaseClient, cc: string, input: ChainInput): Promise<Change<ChainRow>> {
  const country = cc.toUpperCase();
  if (!COUNTRY.test(country)) return { ok: false, error: "country — код страны из двух букв" };
  if (!KEY.test(input.key ?? "")) return { ok: false, error: "key — латиница, цифры и дефис, например «pizza-hut»" };
  if (!text(input.name)) return { ok: false, error: "name обязателен" };
  const kind = input.kind ?? "other";
  if (!["pizza", "bakery", "other"].includes(kind)) return { ok: false, error: "kind — pizza, bakery или other" };
  const before = await must<ChainRow | null>(
    sb.from("mkt_chains").select("key, name, is_bakery, segment, origin, slot").eq("country", country)
      .eq("key", input.key).maybeSingle(),
    "chain",
  );
  // Новая сеть встаёт в конец палитры; у существующей слот и цвет не трогаем.
  const { data: last } = await sb.from("mkt_chains").select("slot").eq("country", country)
    .order("slot", { ascending: false }).limit(1).maybeSingle();
  const row = {
    country,
    key: input.key,
    name: input.name.trim(),
    is_bakery: kind === "bakery",
    segment: kind === "pizza" ? "pizza" : (before?.segment ?? "other"),
    origin: text(input.origin) ?? before?.origin ?? null,
    ...(text(input.notes) ? { notes: text(input.notes) } : {}),
    ...(before ? {} : { slot: ((last as { slot: number } | null)?.slot ?? 0) + 1 }),
    updated_at: now(),
  };
  const after = await must<ChainRow>(
    sb.from("mkt_chains").upsert(row, { onConflict: "country,key" })
      .select("key, name, is_bakery, segment, origin").single(),
    "chain upsert",
  );
  return { ok: true, before, after };
}

// ── Деньги: выручка юрлица за год ───────────────────────────────────────────

export type CompanyYearInput = {
  chain?: string;
  company: string;
  reg_id?: string;
  year: number;
  revenue: number;
  currency: string;
  employees?: number;
  source: string;
  note?: string;
};
type FinRow = { year: number; revenue_eur: number | null; employees: number | null; source: string | null };

export async function setCompanyYear(
  sb: SupabaseClient,
  cc: string,
  input: CompanyYearInput,
): Promise<Change<FinRow & { company: string }>> {
  const country = cc.toUpperCase();
  const bad = baseCheck(country, input.source);
  if (bad) return { ok: false, error: bad };
  if (!text(input.company)) return { ok: false, error: "company — название юрлица, как в реестре" };
  const year = num(input.year);
  if (year === null || !Number.isInteger(year) || year < 1990 || year > 2100) {
    return { ok: false, error: "year — год отчёта, например 2024" };
  }
  const revenue = num(input.revenue);
  if (revenue === null || revenue < 0) return { ok: false, error: "revenue — выручка числом, без пробелов" };
  const revenue_eur = toEur(revenue, String(input.currency ?? ""));
  if (revenue_eur === null) {
    return {
      ok: false,
      error: `currency: с фиксированным курсом — ${
        Object.keys(FIXED_EUR_RATES).join(", ")
      }; другую валюту переведи в EUR сам и укажи курс в note`,
    };
  }
  if (input.chain && !(await chainExists(sb, country, input.chain))) {
    return { ok: false, error: `сети «${input.chain}» в стране нет — сначала market_upsert_chain` };
  }
  const company = await must<{ id: string; name: string }>(
    sb.from("mkt_companies").upsert({
      country,
      name: input.company.trim(),
      ...(input.chain ? { chain_key: input.chain } : {}),
      ...(text(input.reg_id) ? { reg_id: text(input.reg_id) } : {}),
    }, { onConflict: "country,name" }).select("id, name").single(),
    "company",
  );
  const before = await must<FinRow | null>(
    sb.from("mkt_financials").select("year, revenue_eur, employees, source").eq("company_id", company.id)
      .eq("year", year).maybeSingle(),
    "financials",
  );
  const rate = FIXED_EUR_RATES[input.currency.toUpperCase()];
  const conv = rate === 1 ? null : `${revenue.toLocaleString("ru-RU")} ${input.currency.toUpperCase()} по ${rate}`;
  const after = await must<FinRow>(
    sb.from("mkt_financials").upsert({
      company_id: company.id,
      year,
      revenue_eur,
      employees: num(input.employees),
      source: input.source.trim(),
      verification: "confirmed",
      note: [conv, text(input.note)].filter(Boolean).join(" · ") || null,
      updated_at: now(),
    }, { onConflict: "company_id,year" }).select("year, revenue_eur, employees, source").single(),
    "financials upsert",
  );
  await markManualFed(sb, country, ["financials"]);
  return {
    ok: true,
    before: before ? { ...before, company: company.name } : null,
    after: { ...after, company: company.name },
  };
}

// ── Карта: точка ─────────────────────────────────────────────────────────────

export type LocationInput = {
  id?: string;
  chain: string;
  name?: string;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
  opened?: string;
  status?: string;
  closed?: string;
  source: string;
  note?: string;
};
const LOC_COLS = "id, chain_key, name, city, address, lat, lng, opened, status, closed, source, verification";
type LocRow = Record<string, unknown> & { id: string };
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export async function upsertLocation(sb: SupabaseClient, cc: string, input: LocationInput): Promise<Change<LocRow>> {
  const country = cc.toUpperCase();
  const bad = baseCheck(country, input.source);
  if (bad) return { ok: false, error: bad };
  for (const f of ["opened", "closed"] as const) {
    if (input[f] !== undefined && !DATE.test(String(input[f]))) {
      return { ok: false, error: `${f} — ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД` };
    }
  }
  const status = input.status ?? (input.closed ? "closed" : "open");
  if (!["open", "closed", "planned", "paused"].includes(status)) {
    return { ok: false, error: "status — open, closed, planned или paused" };
  }
  const patch = {
    ...(text(input.name) ? { name: text(input.name) } : {}),
    ...(input.city !== undefined ? { city: text(input.city) } : {}),
    ...(input.address !== undefined ? { address: text(input.address) } : {}),
    ...(num(input.lat) !== null ? { lat: input.lat } : {}),
    ...(num(input.lng) !== null ? { lng: input.lng } : {}),
    ...(input.opened ? { opened: input.opened, opened_estimated: false } : {}),
    ...(input.closed ? { closed: input.closed } : {}),
    status,
    source: input.source.trim(),
    ...(text(input.note) ? { verification_note: text(input.note) } : {}),
  };

  if (input.id) {
    const before = await must<LocRow | null>(
      sb.from("mkt_locations").select(LOC_COLS).eq("country", country).eq("id", input.id).maybeSingle(),
      "location",
    );
    if (!before) return { ok: false, error: "точки с таким id в стране нет — id бери из market_get" };
    // Поправленная руками точка становится ручной: сборщик OSM её больше не двигает и не удаляет,
    // а свою машинную копию на том же месте снимает сам.
    const after = await must<LocRow>(
      sb.from("mkt_locations").update({ ...patch, source_kind: "manual", verification: "corrected" })
        .eq("id", input.id).select(LOC_COLS).single(),
      "location update",
    );
    await markManualFed(sb, country, ["locations"]);
    return { ok: true, before, after };
  }

  if (!(await chainExists(sb, country, input.chain))) {
    return { ok: false, error: `сети «${input.chain}» в стране нет — сначала market_upsert_chain` };
  }
  const lat = num(input.lat), lng = num(input.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: "у новой точки нужны lat и lng (координаты с карты)" };
  }
  if (!text(input.name)) return { ok: false, error: "у новой точки нужно name" };
  const ext_key = locKey(input.chain, lat, lng, text(input.address));
  const before = await must<LocRow | null>(
    sb.from("mkt_locations").select(LOC_COLS).eq("country", country).eq("ext_key", ext_key).maybeSingle(),
    "location",
  );
  const after = await must<LocRow>(
    sb.from("mkt_locations").upsert({
      country,
      chain_key: input.chain,
      ext_key,
      ...patch,
      source_kind: "manual",
      verification: before ? "corrected" : "added",
      last_seen_at: now(),
    }, { onConflict: "country,ext_key" }).select(LOC_COLS).single(),
    "location upsert",
  );
  await markManualFed(sb, country, ["locations"]);
  return { ok: true, before, after };
}

// ── Цены ─────────────────────────────────────────────────────────────────────

export type PriceInput = {
  chain: string;
  item: string;
  price: number;
  currency: string;
  size_cm?: number;
  channel?: string;
  item_type?: string;
  seen_on?: string;
  source: string;
};
type PriceRow = { item: string; price_eur: number; size_cm: number | null; channel: string | null; seen_on: string };

export async function setPrice(sb: SupabaseClient, cc: string, input: PriceInput): Promise<Change<PriceRow>> {
  const country = cc.toUpperCase();
  const bad = baseCheck(country, input.source);
  if (bad) return { ok: false, error: bad };
  if (!text(input.item)) return { ok: false, error: "item — позиция меню, например «Margherita»" };
  const price = num(input.price);
  if (price === null || price <= 0) return { ok: false, error: "price — цена числом" };
  const rate = FIXED_EUR_RATES[String(input.currency ?? "").toUpperCase()];
  if (!rate) return { ok: false, error: `currency — ${Object.keys(FIXED_EUR_RATES).join(", ")}` };
  const seen_on = input.seen_on ?? now().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seen_on)) return { ok: false, error: "seen_on — ГГГГ-ММ-ДД" };
  if (!(await chainExists(sb, country, input.chain))) {
    return { ok: false, error: `сети «${input.chain}» в стране нет — сначала market_upsert_chain` };
  }
  const key = { item: input.item.trim(), size_cm: num(input.size_cm), channel: text(input.channel), seen_on };
  let q = sb.from("mkt_prices").select("item, price_eur, size_cm, channel, seen_on").eq("country", country)
    .eq("chain_key", input.chain).eq("item", key.item).eq("seen_on", seen_on);
  q = key.size_cm === null ? q.is("size_cm", null) : q.eq("size_cm", key.size_cm);
  q = key.channel === null ? q.is("channel", null) : q.eq("channel", key.channel);
  const before = await must<PriceRow | null>(q.maybeSingle(), "price");
  const after = await must<PriceRow>(
    sb.from("mkt_prices").upsert({
      country,
      chain_key: input.chain,
      ...key,
      item_type: text(input.item_type),
      price_eur: Math.round((price / rate) * 100) / 100,
      source: input.source.trim(),
    }, { onConflict: "country,chain_key,item,size_cm,channel,seen_on" })
      .select("item, price_eur, size_cm, channel, seen_on").single(),
    "price upsert",
  );
  await markManualFed(sb, country, ["prices"]);
  return { ok: true, before, after };
}

// ── Блок ручной части (сводка, события, оценки, доставка…) ─────────────────

export async function setBlock(
  sb: SupabaseClient,
  cc: string,
  block: string,
  payload: unknown,
  source: string,
): Promise<Change<unknown>> {
  const country = cc.toUpperCase();
  const bad = baseCheck(country, source);
  if (bad) return { ok: false, error: bad };
  if (!(block in EDITORIAL_BLOCKS)) {
    return { ok: false, error: `блока «${block}» нет; есть: ${Object.keys(EDITORIAL_BLOCKS).join(", ")}` };
  }
  const errors: string[] = [];
  const parsed = parseEditorial({ [block]: payload }, errors);
  if (errors.length) return { ok: false, error: errors.join("; ") };
  const before = await must<{ payload: unknown } | null>(
    sb.from("mkt_editorial").select("payload").eq("country", country).eq("block", block).maybeSingle(),
    "editorial",
  );
  await must(
    sb.from("mkt_editorial").upsert(
      { country, block, payload: parsed[block as EditorialBlock], updated_at: now() },
      { onConflict: "country,block" },
    ),
    "editorial upsert",
  );
  await markManualFed(sb, country, ["editorial"]);
  return { ok: true, before: before?.payload ?? null, after: parsed[block as EditorialBlock] };
}
