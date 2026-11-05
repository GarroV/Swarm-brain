-- Общая встреча двух пространств (этап 2 решения docs/decisions/2026-11-05-second-workspace.md):
-- признак принадлежности `entries.visible_group_ids`.
--
-- До сих пор у записи было ровно одно пространство — `group_id`. Встреча, на которой были люди
-- из двух команд, видна только одной из них. Теперь:
--   * `group_id` остаётся ДОМАШНИМ пространством записи: по нему идут запись и обработка
--     (claim, дедуп, публикация, ключ OpenAI, права админа);
--   * `visible_group_ids` — где запись видна при ЧТЕНИИ (список, поиск, карточка, дайджест,
--     бот, MCP). Всегда содержит домашнее; лишние пространства бывают только у встреч.
--
-- Инвариант держит триггер, а не код: любой писатель (веб, бот, MCP, Read.ai, Granola,
-- демо-сброс, ручной SQL) получает домашнее в массиве и не может расширить не-встречу.
-- Приватность не меняется: личную запись по-прежнему видят только владелец и `shared_with`,
-- массив круг не расширяет (условие приватности проверяется отдельно и везде).
--
-- Миграция аддитивная: колонка, триггер, индекс, переписанные условия двух поисковых функций.
-- Сигнатуры поисковых функций те же (CREATE OR REPLACE сохраняет гранты); RLS не меняется —
-- включён, политик нет, весь доступ через service_role и проверки в коде.

-- 1. Колонка. Константный DEFAULT — без перезаписи таблицы.
alter table public.entries
  add column if not exists visible_group_ids text[] not null default '{}';

comment on column public.entries.visible_group_ids is
  'Пространства, где запись видна при чтении. Всегда содержит домашнее group_id (триггер entries_visible_group_ids_ensure). Лишние — только у встреч (entry_type=meeting). Приватность (is_private/owner_id/shared_with) проверяется отдельно и массивом не расширяется.';

-- 2. Заполнение существующих строк: массив = {group_id}. updated_at при этом не трогаем —
--    заполнение служебное, а не правка записи (триггер entries_updated_at выключен на время UPDATE).
alter table public.entries disable trigger entries_updated_at;
update public.entries
   set visible_group_ids = array[group_id]
 where group_id is not null
   and visible_group_ids = '{}';
alter table public.entries enable trigger entries_updated_at;

-- 3. Инвариант.
create or replace function public.entries_visible_group_ids_ensure()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Нет домашнего пространства — записи не видно нигде (fail-closed).
  if new.group_id is null then
    new.visible_group_ids := '{}';
    return new;
  end if;
  -- Делиться можно только встречей: всё остальное видно только дома.
  if new.entry_type is distinct from 'meeting' then
    new.visible_group_ids := array[new.group_id];
    return new;
  end if;
  -- Встреча: домашнее всегда в массиве, без повторов и пустых значений, порядок стабильный.
  new.visible_group_ids := array(
    select distinct g
      from unnest(coalesce(new.visible_group_ids, '{}') || array[new.group_id]) as g
     where g is not null and btrim(g) <> ''
     order by g
  );
  return new;
end;
$$;

-- Урок GHSA-vxrp: функции по умолчанию исполняемы для PUBLIC. Триггерную не вызвать как RPC,
-- но права закрываем явно, как в 20261027120001.
revoke execute on function public.entries_visible_group_ids_ensure() from public, anon, authenticated;
grant execute on function public.entries_visible_group_ids_ensure() to service_role;

drop trigger if exists entries_visible_group_ids_ensure on public.entries;
create trigger entries_visible_group_ids_ensure
  before insert or update of group_id, visible_group_ids, entry_type on public.entries
  for each row execute function public.entries_visible_group_ids_ensure();

-- 4. Индекс под `visible_group_ids @> {g}` (PostgREST `cs`).
create index if not exists entries_visible_group_ids_gin
  on public.entries using gin (visible_group_ids);

-- 5. Поиск. Тексты — из 20261105120000_search_requires_workspace.sql (match_entries_hybrid, обе
--    перегрузки) и 20261002100000_entries_archive.sql (search_entries_by_country) без изменений,
--    кроме условия на пространство: `e.group_id = X` → `X = any(e.visible_group_ids)`.
--    NULL в фильтре по-прежнему даёт пустой результат (`null = any(...)` не истинно).

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
    and filter_group_id = any(e.visible_group_ids)
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
    and filter_group_id = any(e.visible_group_ids)
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
    and filter_group_id = any(e.visible_group_ids)
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
    and filter_group_id = any(e.visible_group_ids)
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
  where p_group_id = any(e.visible_group_ids)
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

-- Грант держим явным, как в 20261001120000 и 20261002100000 (урок GHSA-vxrp-599j-46hv).
revoke all on function public.search_entries_by_country(text, text, bigint) from public, anon, authenticated;
grant execute on function public.search_entries_by_country(text, text, bigint) to service_role;
