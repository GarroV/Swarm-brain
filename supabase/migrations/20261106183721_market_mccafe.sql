-- #896: fold the automatically discovered McCafé alias into McDonald's in ES/PL/HU.
-- Data-only, atomic and idempotent. Keep historical/distinct locations and all IDs we retain.
-- Unexpected curated metadata or non-location references require separate review, not deletion.
do $migration$
declare
  point public.mkt_locations%rowtype;
  duplicate_id uuid;
begin
  if not exists (select 1 from public.mkt_chains where country in ('ES','PL','HU') and key = 'mccafe') then
    return;
  end if;

  if exists (
    select 1 from public.mkt_chains a
    where a.country in ('ES','PL','HU') and a.key = 'mccafe'
      and not exists (select 1 from public.mkt_chains c where c.country = a.country and c.key = 'mcdonalds')
  ) then
    raise exception 'canonical McDonald''s chain is missing for a McCafé alias';
  end if;

  if exists (
    select 1 from public.mkt_chains where country in ('ES','PL','HU') and key = 'mccafe'
      and (regexp_replace(lower(normalize(name, NFD)), '[^a-z]', '', 'g') <> 'mccafe'
        or nullif(btrim(origin), '') is not null or nullif(btrim(operator), '') is not null
        or nullif(btrim(first_entry), '') is not null or nullif(btrim(notes), '') is not null
        or (hist is not null and hist not in ('{}'::jsonb, 'null'::jsonb)))
  ) then
    raise exception 'McCafé has curated metadata: review and preserve it before merging';
  end if;

  if exists (select 1 from public.mkt_prices where country in ('ES','PL','HU') and chain_key = 'mccafe')
    or exists (select 1 from public.mkt_companies where country in ('ES','PL','HU') and chain_key = 'mccafe')
    or exists (select 1 from public.mkt_ratings where country in ('ES','PL','HU') and chain_key = 'mccafe')
    or exists (select 1 from public.mkt_sources where country in ('ES','PL','HU') and chain_key = 'mccafe')
    or exists (select 1 from public.mkt_editorial where country in ('ES','PL','HU') and payload::text like '%"mccafe"%')
    or exists (select 1 from public.mkt_candidates where country in ('ES','PL','HU') and payload::text like '%"mccafe"%')
    or exists (
      select 1 from public.mkt_ratings r join public.mkt_locations l on r.location_id = l.id
      where l.country in ('ES','PL','HU') and l.chain_key = 'mccafe'
    )
    or exists (
      select 1 from public.mkt_candidates c join public.mkt_locations l on c.target_id = l.id
      where l.country in ('ES','PL','HU') and l.chain_key = 'mccafe'
    ) then
    raise exception 'McCafé has non-location references: review them before merging';
  end if;

  -- Same street normalization as _shared/market/geo.ts: first address part, NFD,
  -- no accents / ulica prefix, ASCII letters and digits, with a house number.
  -- A session-local helper leaves no persistent schema object.
  create or replace function pg_temp.swarm_mccafe_street_key(v text)
  returns text language sql immutable strict as $normalize$
    with street as (
      select btrim(regexp_replace(
        regexp_replace(lower(regexp_replace(normalize(split_part(split_part(v, ',', 1), '(', 1), NFD),
          U&'[\0300-\036f]', '', 'g')), '\mul(ica)?\M\.?', ' ', 'g'),
        '[^a-z0-9]+', ' ', 'g')) as value
    )
    select case when value ~ '[0-9]' and value ~ '[a-z]{3}' then value else null end from street
  $normalize$;

  for point in
    select * from public.mkt_locations
    where country in ('ES','PL','HU') and chain_key = 'mccafe' order by id
  loop
    duplicate_id := null;
    -- Only an uncurated live machine mirror may be removed. Preserve dated,
    -- manually checked and closed records even when the coordinates overlap.
    if point.source_kind in ('osm','overture') and point.verification = 'unverified'
      and point.status = 'open' and point.opened is null and point.closed is null
      and nullif(btrim(point.verification_note), '') is null then
      select candidate.id into duplicate_id
      from (
        select l.id, l.address,
          2 * 6371000 * asin(least(1.0, sqrt(greatest(0.0,
            power(sin(radians((l.lat - point.lat) / 2)), 2)
            + cos(radians(point.lat)) * cos(radians(l.lat)) * power(sin(radians((l.lng - point.lng) / 2)), 2)
          )))) as distance
        from public.mkt_locations l
        where l.country = point.country and l.chain_key = 'mcdonalds' and l.status = 'open'
      ) candidate
      where candidate.distance <= 25
        or (candidate.distance <= 5000 and pg_temp.swarm_mccafe_street_key(point.address) is not null
          and pg_temp.swarm_mccafe_street_key(candidate.address) = pg_temp.swarm_mccafe_street_key(point.address))
      order by candidate.distance, candidate.id limit 1;
    end if;

    if duplicate_id is not null then
      delete from public.mkt_locations where id = point.id;
    else
      update public.mkt_locations set chain_key = 'mcdonalds' where id = point.id;
    end if;
  end loop;

  delete from public.mkt_chains where country in ('ES','PL','HU') and key = 'mccafe';
end
$migration$;
