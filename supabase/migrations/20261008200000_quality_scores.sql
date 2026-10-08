-- Баллы РС (аудит стандартов, полумесячные волны) и РКО (клиентский опыт, недели) по пиццериям
-- для главной (решение владельца 08.10.2026, docs/decisions/2026-10-07-home-dashboard-direction.md).
-- Источник — лист «Качество по пиццериям» таблиц «Аналитика IMF» и «Аналитика IMF (РКО)»:
-- выгрузка CSV → инструмент MCP quality_import (разбор — _shared/quality/sheet.ts).
-- Нет балла в ячейке — нет строки. Повторная загрузка того же листа идемпотентна (upsert по
-- ключу); балл, исчезнувший из листа, удаляется только в пределах загруженных периодов и
-- пиццерий — остальные периоды не трогаются (_shared/quality/store.ts).
create table if not exists public.quality_scores (
  kind text not null check (kind in ('rs', 'rko')),
  unit_id text not null check (unit_id ~ '^[0-9a-f]{32}$'),
  unit_name text not null,
  country_code char(2) not null,
  developer text,
  period_start date not null,
  period_end date not null,
  score numeric(5, 2) not null check (score between 0 and 100),
  imported_at timestamptz not null default now(),
  imported_by bigint,
  primary key (kind, unit_id, period_start),
  check (period_end >= period_start)
);

create index if not exists quality_scores_kind_country_period
  on public.quality_scores (kind, country_code, period_start);

comment on table public.quality_scores is
  'Баллы РС (rs, полумесяцы) и РКО (rko, недели) по пиццериям из листа «Качество по пиццериям». '
  'unit_id — id пиццерии Dodo IS (32 hex) из ссылки на рейтинг. Пишет только MCP quality_import (админ), '
  'читает swarm-api GET /quality с фильтром по allowed_markets воркспейса.';

-- Внешний замок, как у всех таблиц public: RLS без политик, доступ только у service_role.
alter table public.quality_scores enable row level security;
revoke all on public.quality_scores from anon, authenticated;
grant select, insert, update, delete on public.quality_scores to service_role;
