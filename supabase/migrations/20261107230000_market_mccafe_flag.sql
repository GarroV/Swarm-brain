-- #1113: McCafé next to a McDonald's is the marker «with McCafé» (mkt_locations.format) on the McDonald's
-- point; a standalone McCafé is its own chain `mccafe`, in every country (owner decision 07.11.2026:
-- «в литве раз маккафе это отдельно - значит и показывай отдельно. там где мак+маккафе - ставишь одну точку»).
-- Data-only, atomic and idempotent (a second run finds nothing to change).
--   (a) two exact McDonald's duplicates in ES (the ids were read from prod 07.11.2026): the later row goes,
--       the earlier first_seen_at stays;
--   (b) an open machine McCafé next to an open machine McDonald's (<= 50 m, house numbers do not disagree)
--       is deleted and the McDonald's point gets the marker;
--   (c) every other McCafé (named so, under mcdonalds or already under mccafe) lives in chain `mccafe`,
--       created per country when missing, without the marker; nothing is deleted from them;
--   (d) six exact duplicates of other chains named by the owner (same chain, same address, <= 50 m).
-- Rows that ratings or candidates point at are never deleted: such a pair is skipped with a notice.
do $migration$
declare
  marker constant text := 'with McCafé';
  cafe public.mkt_locations%rowtype;
  dup record;
  pair record;
  target uuid;
  loser uuid;
  moved integer := 0;
  merged integer := 0;
