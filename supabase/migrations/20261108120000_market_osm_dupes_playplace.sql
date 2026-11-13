-- Owner standing rule 08.11.2026: obvious duplicates and garbage are fixed without asking, in every country.
-- Collector rules for the same cases: scripts/market/lib.ts (isPlayground, dropAddresslessTwins) and
-- scripts/market/adapters/osm.ts. Rows below were read from prod 2026-11-08 (SELECT only), 12 machine rows:
--   (1) OSM «McDonald's PlayPlace» (a playground inside a restaurant, not a restaurant):
--       RO cab30947 (44.4486,26.0822; 17 m from RO «Strada Doctor Iacob Felix 8»), RO d08ae384 (46.7466,23.4504;
--       15 m from RO McDonald's 338e6656, which stays), RO afb38fde (44.4442,26.0363; 31 m from the restaurant
--       «Șoseaua Virtuții 27B»), RS e17c84a5 (44.8667,20.6607; 13 m from RS «Првомајска»).
--   (2) OSM same-chain pairs <= 35 m where one point has no address: one place mapped twice (node + building).
--       The addressed point stays, the addressless one goes:
--       EE kfc 9a4a2241 (28 m from «A. H. Tammsaare tee 64/1», keeper af94a8f0);
--       RO mcdonalds a1a22843 (19 m from «Bulevardul Theodor Pallady 50», keeper bf246c83);
--       RO mcdonalds eb5bed62 (8 m from «Șoseaua Virtuții 27B», keeper e0e17409; with the PlayPlace afb38fde
--       the cluster of three collapses to one);
--       RO mcdonalds a8bae0fd (31 m from «Bulevardul Iuliu Maniu 488-490», keeper 1ee9ec65);
--       RS mcdonalds 4c6b58c2 (10 m from «Заплањска 32», keeper c9355dd7);
--       TJ sfc 9f414191 «SFC Chiken» (23 m from «Southern Fried Chicken (SFC)» 5aaa1238, both without address,
--       identical otherwise; the one with the proper name stays).
--   (3) Overture, same place under two spellings:
--       HU mcdonalds 1f076040 «Budaörsi út 112.» (57 m from c36e7bb6 «Budaörsi út 112», the same address after
--       normalisation; the collector already merges them, the pair predates that rule);
--       AZ mcdonalds 0dffaed1 «28 Mall» (55 m from c3cc7a59 «McDonald's 28 Mall», «27 Azadliq Ave»: the same
--       mall; the point with a street address stays).
-- Not touched: curated `snapshot` rows (HR Leggiero Westgate / Westgate Loft share one address — left for review).
-- Every business field is CAS-checked (only automatic freshness timestamps are excluded); a row whose state changed
-- since the snapshot, whose keeper is gone, or which anything references (ratings, candidates, editorial, facts)
-- is skipped with a warning, never deleted. Idempotent: an absent row is a no-op.
do $migration$
declare
  targets constant jsonb := $targets${
  "0dffaed1-ddc2-4a95-8ba6-c033199bce50": {"country": "AZ", "hash": "691ca7033cecb30df774347cfc917cc1", "keeper": "c3cc7a59-4023-4026-8755-78f38abfc787"},
  "1f076040-70e8-4c94-9509-435f310a6fbe": {"country": "HU", "hash": "eb013c5c3a1ba9eb4f7f10cfa7cc3951", "keeper": "c36e7bb6-2652-4984-a347-f5e73039fe01"},
  "4c6b58c2-1afe-425c-8839-cbde49d0a25c": {"country": "RS", "hash": "6b13a2eb1c7215be8dc4b5d2abe349a3", "keeper": "c9355dd7-1d71-41be-aa80-356b410226b2"},
  "9a4a2241-1970-4196-bc6c-599ac81b2082": {"country": "EE", "hash": "4fd1abb59cbe63eed670b7dd1357116d", "keeper": "af94a8f0-b62a-48d7-b1a6-3e60ff783b25"},
  "9f414191-fe0a-4511-a854-c7babc17c17f": {"country": "TJ", "hash": "117eb80c18ccf084aafa7b10ad9e9af8", "keeper": "5aaa1238-7627-4fec-91ce-af40b3ac18a8"},
  "a1a22843-1985-4b06-9143-6464906e69ea": {"country": "RO", "hash": "b58d94324245927c7254859340e0abca", "keeper": "bf246c83-6f26-4919-add3-f771b81aab3c"},
  "a8bae0fd-094e-45da-a3a3-bbc97f8b6cb1": {"country": "RO", "hash": "01d26353bbeb9ed5f430e87654ceb513", "keeper": "1ee9ec65-4e56-4738-b58c-2b4b8154d1ec"},
  "eb5bed62-273f-47f9-a5e9-c63b97646961": {"country": "RO", "hash": "fbd158a82f0c3163bb881e5dcbd2009b", "keeper": "e0e17409-54b2-4a0f-913c-48c6fd0be066"},
  "afb38fde-218f-443b-a627-bbfdf4edd375": {"country": "RO", "hash": "b5791076fea182b6b4e929c5ad7e4fcb", "keeper": null},
  "cab30947-6a12-4b57-8ef3-d10099d7d0c9": {"country": "RO", "hash": "7b2f714abb6c04ed2c30dc7d726e81b5", "keeper": null},
  "d08ae384-17e5-4870-b7d0-b2d782d5cf1c": {"country": "RO", "hash": "4e9952ebfb57c34d454da84c498e35d3", "keeper": null},
  "e17c84a5-bb60-46e9-9a36-88cf2f5d5471": {"country": "RS", "hash": "eca247ee5ad99360b389df9fcea9a9c4", "keeper": null}
}
$targets$::jsonb;
  v_id text;
  target jsonb;
  loc public.mkt_locations%rowtype;
  actual_hash text;
  removed integer;
  deleted integer := 0;
  caller_float_digits constant text := current_setting('extra_float_digits');
  caller_lock_timeout constant text := current_setting('lock_timeout');
