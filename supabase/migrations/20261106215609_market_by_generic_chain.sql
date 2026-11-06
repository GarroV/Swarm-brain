-- #1134, partial #1113: retire only the captured unbranded generic BY network.
-- Public Overture snapshot checked 2026-11-06: eight uncurated rows, no references.
-- All business fields are CAS-checked; only automatic freshness timestamps are excluded.
-- No manufacturer-shop policy or other country/chain data is changed.
do $migration$
declare
  target_country constant text := 'BY';
  target_key constant text := 'chain-кофеиня';
  target_id constant uuid := '94d04c4c-caac-4209-97b3-53c993f2d066';
  expected_chain constant text := 'c6ab8985a0c0ae895836c74f5dbf66a0';
  expected_points constant jsonb := $points${
  "51c6fd67-b50a-49f8-b347-31feb6420d84": "c4629c1dc6456d509992c602bcddb304",
  "560923c3-7af8-4bc7-95cf-f4ae20107553": "d26d057e22e42dfccd98853d5b610977",
  "6c092710-435f-44af-9a59-5fdcb2c11955": "d4046873f659369dbf99c693afa9ee1a",
  "86fc81e8-a673-4c4b-b860-a6277743b07d": "eb841a81d15d1955d9f1e2e777fd6939",
  "95e2241d-a3fb-4707-893a-5acea5a8b0ec": "1fa62f248b5918fcaa8ce686b69dafe6",
  "9d0f7da8-34ab-4fac-bf6d-449cc29cb014": "82c4e6464481e417ad796ad49d001c5d",
  "ca900d45-9f4f-4990-af94-12fbdcb19caa": "d61009396cc33daeacb6687230846c67",
  "d0e75471-ec47-48bd-aa59-ca2413504d7a": "8588cd6d3290454aba958c1a09454404"
}$points$::jsonb;
  actual_chain text;
  actual_points jsonb;
  removed integer;
  caller_float_digits constant text := current_setting('extra_float_digits');
  caller_lock_timeout constant text := current_setting('lock_timeout');
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('extra_float_digits', '3', true);
  if not exists (select 1 from public.mkt_chains where country=target_country and key=target_key) then
    perform set_config('extra_float_digits', caller_float_digits, true);
    perform set_config('lock_timeout', caller_lock_timeout, true);
    return;
  end if;

  -- Protect the CAS and logical references (some have no FK) from concurrent writes.
  -- Refuse after 5 seconds instead of waiting indefinitely for a collector/editor.
  lock table public.mkt_chains, public.mkt_locations, public.mkt_companies,
    public.mkt_prices, public.mkt_ratings, public.mkt_sources, public.mkt_editorial,
    public.mkt_candidates, public.mkt_facts in share row exclusive mode;

  if exists (
    select 1 from public.mkt_chains where country=target_country and key=target_key
      and (origin is not null or operator is not null or first_entry is not null or notes is not null or hist is not null)
  ) or exists (
    select 1 from public.mkt_locations where country=target_country and chain_key=target_key
      and (source_kind <> 'overture' or verification <> 'unverified' or status <> 'open'
        or opened is not null or closed is not null or opened_estimated
        or placement is not null or format is not null or verification_note is not null)
  ) then
    raise exception 'BY generic Overture chain has curated data: review before cleanup';
  end if;

  select md5((to_jsonb(c)-'updated_at')::text) into actual_chain
    from public.mkt_chains c where country=target_country and key=target_key;
  select coalesce(jsonb_object_agg(l.id::text,
    md5((to_jsonb(l)-array['first_seen_at','last_seen_at'])::text)), '{}'::jsonb)
    into actual_points from public.mkt_locations l where country=target_country and chain_key=target_key;
  if actual_chain is distinct from expected_chain or actual_points is distinct from expected_points then
    raise exception 'BY generic Overture snapshot changed: review before cleanup';
  end if;

  if exists (select 1 from public.mkt_prices where country=target_country and chain_key=target_key)
    or exists (select 1 from public.mkt_companies where country=target_country and chain_key=target_key)
    or exists (select 1 from public.mkt_sources where country=target_country and chain_key=target_key)
    or exists (select 1 from public.mkt_ratings r
      where (r.country=target_country and r.chain_key=target_key) or expected_points ? r.location_id::text)
    or exists (select 1 from public.mkt_editorial e
      where (e.country=target_country and strpos(e.payload::text,target_key)>0)
        or exists (select 1 from jsonb_object_keys(expected_points) p(id) where strpos(e.payload::text,p.id)>0))
    or exists (select 1 from public.mkt_candidates c
      where (c.country=target_country and strpos(c.payload::text,target_key)>0)
        or expected_points ? c.target_id::text
        or exists (select 1 from jsonb_object_keys(expected_points) p(id) where strpos(c.payload::text,p.id)>0))
    or exists (select 1 from public.mkt_facts f
      where (f.country=target_country and strpos(concat_ws(' ',f.text,f.value,f.source),target_key)>0)
        or exists (select 1 from jsonb_object_keys(expected_points) p(id)
          where strpos(concat_ws(' ',f.text,f.value,f.source),p.id)>0)) then
    raise exception 'BY generic Overture chain has references: review before cleanup';
  end if;

  delete from public.mkt_locations l
    where l.country=target_country and l.chain_key=target_key and expected_points ? l.id::text;
  get diagnostics removed = row_count;
  if removed <> 8 then raise exception 'BY generic Overture location count changed'; end if;
  delete from public.mkt_chains where country=target_country and key=target_key and id=target_id;
  get diagnostics removed = row_count;
  if removed <> 1 then raise exception 'BY generic Overture chain identity changed'; end if;
  -- Canonical CAS rendering and the bounded lock wait belong only to this repair.
  -- An error is deliberately left to the caller's transaction/savepoint rollback.
  perform set_config('extra_float_digits', caller_float_digits, true);
  perform set_config('lock_timeout', caller_lock_timeout, true);
end
$migration$;
