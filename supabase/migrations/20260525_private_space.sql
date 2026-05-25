-- Add private space columns to entries
alter table entries
  add column if not exists is_private boolean not null default false,
  add column if not exists owner_id bigint references allowed_users(telegram_id);

create index if not exists entries_owner_id_idx on entries(owner_id);

-- Drop and recreate match_entries to add requesting_user_id parameter.
-- The original function returned all entries. New version filters:
--   - is_private = false (public), OR
--   - owner_id = requesting_user_id (owner's private entries)
-- If requesting_user_id is null, returns only public entries (safe default).

drop function if exists match_entries(text, double precision, integer);
drop function if exists match_entries(text, double precision, integer, bigint);

create or replace function match_entries(
  query_embedding text,
  match_threshold double precision default 0.3,
  match_count integer default 15,
  requesting_user_id bigint default null
)
returns table (
  id uuid,
  content text,
  summary text,
  source text,
  metadata jsonb,
  countries text[],
  entry_type text,
  entry_date date,
  similarity double precision
)
language sql stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.content,
    e.summary,
    e.source,
    e.metadata,
    e.countries,
    e.entry_type,
    e.entry_date,
    1 - (e.embedding <=> query_embedding::vector) as similarity
  from entries e
  where
    1 - (e.embedding <=> query_embedding::vector) > match_threshold
    and (
      e.is_private = false
      or (requesting_user_id is not null and e.owner_id = requesting_user_id)
    )
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$$;
