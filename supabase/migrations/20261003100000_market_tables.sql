-- «Анализ рынка» (решение 02.10.2026, спека docs/superpowers/specs/2026-10-02-market-analysis-design.md).
-- Данные рынка страны, не воркспейса: ключ — код страны ISO-2. Доступ режется в коде по
-- workspaces.allowed_markets. RLS без политик + revoke — клиент в эти таблицы не ходит.
-- ext_key — естественный ключ записи внутри страны: повторный импорт того же снимка обновляет,
-- а не дублирует.

create table public.mkt_chains (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  key text not null,
  name text not null,
  slot int not null default 0,
  segment text not null default 'other',
  is_bakery boolean not null default false,
  origin text, operator text, first_entry text, notes text,
  hist jsonb,                         -- число точек по годам из новостей (когда реестр точек неполон)
  updated_at timestamptz not null default now(),
  unique (country, key)
);

create table public.mkt_locations (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  chain_key text not null,
  ext_key text not null,
  name text not null,
  city text, address text,
  lat double precision not null, lng double precision not null,
  placement text,
  opened text, opened_estimated boolean not null default false,
  status text not null check (status in ('open','closed','planned','paused')),
  closed text, format text,
  source text,
  source_kind text not null default 'snapshot' check (source_kind in ('snapshot','dodo','osm','manual')),
  verification text not null check (verification in ('official','confirmed','corrected','added','unverified','internal')),
  verification_note text,
  missing_weeks int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (country, ext_key),
  foreign key (country, chain_key) references public.mkt_chains (country, key)
);
create index mkt_locations_country_chain on public.mkt_locations (country, chain_key);

create table public.mkt_companies (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  chain_key text,
  name text not null,
  reg_id text,
  owner text, notes text,
  unique (country, name)
);

create table public.mkt_financials (
  company_id uuid not null references public.mkt_companies (id) on delete cascade,
  year int not null check (year between 1990 and 2100),
  revenue_eur numeric, net_profit_eur numeric, employees numeric,
  source text,
  verification text not null check (verification in ('official','confirmed','corrected','added','unverified','internal')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (company_id, year)
);

create table public.mkt_prices (
  id uuid primary key default gen_random_uuid(),
  country text not null, chain_key text not null,
  item text not null, item_type text, size_cm numeric, price_eur numeric not null,
  channel text, source text, seen_on date,
  unique nulls not distinct (country, chain_key, item, size_cm, channel, seen_on)
);

create table public.mkt_ratings (
  id uuid primary key default gen_random_uuid(),
  country text not null, chain_key text, location_id uuid references public.mkt_locations (id),
  platform text not null, rating numeric, rating_count int, seen_on date not null
);

create table public.mkt_facts (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  topic text not null check (topic in ('delivery','market','deal','timeline','insight','commentary')),
  date text, text text not null, value text, source text,
  unique (country, topic, text)
);

create table public.mkt_dodo_monthly (
  country text not null, month text not null check (month ~ '^\d{4}-\d{2}$'),
  revenue_local numeric, currency text, revenue_eur numeric, units int,
  orders jsonb, complete boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (country, month)
);

create table public.mkt_candidates (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  kind text not null check (kind in ('new_location','maybe_closed','financial_update')),
  source text not null,
  payload jsonb not null,
  target_id uuid,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_by bigint, decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- Один открытый кандидат на одну и ту же находку: еженедельный прогон не плодит дубли.
create unique index mkt_candidates_pending_once on public.mkt_candidates (country, kind, (payload->>'key')) where status = 'pending';

create table public.mkt_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null, country text not null,
  status text not null check (status in ('ok','failed')),
  started_at timestamptz not null, finished_at timestamptz not null default now(),
  stats jsonb not null default '{}'::jsonb, error text
);
create index mkt_runs_recent on public.mkt_runs (country, source, finished_at desc);

-- Источники страны (из конфига scripts/market/countries/<CC>.ts): что кормит каждый блок,
-- как часто и когда последний раз успешно. Страница показывает возраст данных по ним.
create table public.mkt_sources (
  country text not null, adapter text not null, chain_key text not null default '',
  feeds text not null check (feeds in ('locations','financials','dodo','prices','facts')),
  cadence text not null check (cadence in ('weekly','monthly','yearly','manual')),
  mode text not null check (mode in ('auto','manual','blocked')), reason text,
  last_ok_at timestamptz,
  primary key (country, adapter, chain_key, feeds)
);

do $$ declare t text; begin
  foreach t in array array['mkt_chains','mkt_locations','mkt_companies','mkt_financials','mkt_prices','mkt_ratings','mkt_facts','mkt_dodo_monthly','mkt_candidates','mkt_runs','mkt_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