begin
  create or replace function pg_temp.swarm_mccafe_distance(a1 float8, o1 float8, a2 float8, o2 float8)
  returns float8 language sql immutable as $f$
    select 2 * 6371000 * asin(least(1.0, sqrt(greatest(0.0,
      power(sin(radians((a2 - a1) / 2)), 2)
      + cos(radians(a1)) * cos(radians(a2)) * power(sin(radians((o2 - o1) / 2)), 2)))))
  $f$;

  -- Lower case, no accents, letters and digits only.
  create or replace function pg_temp.swarm_mccafe_fold(v text)
  returns text language sql immutable as $f$
    select regexp_replace(lower(regexp_replace(normalize(coalesce(v, ''), NFD), U&'[\0300-\036f]', '', 'g')),
      '[^a-z0-9]+', '', 'g')
  $f$;

  create or replace function pg_temp.swarm_mccafe_is_cafe(v text)
  returns boolean language sql immutable as $f$
    select regexp_replace(lower(normalize(coalesce(v, ''), NFD)), U&'[\0300-\036f]', '', 'g') ~ '\mmc ?cafe\M'
  $f$;

  -- True when both addresses carry house numbers and none of the digit runs is shared.
  create or replace function pg_temp.swarm_mccafe_numbers_conflict(a text, b text)
  returns boolean language sql immutable as $f$
    with n as (
      select array(select m[1] from regexp_matches(coalesce(a, ''), '\d+', 'g') m) as x,
             array(select m[1] from regexp_matches(coalesce(b, ''), '\d+', 'g') m) as y
    )
    select cardinality(x) > 0 and cardinality(y) > 0 and not (x && y) from n
  $f$;

  create or replace function pg_temp.swarm_mccafe_referenced(p uuid)
  returns boolean language sql stable as $f$
    select exists (select 1 from public.mkt_ratings where location_id = p)
      or exists (select 1 from public.mkt_candidates where target_id = p)
  $f$;

  -- (a) exact McDonald's duplicates in ES: both rows must still be untouched machine rows.
  for dup in
    select * from (values
      ('0f6b4b2e-1835-4a09-a253-d0d2fb0bbaf3'::uuid, '32411021-436d-4a61-9f87-5f04b255331a'::uuid),
      ('11da3296-f03e-498a-917d-fd74abb09ac4'::uuid, '61ae1156-5377-40cb-a435-8c5f14312fa7'::uuid)
    ) as t(keeper, later)
  loop
    select a.id as keeper, b.id as later into pair
    from public.mkt_locations a, public.mkt_locations b
    where a.id = dup.keeper and b.id = dup.later
      and a.country = 'ES' and b.country = 'ES' and a.chain_key = 'mcdonalds' and b.chain_key = 'mcdonalds'
      and a.source_kind in ('osm','overture') and b.source_kind in ('osm','overture')
      and a.verification = 'unverified' and b.verification = 'unverified'
      and a.status = 'open' and b.status = 'open'
      and pg_temp.swarm_mccafe_distance(a.lat, a.lng, b.lat, b.lng) <= 50;
    if not found then continue; end if;
    -- the earlier first_seen_at stays (the ids above are in that order; re-check it on prod data)
    if (select first_seen_at from public.mkt_locations where id = dup.later)
       < (select first_seen_at from public.mkt_locations where id = dup.keeper) then
      raise notice 'duplicate % / % skipped: the order of first_seen_at changed', dup.keeper, dup.later;
      continue;
    end if;
    if pg_temp.swarm_mccafe_referenced(dup.later) then
      raise notice 'duplicate % skipped: the later row is referenced', dup.later;
      continue;
    end if;
    delete from public.mkt_locations where id = dup.later;
  end loop;

  -- (b) + (c) McCafé points: merge into the neighbouring McDonald's, else live in chain mccafe.
  for cafe in
    select * from public.mkt_locations
    where chain_key in ('mcdonalds', 'mccafe') and pg_temp.swarm_mccafe_is_cafe(name)
    order by id
  loop
    target := null;
    if cafe.source_kind in ('osm','overture') and cafe.verification = 'unverified'
      and cafe.status = 'open' and cafe.opened is null and cafe.closed is null
      and nullif(btrim(cafe.verification_note), '') is null
      and not pg_temp.swarm_mccafe_referenced(cafe.id) then
      select l.id into target
      from public.mkt_locations l
      where l.country = cafe.country and l.chain_key = 'mcdonalds' and l.id <> cafe.id
        and not pg_temp.swarm_mccafe_is_cafe(l.name)
        and l.source_kind in ('osm','overture') and l.verification = 'unverified'
        and l.status = 'open' and l.opened is null and l.closed is null
        and nullif(btrim(l.verification_note), '') is null
        and (l.format is null or l.format = marker)
        and pg_temp.swarm_mccafe_distance(l.lat, l.lng, cafe.lat, cafe.lng) <= 50
        and not pg_temp.swarm_mccafe_numbers_conflict(l.address, cafe.address)
      order by pg_temp.swarm_mccafe_distance(l.lat, l.lng, cafe.lat, cafe.lng), l.id
      limit 1;
    end if;

    if target is not null then
      update public.mkt_locations set format = marker where id = target and format is distinct from marker;
      delete from public.mkt_locations where id = cafe.id;
      merged := merged + 1;
    elsif cafe.chain_key = 'mcdonalds' then
      -- Standalone: its own chain, no marker. The chain is created per country, after the last slot.
      insert into public.mkt_chains (country, key, name, slot, segment)
      select cafe.country, 'mccafe', 'McCafé', coalesce(max(slot), 0) + 1, 'coffee'
      from public.mkt_chains where country = cafe.country
      on conflict (country, key) do nothing;
      update public.mkt_locations
      set chain_key = 'mccafe',
          ext_key = case
            when ext_key like 'mcdonalds:%' and not exists (
              select 1 from public.mkt_locations x
              where x.country = cafe.country and x.ext_key = 'mccafe:' || substr(cafe.ext_key, 11))
            then 'mccafe:' || substr(ext_key, 11) else ext_key end,
          format = case when format = marker then null else format end
      where id = cafe.id;
      moved := moved + 1;
    elsif cafe.format = marker then
      update public.mkt_locations set format = null where id = cafe.id;
    end if;
  end loop;
  raise notice 'McCafé: % merged into a McDonald''s point, % moved to chain mccafe', merged, moved;

  -- (d) exact duplicates: the earlier first_seen_at stays.
  for dup in
    select * from (values
      ('ES','burgerking','CC Diversia - Av. de Bruselas, 21, 28108, Alcobendas, Madrid'),
      ('HU','pizzahut','Könyves Kálmán körút 12'),
      ('HU','pizzahut','Pünkösdfürdő utca 52'),
      ('KG','mubarak','улица Киев 208'),
      ('RO','kfc','Bulevardul Traian 5'),
      ('SI','zito','Slovenska cesta 58')
    ) as t(country, chain_key, address)
  loop
    select a.id as keeper, b.id as later into pair
    from public.mkt_locations a
    join public.mkt_locations b
      on a.id <> b.id and a.country = b.country and a.chain_key = b.chain_key
      and (a.first_seen_at, a.id) < (b.first_seen_at, b.id)
    where a.country = dup.country and a.chain_key = dup.chain_key
      and pg_temp.swarm_mccafe_fold(a.address) = pg_temp.swarm_mccafe_fold(dup.address)
      and pg_temp.swarm_mccafe_fold(b.address) = pg_temp.swarm_mccafe_fold(dup.address)
      and a.source_kind in ('osm','overture') and b.source_kind in ('osm','overture')
      and a.verification = 'unverified' and b.verification = 'unverified'
      and a.status = 'open' and b.status = 'open'
      and pg_temp.swarm_mccafe_distance(a.lat, a.lng, b.lat, b.lng) <= 50
    order by a.first_seen_at, a.id, b.first_seen_at, b.id
    limit 1;
    if not found then continue; end if;
    loser := pair.later;
    if pg_temp.swarm_mccafe_referenced(loser) then
      raise notice 'duplicate % % skipped: the later row is referenced', dup.country, dup.address;
      continue;
    end if;
    delete from public.mkt_locations where id = loser;
  end loop;
end
$migration$;
