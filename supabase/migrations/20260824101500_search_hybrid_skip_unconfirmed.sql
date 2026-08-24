-- Невычитанная встреча не попадает в поиск — ГИБРИДНЫЙ поиск (issue #70, продолжение).
--
-- Миграция 20260824100000 поправила match_entries, но продакшн-поиск ходит НЕ в неё:
-- `_shared/search.ts` вызывает rpc("match_entries_hybrid") — русский full-text + вектор через
-- RRF. Ошибку поймал сам, сверив доку с кодом уже после применения первой миграции.
--
-- У match_entries_hybrid ДВЕ перегрузки (с filter_since и без), и в каждой условие приватности
-- стоит ДВАЖДЫ — отдельно в full-text ветке и в векторной. Правило добавлено во все четыре
-- места: пропустив одно, получили бы дыру ровно в половине запросов.
--
-- Правило то же, что в 20260824100000: entry_type='meeting' попадает в выдачу только при
-- metadata.confirmed='true'; записи других типов (заметки, документы) не затронуты.


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
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
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
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
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
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
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
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
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


