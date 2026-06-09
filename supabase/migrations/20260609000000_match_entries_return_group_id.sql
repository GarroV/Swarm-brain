-- match_entries did not return group_id, so workspace filtering by consumers
-- (swarm-api JS filter, bot/MCP .eq("group_id")) silently dropped ALL results —
-- semantic search returned nothing in the Mini App. Add group_id to the returned
-- table. Signature change requires DROP + CREATE.

DROP FUNCTION IF EXISTS public.match_entries(text, double precision, integer, bigint);

CREATE FUNCTION public.match_entries(
  query_embedding text,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15,
  requesting_user_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(
  id uuid,
  content text,
  summary text,
  source text,
  metadata jsonb,
  countries text[],
  entry_type text,
  entry_date date,
  group_id text,
  similarity double precision
)
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
      or (requesting_user_id is not null and e.owner_id = requesting_user_id)
    )
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$function$;
