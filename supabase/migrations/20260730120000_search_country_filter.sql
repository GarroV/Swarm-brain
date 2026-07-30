-- Поиск: страна как ФИЛЬТР, а не только буст.
-- Мотив (владелец 2026-07-30): запрос «по Сербии» тянул венгерские/словенские встречи —
-- страна раньше лишь чуть поднимала совпавших (буст), но НИКОГО не отсекала. Теперь: когда в
-- запросе явно названа страна (filter_country), пул кандидатов (FTS + семантика) ограничивается
-- записями этой страны ИЛИ общекомандными (General). Встречи, тегнутые ТОЛЬКО другой страной,
-- в страновую выдачу больше не попадают. Буст по стране/свежести (country_weight/recency) сохранён —
-- он поднимает RS-специфичные ВЫШЕ General внутри уже отфильтрованного пула.
--
-- Signature НЕ меняется (те же 14 параметров, что в 20260724130000) → CREATE OR REPLACE заменяет
-- тело функции на месте, без дропа/неоднозначности перегрузок.

create or replace function public.match_entries_hybrid(
  query_embedding text,
  query_text text default null,
  match_count int default 15,
  requesting_user_id bigint default null,
  filter_group_id text default null,
  filter_country text default null,
  filter_source text default null,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  country_weight float default 1.5,
  recency_weight float default 1.0,
  rrf_k int default 50,
  fresh_days int default 14,
  min_fresh int default 5
)
returns table(
  id uuid, content text, summary text, source text, metadata jsonb,
  countries text[], entry_type text, entry_date date, group_id text,
  similarity double precision
)
language sql stable
set search_path to 'public', 'extensions'
as $function$
with params as (
  select query_embedding::vector as qe, nullif(btrim(query_text), '') as qt
),
full_text as (
  select e.id,
    row_number() over (
      order by ts_rank_cd(e.fts, websearch_to_tsquery('russian', (select qt from params))) desc
    ) as rank_ix
  from public.entries e, params
  where params.qt is not null
    and e.fts @@ websearch_to_tsquery('russian', params.qt)
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    -- страна как фильтр: только записи этой страны ИЛИ общекомандные (General)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select e.id,
    row_number() over (order by e.embedding <=> (select qe from params)) as rank_ix
  from public.entries e
  where e.embedding is not null
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    -- страна как фильтр (та же, что для FTS)
    and (filter_country is null or e.countries && array[filter_country] or e.countries && array['General'])
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by e.embedding <=> (select qe from params)
  limit least(match_count, 30) * 2
),
fused as (
  select
    e.id, e.content, e.summary, e.source, e.metadata, e.countries, e.entry_type, e.entry_date, e.group_id,
    (1 - (e.embedding <=> (select qe from params)))::double precision as similarity,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
    + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    + (case when filter_country is not null and e.countries && array[filter_country]
            then country_weight / rrf_k else 0.0 end) as base_score,
    (recency_weight / rrf_k) * (case
      when e.entry_date is null then 0.0
      when e.entry_date >= current_date - fresh_days     then 3.0
      when e.entry_date >= current_date - fresh_days * 2 then 1.5
      when e.entry_date >= current_date - fresh_days * 6 then 0.6
      else 0.0 end) as recency_bonus,
    (e.entry_date is not null and e.entry_date >= current_date - fresh_days) as is_fresh
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join public.entries e on e.id = coalesce(full_text.id, semantic.id)
),
flagged as (
  select *, count(*) filter (where is_fresh) over () as fresh_count from fused
)
select id, content, summary, source, metadata, countries, entry_type, entry_date, group_id, similarity
from flagged
where (fresh_count >= min_fresh and is_fresh) or (fresh_count < min_fresh)
order by base_score + recency_bonus desc
limit least(match_count, 30);
$function$;
