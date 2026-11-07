-- #1134, owner decision 07.11.2026 («магазины кондитерских выкидываем»): retire the two BY
-- chains discovered from branded retail shops of confectionery factories. Collector rule is in
-- scripts/market/adapters/overture.ts (isManufacturerShop) and BY.manufacturerShops.
-- Public Overture snapshot read from prod 2026-11-07: 31 + 14 uncurated rows, no references.
-- All business fields are CAS-checked; only automatic freshness timestamps are excluded.
-- Nothing else (other chains, countries, curated data) is changed. Idempotent: absent chain = no-op.
do $migration$
declare
  target_country constant text := 'BY';
  targets constant jsonb := $targets${
  "chain-коммунарка": {
    "chain": "2bd5274ad42901a065d76fff98d08185",
    "id": "f8ef71f1-5ac5-48d5-a2a6-376bd113f94e",
    "points": {
      "0160fe19-e08f-4d6b-a363-22de665f9cb3": "40d71d0d1fba00ececffceb65eebd467",
      "1a4649b0-4902-4af2-998c-783b6efe3968": "3959773f2ae5ed1b74ea4d172c4a9d47",
      "27a87da1-a6cd-49ee-8be9-c82426dbe88c": "e0c818ec7c932e88b55e698193cbbf60",
      "28ecf9fe-15e4-4ee7-abb5-eb8c6159830a": "3fdf5391e7f5d7e34c125cf0c373cc1b",
      "354cc16f-ca7f-44a3-881e-3ed7a0553d26": "aed9c072f5eb64d66dec6355101b9cfc",
      "448db120-96f9-4db1-bbb9-43cef1c40920": "9ca829794732660b4a6e23d3b3d7b3e4",
      "4b27d064-bcaa-4b4d-9fac-9a24d40205b3": "906d0a5c0fe0ed0cd171e252441baf9a",
      "636e7907-4774-46d0-a237-576506f20cb2": "af021aff6aa6cddbe6cf895697b36564",
      "6502e1c4-7308-4e45-8683-bf22d6f60244": "3293d112b9e64a728d129a82b43782f0",
      "8237374f-6a7c-4ee6-8a63-670a4238a64a": "aa9187687c16a28856bff3b008e64e7c",
      "9460f8f9-c09d-4ce9-b6b6-a5ee885fb9b5": "cd07711ccdba366f639782e95d077681",
      "ae99d8bf-a9fd-4f1d-b041-5ae3eb11e793": "e632fe2cb77b140a141455e49c2ec684",
      "b1153607-ab19-41eb-9651-e84227f84072": "074e4977c57377ac91915830b77a5233",
      "cdec4d40-0fc0-4ffc-a4b4-622c076e7c8a": "7e2901e6ae04dac21df8076f4fd875d7"
    }
  },
  "chain-кондитерская": {
    "chain": "f920b0c51e00ee891a91a8d681892340",
    "id": "06b02bbd-4cd5-47e8-b62d-f689262f04d9",
    "points": {
      "05732f64-fec7-4b2f-9d04-c184d99580b2": "41ef2e9892263cddcd0859949e93a2be",
      "140ad11c-3c79-463f-8d91-a0cda63a27d5": "83e153531f6ee6a23ae0612362818f0e",
      "16dabd4e-ad08-4573-92dd-88a9655f78d8": "e46b2dc31983bf1c48edeeaa79fd404e",
      "367379a8-c775-4443-9d76-302ae20791d4": "e3dadabd933b44c78ae81523df71bc40",
      "37ec3571-e601-4a0b-9a35-34cce411bb16": "72bec255a8aaff097cd29e25962a1a33",
      "3c4d32fe-6032-4c09-9f30-ebb5aa8ad29c": "3ca359c0db204f0d76219bb6f156eca2",
      "42410783-8e10-434c-a864-00b39a192356": "75a0d5cf68a6c12280a78f7ca25c3879",
      "4bc56567-16c7-44a0-9c45-5afc71b12d64": "1c29f35ec05433e6974d574cb58a451a",
      "4c63ba23-9dad-4704-86c4-233a6036f7ba": "aff5498f0d2817af153933f5683d2da4",
      "4ff487df-2851-4056-b278-cee1b3df3aa9": "8814e8e5b0be8c225f2f18ae74e985b3",
      "50477952-de4b-4249-8f66-eba5720b1698": "47d01937632684f3d00bf894b1faf551",
      "5a8c0eb1-ef8a-4549-9843-f52931bcb9bc": "d2bd4bc473f59e2d987960581496d7b1",
      "5d95614a-448d-42aa-93dc-a343c78678b8": "fe3e6c9d46435fe3d35c861f3273fc0d",
      "71f68e10-0145-4514-a89f-0d7143bdba96": "60943c426d735da01695da90c5eb0f48",
      "93178912-524a-4e0f-8d05-c6653964eac5": "17ece5814bef67662167333f18fe05a1",
      "a57ea791-b983-453c-9090-3d86a248a6b7": "24948bbd6a0743af590c9bb7f4333506",
      "a7a4186c-0e98-46fd-b584-b6dd6c9a44b7": "a5b73ff4e3801eb42627f83039424e09",
      "b6fbcbc8-6fa2-4016-8f31-d99fb8e97a56": "2978366bf3f87a45be690d971789220a",
      "bf6d705b-a1ed-49f3-acb9-4765a23cc42d": "a82dde2ac373db92cd009a8f0d359783",
      "bf91cec3-9219-499a-8de7-c7466fb0b468": "589789e32b280f8cb8cbff94bba5eae3",
      "d4830918-80d0-455c-af98-f9ff95ac2a1c": "3f690330d7b0788945afc79d37f2ee5e",
      "dcb82860-fd06-4608-94d9-cde7b3a5ed82": "bc5e3a26c7dc15199f7798f1bfefef06",
      "dce02848-b767-412f-b6ec-97dc0878cad8": "441a6e3ab2783d86842d6443b2e9d791",
      "de711528-6e3d-4a86-a300-2576411f4db9": "dc8dfa9471e5ceb29af5e9d4388d77bf",
      "e3eb994e-33eb-4784-b003-288587816281": "bad3a0a179ad8ee3076011279a7ff21e",
      "e6cac4ac-fae6-4eb6-9115-b7e2d0ff621c": "5d6cc603d826459e6584096772f12485",
      "e9dc4ecc-55ef-4644-a396-71c48362b53c": "f2f185ea25bef346b340d5bdfb3ba9c6",
      "ef60dc27-061a-4c25-b411-f1b0c9f93a2f": "1ae8e9d5843bc2223b2168d5562d85e0",
      "f09c6244-1dbb-4dde-b159-941b1226ab17": "41034fd89103a24dd0f28bebdb3cf1ad",
      "f7370718-6ec4-419e-a59a-9a83ca0b0b78": "65fba7d38a5d0e6f0fd1e1c323eaa603",
      "fca1f534-8859-4beb-93b0-24ad8e8f2fad": "8d4785582765a3d38063994a682e91f8"
    }
  }
}
$targets$::jsonb;
  target_key text;
  target jsonb;
  expected_points jsonb;
  present text[] := '{}';
  actual_chain text;
  actual_points jsonb;
  removed integer;
  caller_float_digits constant text := current_setting('extra_float_digits');
  caller_lock_timeout constant text := current_setting('lock_timeout');
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('extra_float_digits', '3', true);
  for target_key in select jsonb_object_keys(targets) loop
    if exists (select 1 from public.mkt_chains where country=target_country and key=target_key) then
      present := present || target_key;
    end if;
  end loop;
  if coalesce(array_length(present, 1), 0) = 0 then
    perform set_config('extra_float_digits', caller_float_digits, true);
    perform set_config('lock_timeout', caller_lock_timeout, true);
    return;
  end if;

  -- Protect the CAS and logical references (some have no FK) from concurrent writes.
  -- Refuse after 5 seconds instead of waiting indefinitely for a collector/editor.
  lock table public.mkt_chains, public.mkt_locations, public.mkt_companies,
    public.mkt_prices, public.mkt_ratings, public.mkt_sources, public.mkt_editorial,
    public.mkt_candidates, public.mkt_facts in share row exclusive mode;

  foreach target_key in array present loop
    target := targets->target_key;
    expected_points := target->'points';
    if exists (
      select 1 from public.mkt_chains where country=target_country and key=target_key
        and (origin is not null or operator is not null or first_entry is not null or notes is not null or hist is not null)
    ) or exists (
      select 1 from public.mkt_locations where country=target_country and chain_key=target_key
        and (source_kind <> 'overture' or verification <> 'unverified' or status <> 'open'
          or opened is not null or closed is not null or opened_estimated
          or placement is not null or format is not null or verification_note is not null)
    ) then
      raise exception 'BY manufacturer-shop chain % has curated data: review before cleanup', target_key;
    end if;

    select md5((to_jsonb(c)-'updated_at')::text) into actual_chain
      from public.mkt_chains c where country=target_country and key=target_key;
    select coalesce(jsonb_object_agg(l.id::text,
      md5((to_jsonb(l)-array['first_seen_at','last_seen_at'])::text)), '{}'::jsonb)
      into actual_points from public.mkt_locations l where country=target_country and chain_key=target_key;
    if actual_chain is distinct from (target->>'chain') or actual_points is distinct from expected_points then
      raise exception 'BY manufacturer-shop chain % snapshot changed: review before cleanup', target_key;
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
      raise exception 'BY manufacturer-shop chain % has references: review before cleanup', target_key;
    end if;
  end loop;

  -- Every chain passed its checks; only now delete (an error rolls the whole statement back).
  foreach target_key in array present loop
    target := targets->target_key;
    delete from public.mkt_locations l
      where l.country=target_country and l.chain_key=target_key and (target->'points') ? l.id::text;
    get diagnostics removed = row_count;
    if removed <> (select count(*) from jsonb_object_keys(target->'points')) then
      raise exception 'BY manufacturer-shop chain % location count changed', target_key;
    end if;
    delete from public.mkt_chains where country=target_country and key=target_key and id=(target->>'id')::uuid;
    get diagnostics removed = row_count;
    if removed <> 1 then raise exception 'BY manufacturer-shop chain % identity changed', target_key; end if;
  end loop;
  -- Canonical CAS rendering and the bounded lock wait belong only to this repair.
  -- An error is deliberately left to the caller's transaction/savepoint rollback.
  perform set_config('extra_float_digits', caller_float_digits, true);
  perform set_config('lock_timeout', caller_lock_timeout, true);
end
$migration$;
