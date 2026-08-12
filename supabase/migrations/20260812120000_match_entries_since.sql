-- RAG на временных запросах («за последние 2 недели») промахивался: кандидатный пул набирается
-- по similarity/full-text ПЕРВЫМ (top-N по вектору), и свежие, но семантически «непохожие» записи
-- в него не попадают → fresh-gate их уже не спасает (issue #17). Добавляем filter_since: жёсткий
-- фильтр по дате в ОБОИХ CTE (full_text + semantic), чтобы при временном запросе пул набирался
-- из окна. Аддитивно: filter_since = NULL → поведение прежнее (обратная совместимость).
create or replace function public.match_entries_hybrid(
  query_embedding text,
  query_text text default null::text,
  match_count integer default 15,
  requesting_user_id bigint default null::bigint,
  filter_group_id text default null::text,
  filter_country text default null::text,
  filter_source text default null::text,
  full_text_weight double precision default 1.0,
  semantic_weight double precision default 1.0,
  country_weight double precision default 1.5,
  recency_weight double precision default 1.0,
  rrf_k integer default 50,
  fresh_days integer default 14,
  min_fresh integer default 5,
  filter_since date default null::date
)
returns table(id uuid, content text, summary text, source text, metadata jsonb, countries text[], entry_type text, entry_date date, group_id text, similarity double precision)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
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
$function$;
