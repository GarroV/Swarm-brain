// Генератор миграции с Demoland (XD) — выдуманной страной «Анализа рынка» для демо.
// Источник данных один — miniapp/src/lib/marketDemo.ts (им же живёт DEV_MODE), поэтому демо
// на сервере и локальная заглушка не расходятся. Даты в миграции — смещения от «сейчас»:
// функция public.market_demoland_seed() пересчитывает их от now(), а pg_cron зовёт её раз
// в сутки, чтобы демо не выглядело застывшим («источник молчит 40 дней»).
//   deno run -A scripts/market/demoland-seed.ts > supabase/migrations/<ts>_market_demoland.sql
import {
  DEMO_AGES,
  demolandBundle,
  DODO_MONTHS,
} from "../../miniapp/src/lib/marketDemo.ts";

const NOW = new Date("2026-10-02T12:00:00Z");
const b = demolandBundle(NOW);
const ageOf = (
  iso: string | null,
) => (iso ? Math.round((NOW.getTime() - Date.parse(iso)) / 86_400_000) : null);
const coName = new Map(b.companies.map((c) => [c.id, c.name]));

const data = {
  chains: b.chains.map(({ hist: _h, ...c }) => c),
  locations: b.locations.map((
    { id: _i, first_seen_at: _f, last_seen_at: _l, ...l },
  ) => l),
  companies: b.companies.map(({ id: _i, ...c }) => c),
  financials: b.financials.map(({ company_id, ...f }) => ({
    company: coName.get(company_id),
    ...f,
  })),
  prices: b.prices,
  facts: b.facts,
  dodo: b.dodo.map(({ month: _m, ...d }, i) => ({
    back: DODO_MONTHS - 1 - i,
    ...d,
  })),
  runs: b.runs.map(({ started_at, finished_at: _f, ...r }) => ({
    age_days: ageOf(started_at),
    ...r,
  })),
  sources: b.sources.map(({ last_ok_at, ...s }) => ({
    age_days: ageOf(last_ok_at),
    ...s,
  })),
};
const json = JSON.stringify(data);
if (json.includes("$seed$")) {
  throw new Error("данные содержат разделитель $seed$");
}
if (!DEMO_AGES) throw new Error("нет DEMO_AGES");

