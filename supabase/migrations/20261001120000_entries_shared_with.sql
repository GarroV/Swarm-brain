-- Личная запись на двоих: встреча 1-1 (#641, решение владельца 30.09.2026).
--
-- «если встреча проходила только с двумя живыми участниками (боты не в счет) - то появляется
-- выбор сохранения в личные пространства двух участников». Делаем ОДНОЙ записью, а не двумя
-- копиями: владелец (owner_id) — опубликовавший, второй участник — в shared_with. Правка одним
-- видна другому, дедуп и задачи не раздваиваются.
--
-- Правило видимости после миграции, одно на все поверхности:
--   is_private = false OR owner_id = я OR я = ANY(shared_with)
-- В коде оно живёт в _shared/entries/access.ts (canViewEntry, entryVisibilityOr); здесь — его
-- копия в SQL-поиске. У match_entries_hybrid ДВЕ перегрузки и в каждой условие стоит ДВАЖДЫ
-- (full-text и векторная ветки) — правка во всех четырёх местах плюс match_entries.
-- Тексты функций взяты с прода (длина совпала с 20260824101500 до символа) и отличаются
-- только условием приватности.
--
-- ADD COLUMN с константным дефолтом — без переписывания таблицы. Функции читают колонку,
-- поэтому миграция катится ДО функций.

alter table public.entries
  add column if not exists shared_with bigint[] not null default '{}';

comment on column public.entries.shared_with is
  'С кем ещё разделена личная запись (is_private=true): второй участник встречи 1-1, #641. Видит и правит, не удаляет. У общей записи пусто.';

create index if not exists entries_shared_with_gin on public.entries using gin (shared_with);

CREATE OR REPLACE FUNCTION public.match_entries_hybrid(query_embedding text, query_text text DEFAULT NULL::text, match_count integer DEFAULT 15, requesting_user_id bigint DEFAULT NULL::bigint, filter_group_id text DEFAULT NULL::text, filter_country text DEFAULT NULL::text, filter_source text DEFAULT NULL::text, full_text_weight double precision DEFAULT 1.0, semantic_weight double precision DEFAULT 1.0, country_weight double precision DEFAULT 1.5, recency_weight double precision DEFAULT 1.0, rrf_k integer DEFAULT 50, fresh_days integer DEFAULT 14, min_fresh integer DEFAULT 5)
 RETURNS TABLE(id uuid, content text, summary text, source text, metadata jsonb, countries text[], entry_type text, entry_date date, group_id text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
with params as (
  select query_embedding::vector as qe, nullif(btrim(query_text), '') as qt
),
full_text as (
  select e.id, row_number() over (order by ts_rank_cd(e.fts, websearch_to_tsquery('russian', (select qt from params))) desc) as rank_ix
  from public.entries e, params
  where params.qt is not null and e.fts @@ websearch_to_tsquery('russian', params.qt)
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (e.is_private = false or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with))))
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (e.entry_type <> 'meeting' or coalesce(e.metadata->>'confirmed', 'false') = 'true')
  order by rank_ix limit least(match_count, 30) * 2
),
semantic as (
  select e.id, row_number() over (order by e.embedding <=> (select qe from params)) as rank_ix
  from public.entries e
  where e.embedding is not null
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (e.is_private = false or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with))))
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (e.entry_type <> 'meeting' or coalesce(e.metadata->>'confirmed', 'false') = 'true')
  order by e.embedding <=> (select qe from params) limit least(match_count, 30) * 2
),
fused as (
  select e.id, e.content, e.summary, e.source, e.metadata, e.countries, e.entry_type, e.entry_date, e.group_id,
    (1 - (e.embedding <=> (select qe from params)))::double precision as similarity,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
    + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    + (case when filter_country is not null and e.countries && array[filter_country] then country_weight / rrf_k else 0.0 end) as base_score,
    (recency_weight / rrf_k) * (case
      when e.entry_date is null then 0.0
      when e.entry_date >= current_date - fresh_days then 3.0
      when e.entry_date >= current_date - fresh_days * 2 then 1.5
      when e.entry_date >= current_date - fresh_days * 6 then 0.6
      else 0.0 end) as recency_bonus,
    (e.entry_date is not null and e.entry_date >= current_date - fresh_days) as is_fresh
  from full_text full outer join semantic on full_text.id = semantic.id
  join public.entries e on e.id = coalesce(full_text.id, semantic.id)
),
flagged as (select *, count(*) filter (where is_fresh) over () as fresh_count from fused)
select id, content, summary, source, metadata, countries, entry_type, entry_date, group_id, similarity
from flagged
where (fresh_count >= min_fresh and is_fresh) or (fresh_count < min_fresh)
order by base_score + recency_bonus desc limit least(match_count, 30);
$function$
;