begin
  if not exists (
    select 1 from public.mkt_locations l where targets ? l.id::text
  ) then
    return;
  end if;

  perform set_config('lock_timeout', '5s', true);
  perform set_config('extra_float_digits', '3', true);
  -- Protect the CAS and logical references (some have no FK) from concurrent writes.
  -- Refuse after 5 seconds instead of waiting indefinitely for a collector/editor.
  lock table public.mkt_chains, public.mkt_locations, public.mkt_companies,
    public.mkt_prices, public.mkt_ratings, public.mkt_sources, public.mkt_editorial,
    public.mkt_candidates, public.mkt_facts in share row exclusive mode;

  for v_id in select jsonb_object_keys(targets) order by 1 loop
    target := targets->v_id;
    select * into loc from public.mkt_locations where id = v_id::uuid;
    if not found then continue; end if;

    select md5((to_jsonb(l)-array['first_seen_at','last_seen_at'])::text) into actual_hash
      from public.mkt_locations l where l.id = loc.id;
    if loc.country is distinct from (target->>'country') or actual_hash is distinct from (target->>'hash') then
      raise warning 'duplicate % skipped: its snapshot changed, review before cleanup', v_id;
      continue;
    end if;

    if target->>'keeper' is not null and not exists (
      select 1 from public.mkt_locations k
      where k.id = (target->>'keeper')::uuid and k.country = loc.country and k.chain_key = loc.chain_key
        and k.status <> 'closed'
    ) then
      raise warning 'duplicate % skipped: its keeper % is gone or closed', v_id, target->>'keeper';
      continue;
    end if;

    if exists (select 1 from public.mkt_ratings r where r.location_id = loc.id)
      or exists (select 1 from public.mkt_candidates c
        where c.target_id = loc.id or strpos(c.payload::text, v_id) > 0)
      or exists (select 1 from public.mkt_editorial e where strpos(e.payload::text, v_id) > 0)
      or exists (select 1 from public.mkt_facts f
        where strpos(concat_ws(' ', f.text, f.value, f.source), v_id) > 0) then
      raise warning 'duplicate % skipped: it has references, review before cleanup', v_id;
      continue;
    end if;

    delete from public.mkt_locations where id = loc.id;
    get diagnostics removed = row_count;
    if removed <> 1 then raise exception 'duplicate % identity changed', v_id; end if;
    deleted := deleted + 1;
    raise notice 'duplicate % removed (% %, %)', v_id, loc.country, loc.chain_key, loc.name;
  end loop;
  raise notice 'osm dupes / playplace: % of % rows removed', deleted, (select count(*) from jsonb_object_keys(targets));
  -- Canonical CAS rendering and the bounded lock wait belong only to this repair.
  -- An error is deliberately left to the caller's transaction/savepoint rollback.
  perform set_config('extra_float_digits', caller_float_digits, true);
  perform set_config('lock_timeout', caller_lock_timeout, true);
end
$migration$;
