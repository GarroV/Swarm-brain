-- Встречи и записи при удалении не стираются, а архивируются — как задачи (#569).
--
-- Владелец 28.09.2026, дословно: «давай заведем такую же систему как для задач что встречи рпи
-- удалении не удаляются и архивируются». Продолжение 20260921140000_soft_delete_archive.sql
-- (#427): там архив введён для задач, проектов, пространств и спринтов, `entries` не вошли.
--
-- Что здесь.
--   1. Колонки `archived_at` / `archived_by` — аддитивно (ADD COLUMN без дефолта, без переписывания
--      таблицы). Поведение — в коде: удаление в вебе, боте и MCP ставит `archived_at`
--      (`_shared/entries/archive.ts`), выборки читают живое (`_shared/entries/live.ts`, сторож
--      `live.guard.test.ts`).
--   2. Поиск исключает архив: `match_entries`, обе перегрузки `match_entries_hybrid` (в каждой
--      условие стоит дважды — full-text и векторная ветки) и `search_entries_by_country`. Тексты
--      функций — из 20261001120000 без изменений, кроме строки `and e.archived_at is null`.
--      CREATE OR REPLACE с той же сигнатурой сохраняет гранты; функции не SECURITY DEFINER.
--
-- Индекса намеренно НЕТ — по той же причине, что у задач: архив будет редким, условие почти
-- ничего не отсекает, и частичный индекс лишь повторил бы существующие. Появится заметный
-- архив — заведём по факту.

alter table public.entries
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint;

comment on column public.entries.archived_at is
  'Момент архивации (мягкое удаление). NULL = живая. Физически записи не удаляем — решение владельца 28.09.2026, issue #569. Файл в Storage при архивации остаётся, отдача файла проверяет живую запись.';
comment on column public.entries.archived_by is
  'Кто убрал запись (telegram_id; у веб-пользователя без Telegram — отрицательный id). NULL — система.';

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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$function$
;

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
    -- Архивная (удалённая) запись в поиск не попадает (#569).
    and e.archived_at is null
    and exists (select 1 from unnest(e.countries) c where c ilike '%' || country_query || '%')
  order by e.created_at desc
  limit 5;
$function$
;

-- Грант не меняется (CREATE OR REPLACE его сохраняет), но держим явным, как в 20261001120000:
-- грант на PUBLIC наследуется в anon/authenticated (урок GHSA-vxrp-599j-46hv).
revoke all on function public.search_entries_by_country(text, text, bigint) from public, anon, authenticated;
grant execute on function public.search_entries_by_country(text, text, bigint) to service_role;