CREATE OR REPLACE FUNCTION public.match_entries_hybrid(query_embedding text, query_text text DEFAULT NULL::text, match_count integer DEFAULT 15, requesting_user_id bigint DEFAULT NULL::bigint, filter_group_id text DEFAULT NULL::text, filter_country text DEFAULT NULL::text, filter_source text DEFAULT NULL::text, full_text_weight double precision DEFAULT 1.0, semantic_weight double precision DEFAULT 1.0, country_weight double precision DEFAULT 1.5, recency_weight double precision DEFAULT 1.0, rrf_k integer DEFAULT 50, fresh_days integer DEFAULT 14, min_fresh integer DEFAULT 5, filter_since date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, content text, summary text, source text, metadata jsonb, countries text[], entry_type text, entry_date date, group_id text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
with params as (
  select query_embedding::vector as qe, nullif(btrim(query_text), '') as qt
),
full_text as (
  select e.id, row_number() over (order by ts_rank_cd(e.fts, websearch_to_tsquery('russian', (select qt from params))) desc) as rank_ix
  from public.entries e, params
  where params.qt is not null and e.fts @@ websearch_to_tsquery('russian', params.qt)
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (filter_since is null or coalesce(e.entry_date, e.created_at::date) >= filter_since)
    and (e.is_private = false or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with))))
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (e.entry_type <> 'meeting' or coalesce(e.metadata->>'confirmed', 'false') = 'true')
  order by rank_ix limit least(match_count, 30) * 2
),
semantic as (
  select e.id, row_number() over (order by e.embedding <=> (select qe from params)) as rank_ix
  from public.entries e
  where e.embedding is not null
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (filter_since is null or coalesce(e.entry_date, e.created_at::date) >= filter_since)
    and (e.is_private = false or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with))))
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (e.entry_type <> 'meeting' or coalesce(e.metadata->>'confirmed', 'false') = 'true')
  order by e.embedding <=> (select qe from params) limit least(match_count, 30) * 2
),
fused as (
  select e.id, e.content, e.summary, e.source, e.metadata, e.countries, e.entry_type, e.entry_date, e.group_id,
    (1 - (e.embedding <=> (select qe from params)))::double precision as similarity,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
    + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    + (case when filter_country is not null and e.countries && array[filter_country] then country_weight / rrf_k else 0.0 end) as base_score,
    (recency_weight / rrf_k) * (case
      when e.entry_date is null then 0.0
      when e.entry_date >= current_date - fresh_days then 3.0
      when e.entry_date >= current_date - fresh_days * 2 then 1.5
      when e.entry_date >= current_date - fresh_days * 6 then 0.6
      else 0.0 end) as recency_bonus,
    (e.entry_date is not null and e.entry_date >= current_date - fresh_days) as is_fresh
  from full_text full outer join semantic on full_text.id = semantic.id
  join public.entries e on e.id = coalesce(full_text.id, semantic.id)
),
flagged as (select *, count(*) filter (where is_fresh) over () as fresh_count from fused)
select id, content, summary, source, metadata, countries, entry_type, entry_date, group_id, similarity
from flagged
where (fresh_count >= min_fresh and is_fresh) or (fresh_count < min_fresh)
order by base_score + recency_bonus desc limit least(match_count, 30);
$function$
;

CREATE OR REPLACE FUNCTION public.match_entries(query_embedding text, match_threshold double precision DEFAULT 0.3, match_count integer DEFAULT 15, requesting_user_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id uuid, content text, summary text, source text, metadata jsonb, countries text[], entry_type text, entry_date date, group_id text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    e.id,
    e.content,
    e.summary,
    e.source,
    e.metadata,
    e.countries,
    e.entry_type,
    e.entry_date,
    e.group_id,
    1 - (e.embedding <=> query_embedding::vector) as similarity
  from entries e
  where
    1 - (e.embedding <=> query_embedding::vector) > match_threshold
    and (
      e.is_private = false
      or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with)))
    )
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (
      e.entry_type <> 'meeting'
      or coalesce(e.metadata->>'confirmed', 'false') = 'true'
    )
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$function$
;

-- ── Нечёткий поиск по стране для ассистента бота ──────────────────────────────────────────
-- Решение владельца 01.10.2026: «бот который сворм брейн должен уметь искать в базе. шансы
-- использования минимальны, но он должен уметь». Прежняя сигнатура (country_query) не знала
-- ни воркспейса, ни смотрящего — снимается; код её больше не зовёт (проверено grep и по
-- pg_proc на проде: других функций, ссылающихся на неё, нет). Новая — то же правило видимости,
-- что у поиска выше, плюс воркспейс обязателен: без него (null) строк нет.
drop function if exists public.search_entries_by_country(text);

create or replace function public.search_entries_by_country(
  country_query text,
  p_group_id text,
  requesting_user_id bigint
)
 RETURNS TABLE(id uuid, content text, summary text, source text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.id, e.content, e.summary, e.source
  from public.entries e
  where e.group_id = p_group_id
    and (e.is_private = false or (requesting_user_id is not null and (e.owner_id = requesting_user_id or requesting_user_id = any(e.shared_with))))
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (e.entry_type <> 'meeting' or coalesce(e.metadata->>'confirmed', 'false') = 'true')
    and exists (select 1 from unnest(e.countries) c where c ilike '%' || country_query || '%')
  order by e.created_at desc
  limit 5;
$function$
;

-- Грант на PUBLIC наследуется в anon/authenticated — снимаем и с него (урок GHSA-vxrp-599j-46hv).
revoke all on function public.search_entries_by_country(text, text, bigint) from public, anon, authenticated;
grant execute on function public.search_entries_by_country(text, text, bigint) to service_role;
