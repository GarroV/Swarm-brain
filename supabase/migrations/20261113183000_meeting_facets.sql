-- #104: one snapshot of the disjoint pending/confirmed branches, independent of page size.
-- Preserve each existing route predicate; never add the independently read queue a second time.
create function public.get_meeting_facets(p_group text, p_viewer bigint, p_email text default null)
returns jsonb language sql stable security invoker set search_path = '' as $function$
with visible as materialized (
  select e.id, e.owner_id, e.added_by, e.source, e.countries,
         e.metadata->'added_by_telegram_id' as metadata_actor,
         e.metadata->'recorded_by' as recorded_by,
         row_number() over (order by case when e.metadata->>'confirmed'='true' then 1 else 0 end, e.created_at desc, e.id desc) as position
    from public.entries e
   where e.entry_type = 'meeting' and e.archived_at is null
     and p_group ~ '^[A-Za-z0-9_-]+$' and e.visible_group_ids @> array[p_group]
     and (
       (e.metadata->>'confirmed' = 'true' and
         (e.is_private = false or e.owner_id = p_viewer or e.shared_with @> array[p_viewer]))
       or ((e.metadata->>'confirmed' is null or e.metadata->>'confirmed' = 'false') and
         (e.owner_id = p_viewer or (
           coalesce(lower(btrim(p_email)), '') ~ $email$^[^\s,()"']+@[^\s,()"']+$$email$
           and e.metadata->'attendees' @> jsonb_build_array(jsonb_build_object('email', lower(btrim(p_email))))
         )))
     )
), country_groups as (
  select c.value, count(*) as n, min(v.position) as position, min(c.ordinality) as ordinal
    from visible v cross join lateral unnest(
      case when cardinality(v.countries) > 0 then v.countries else array['—'] end
    ) with ordinality as c(value, ordinality)
   group by c.value
), source_groups as (
  select source, recorded_by, count(*) as n, min(position) as position
    from visible group by source, recorded_by
), author_groups as (
  select owner_id, metadata_actor, added_by, count(*) as n, min(position) as position,
    case when owner_id is null and not coalesce(
      jsonb_typeof(metadata_actor) = 'number' or
      (jsonb_typeof(metadata_actor) = 'string' and metadata_actor #>> '{}' ~ '^-?\d+$'), false)
    then jsonb_agg(id order by position) else '[]'::jsonb end as fallback_ids
    from visible group by owner_id, metadata_actor, added_by
)
select jsonb_build_object(
  'includesPending', true,
  'total', (select count(*) from visible),
  'emptyCountries', (select count(*) from visible where countries is null or cardinality(countries)=0),
  'countries', (select coalesce(jsonb_agg(jsonb_build_array(value,n) order by position,ordinal), '[]'::jsonb) from country_groups),
  'sources', (select coalesce(jsonb_agg(jsonb_build_object('source',source,'recorded_by',recorded_by,'count',n) order by position), '[]'::jsonb) from source_groups),
  'authors', (select coalesce(jsonb_agg(jsonb_build_object('owner_id',owner_id,'metadata_actor',metadata_actor,'added_by',added_by,'count',n,'fallback_ids',fallback_ids) order by position), '[]'::jsonb) from author_groups)
);
$function$;
comment on function public.get_meeting_facets(text,bigint,text) is
 'Backend-only complete meeting union under buildEntriesQuery / buildReviewQueueQuery rules in one snapshot; no text payload.';
revoke all on function public.get_meeting_facets(text,bigint,text) from public, anon, authenticated;
grant execute on function public.get_meeting_facets(text,bigint,text) to service_role;