console.log(
  `-- Demoland (XD): выдуманная страна «Анализа рынка» для демо (решение владельца 02.10.2026:
-- «в демо давай зальем рыбу, не надо официальную информацию»). СГЕНЕРИРОВАНО
-- scripts/market/demoland-seed.ts из miniapp/src/lib/marketDemo.ts — руками не править.
--
-- Демо-сессия видит только XD (canSeeCountry) и админом не бывает, поэтому данные XD она не
-- меняет; сид нужен не для отката, а чтобы даты оставались свежими: функция пересчитывает
-- месяцы и возраст запусков от now(), pg_cron зовёт её раз в сутки. Трогает только country='XD'.

create or replace function public.market_demoland_seed()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_cc constant text := 'XD';
  d jsonb := $seed$${json}$seed$::jsonb;
begin
  -- Только XD — константой: реальные страны эта функция не трогает никогда.
  delete from public.mkt_financials where company_id in (select id from public.mkt_companies where country = c_cc);
  delete from public.mkt_candidates where country = c_cc;
  delete from public.mkt_ratings where country = c_cc;
  delete from public.mkt_locations where country = c_cc;
  delete from public.mkt_companies where country = c_cc;
  delete from public.mkt_prices where country = c_cc;
  delete from public.mkt_facts where country = c_cc;
  delete from public.mkt_dodo_monthly where country = c_cc;
  delete from public.mkt_runs where country = c_cc;
  delete from public.mkt_sources where country = c_cc;
  delete from public.mkt_chains where country = c_cc;

  insert into public.mkt_chains (country, key, name, slot, segment, is_bakery, origin, operator, first_entry, notes)
  select c_cc, x.key, x.name, x.slot, x.segment, x.is_bakery, x.origin, x.operator, x.first_entry, x.notes
  from jsonb_to_recordset(d->'chains') as x(key text, name text, slot int, segment text, is_bakery boolean,
    origin text, operator text, first_entry text, notes text);

  insert into public.mkt_locations (country, chain_key, ext_key, name, city, address, lat, lng, placement, opened,
    opened_estimated, status, closed, format, source, source_kind, verification, verification_note, missing_weeks)
  select c_cc, x.chain_key, x.ext_key, x.name, x.city, x.address, x.lat, x.lng, x.placement, x.opened,
    x.opened_estimated, x.status, x.closed, x.format, x.source, x.source_kind, x.verification, x.verification_note,
    x.missing_weeks
  from jsonb_to_recordset(d->'locations') as x(chain_key text, ext_key text, name text, city text, address text,
    lat double precision, lng double precision, placement text, opened text, opened_estimated boolean, status text,
    closed text, format text, source text, source_kind text, verification text, verification_note text,
    missing_weeks int);

  insert into public.mkt_companies (country, chain_key, name, reg_id, owner, notes)
  select c_cc, x.chain_key, x.name, x.reg_id, x.owner, x.notes
  from jsonb_to_recordset(d->'companies') as x(chain_key text, name text, reg_id text, owner text, notes text);

  insert into public.mkt_financials (company_id, year, revenue_eur, net_profit_eur, employees, source, verification, note)
  select co.id, x.year, x.revenue_eur, x.net_profit_eur, x.employees, x.source, x.verification, x.note
  from jsonb_to_recordset(d->'financials') as x(company text, year int, revenue_eur numeric, net_profit_eur numeric,
    employees numeric, source text, verification text, note text)
  join public.mkt_companies co on co.country = c_cc and co.name = x.company;

  insert into public.mkt_prices (country, chain_key, item, item_type, size_cm, price_eur, channel, source, seen_on)
  select c_cc, x.chain_key, x.item, x.item_type, x.size_cm, x.price_eur, x.channel, x.source,
    (now() - make_interval(days => ${DEMO_AGES.manual}))::date
  from jsonb_to_recordset(d->'prices') as x(chain_key text, item text, item_type text, size_cm numeric,
    price_eur numeric, channel text, source text);

  insert into public.mkt_facts (country, topic, date, text, value, source)
  select c_cc, x.topic, x.date, x.text, x.value, x.source
  from jsonb_to_recordset(d->'facts') as x(topic text, date text, text text, value text, source text);

  insert into public.mkt_dodo_monthly (country, month, revenue_local, currency, revenue_eur, units, orders, complete)
  select c_cc, to_char(date_trunc('month', now()) - make_interval(months => x.back), 'YYYY-MM'), x.revenue_local,
    x.currency, x.revenue_eur, x.units, x.orders, x.back > 0
  from jsonb_to_recordset(d->'dodo') as x(back int, revenue_local numeric, currency text, revenue_eur numeric,
    units int, orders jsonb);

  insert into public.mkt_runs (country, source, status, started_at, finished_at, stats, error)
  select c_cc, x.source, x.status, now() - make_interval(days => x.age_days),
    now() - make_interval(days => x.age_days) + interval '1 minute', x.stats, x.error
  from jsonb_to_recordset(d->'runs') as x(age_days int, source text, status text, stats jsonb, error text);

  insert into public.mkt_sources (country, adapter, chain_key, feeds, cadence, mode, reason, last_ok_at)
  select c_cc, x.adapter, x.chain_key, x.feeds, x.cadence, x.mode, x.reason,
    case when x.age_days is null then null else now() - make_interval(days => x.age_days) end
  from jsonb_to_recordset(d->'sources') as x(age_days int, adapter text, chain_key text, feeds text, cadence text,
    mode text, reason text);

  return jsonb_build_object(
    'chains', (select count(*) from public.mkt_chains where country = c_cc),
    'locations', (select count(*) from public.mkt_locations where country = c_cc),
    'financials', (select count(*) from public.mkt_financials f join public.mkt_companies c on c.id = f.company_id
                   where c.country = c_cc),
    'dodo_months', (select count(*) from public.mkt_dodo_monthly where country = c_cc));
end;
$fn$;

comment on function public.market_demoland_seed() is
  'Засевает выдуманную Demoland (country=XD) для демо «Анализа рынка» с датами от now(). Генерируется scripts/market/demoland-seed.ts. Вызывается pg_cron market-demoland раз в сутки.';

-- Грант на PUBLIC наследуется в anon/authenticated (урок 20260826210000_mcp_token_funcs_lockdown).
revoke all on function public.market_demoland_seed() from public, anon, authenticated;
grant execute on function public.market_demoland_seed() to service_role;

select public.market_demoland_seed();

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('market-demoland', '17 3 * * *', 'select public.market_demoland_seed()');
  else
    raise notice 'pg_cron не включён — расписание market-demoland не зарегистрировано';
  end if;
end;
$$;`,
);
