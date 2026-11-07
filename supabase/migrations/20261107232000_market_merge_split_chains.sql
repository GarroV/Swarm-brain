-- #1134, owner decision 07.11.2026: «мусорные» сети — одна сеть, записанная под чужим названием, сливаются
-- в основную. Prod read 2026-11-07: ES «llaollao Saudi Arabia» (85) и «llaollao Taiwan» (83) — это испанские
-- точки llaollao (бренды мастер-франшиз; 77 мест записаны в обеих), CY «Coffee Island Θεσσαλονίκη…» (14) —
-- кипрские точки Coffee Island с греческим адресом франшизы в названии. Collector fix: ES.chains.llaollao,
-- CY.chains.coffee-island (бренд — по началу названия).
-- For each source chain: a machine row with a neighbour (<= 50 m) already in the target chain is deleted,
-- every other row moves to the target chain; the emptied source chain goes. Idempotent: no source chain = no-op.
-- A source chain with curated data or references is skipped with a warning, never touched.
do $migration$
declare
  merges constant jsonb := $merges$[
    {"country": "ES", "from": "llaollao-saudi-arabia", "to": "llaollao"},
    {"country": "ES", "from": "llaollao-taiwan", "to": "llaollao"},
    {"country": "CY", "from": "coffee-island-139", "to": "coffee-island"}
  ]$merges$::jsonb;
  m jsonb;
  v_country text;
  v_from text;
  v_to text;
  src public.mkt_locations%rowtype;
  moved integer;
  dropped integer;
begin
  create or replace function pg_temp.swarm_merge_distance(a1 float8, o1 float8, a2 float8, o2 float8)
  returns float8 language sql immutable as $f$
    select 2 * 6371000 * asin(least(1.0, sqrt(greatest(0.0,
      power(sin(radians((a2 - a1) / 2)), 2)
      + cos(radians(a1)) * cos(radians(a2)) * power(sin(radians((o2 - o1) / 2)), 2)))))
  $f$;

  for m in select * from jsonb_array_elements(merges) loop
    v_country := m->>'country';
    v_from := m->>'from';
    v_to := m->>'to';
    if not exists (select 1 from public.mkt_chains where country = v_country and key = v_from) then
      continue;
    end if;
    if not exists (select 1 from public.mkt_chains where country = v_country and key = v_to) then
      raise warning 'chain % % skipped: the target chain % is missing', v_country, v_from, v_to;
      continue;
    end if;

    if exists (
      select 1 from public.mkt_chains where country = v_country and key = v_from
        and (origin is not null or operator is not null or first_entry is not null or notes is not null or hist is not null)
    ) or exists (
      select 1 from public.mkt_locations where country = v_country and chain_key = v_from
        and (source_kind <> 'overture' or verification <> 'unverified' or status <> 'open'
          or opened is not null or closed is not null or opened_estimated
          or placement is not null or format is not null or verification_note is not null)
    ) then
      raise warning 'chain % % skipped: it has curated data, review before merging', v_country, v_from;
      continue;
    end if;
    if exists (select 1 from public.mkt_prices where country = v_country and chain_key = v_from)
      or exists (select 1 from public.mkt_companies where country = v_country and chain_key = v_from)
      or exists (select 1 from public.mkt_sources where country = v_country and chain_key = v_from)
      or exists (select 1 from public.mkt_ratings r
        where (r.country = v_country and r.chain_key = v_from)
          or r.location_id in (select id from public.mkt_locations where country = v_country and chain_key = v_from))
      or exists (select 1 from public.mkt_editorial e
        where e.country = v_country and strpos(e.payload::text, v_from) > 0)
      or exists (select 1 from public.mkt_candidates c
        where (c.country = v_country and strpos(c.payload::text, v_from) > 0)
          or c.target_id in (select id from public.mkt_locations where country = v_country and chain_key = v_from))
      or exists (select 1 from public.mkt_facts f
        where f.country = v_country and strpos(concat_ws(' ', f.text, f.value, f.source), v_from) > 0) then
      raise warning 'chain % % skipped: it has references, review before merging', v_country, v_from;
      continue;
    end if;

    moved := 0;
    dropped := 0;
    for src in
      select * from public.mkt_locations where country = v_country and chain_key = v_from
      order by first_seen_at, id
    loop
      if exists (
        select 1 from public.mkt_locations t
        where t.country = v_country and t.chain_key = v_to
          and pg_temp.swarm_merge_distance(t.lat, t.lng, src.lat, src.lng) <= 50
      ) then
        delete from public.mkt_locations where id = src.id;
        dropped := dropped + 1;
      else
        update public.mkt_locations
        set chain_key = v_to,
            ext_key = case
              when ext_key like v_from || ':%' and not exists (
                select 1 from public.mkt_locations x
                where x.country = v_country and x.ext_key = v_to || ':' || substr(src.ext_key, length(v_from) + 2))
              then v_to || ':' || substr(ext_key, length(v_from) + 2) else ext_key end
        where id = src.id;
        moved := moved + 1;
      end if;
    end loop;
    delete from public.mkt_chains where country = v_country and key = v_from;
    raise notice 'chain % % merged into %: % moved, % dropped as duplicates', v_country, v_from, v_to, moved, dropped;
  end loop;
end
$migration$;
