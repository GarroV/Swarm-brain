-- Гибридный поиск: full-text (русский tsvector) + семантика (pgvector) через RRF,
-- с бустом по стране (тег countries) и свежести (entry_date). Мотив: чистая семантика на
-- однотипных встречах коллапсирует (все тезисы в полосе cos 0.29–0.67; случайный 1-1 «ближе»,
-- чем вторая встреча той же серии) → выдача «вразнобой». Full-text отделяет по точному слову,
-- страна — по курируемому тегу, свежесть — тайбрейк. Порог по косинусу больше не нужен (RRF ранжирует).
--
-- Безопасно: ADD COLUMN (генерируемая) + индекс + новая функция. Старый match_entries не трогаем
-- (остаётся для отката). Применение на прод — через Management API (supabase db query/apply_migration),
-- НЕ db push (леджер миграций дрейфит). 00_base_schema.sql синхронизируется тем же изменением.

-- 1) Полнотекстовый вектор по контенту (русская конфигурация) + GIN-индекс.
alter table public.entries
  add column if not exists fts tsvector
  generated always as (to_tsvector('russian', coalesce(content, ''))) stored;

create index if not exists idx_entries_fts on public.entries using gin (fts);

-- 2) Гибридный RPC. query_text=null → ведёт себя как чистая семантика (обратная совместимость).
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
  recency_weight float default 0.6,
  rrf_k int default 50
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
  select
    query_embedding::vector as qe,
    nullif(btrim(query_text), '') as qt
),
full_text as (
  -- Кандидаты по точному слову (только если есть текст запроса). AND-семантика websearch.
  select e.id,
    row_number() over (
      order by ts_rank_cd(e.fts, websearch_to_tsquery('russian', (select qt from params))) desc
    ) as rank_ix
  from public.entries e, params
  where params.qt is not null
    and e.fts @@ websearch_to_tsquery('russian', params.qt)
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  -- Кандидаты по смыслу (всегда).
  select e.id,
    row_number() over (order by e.embedding <=> (select qe from params)) as rank_ix
  from public.entries e
  where e.embedding is not null
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by e.embedding <=> (select qe from params)
  limit least(match_count, 30) * 2
)
select
  e.id, e.content, e.summary, e.source, e.metadata, e.countries, e.entry_type, e.entry_date, e.group_id,
  (1 - (e.embedding <=> (select qe from params)))::double precision as similarity
from full_text
full outer join semantic on full_text.id = semantic.id
join public.entries e on e.id = coalesce(full_text.id, semantic.id)
order by
  -- RRF: сигнал, попавший и в текст, и в смысл — наверх.
  coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
  + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
  -- Буст страны (линза, не стена): тег BG поднимает и профильные, и общие встречи с этой страной.
  + (case when filter_country is not null and e.countries && array[filter_country]
          then country_weight / rrf_k else 0.0 end)
  -- Свежесть-тайбрейк: новее — выше при равной релевантности. null-дата → 0.
  + coalesce((recency_weight / rrf_k) * (1.0 / (1 + greatest(0, (current_date - e.entry_date)) / 30.0)), 0.0)
  desc
limit least(match_count, 30);
$function$;
