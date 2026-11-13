-- #790: atomically consolidate only unchanged, complete canonical MCP chunk groups.
-- Preserve the head ID/attribution/visibility, retain tail originals behind the existing archive marker.
-- Incomplete, edited, mismatched or referenced groups are left byte-for-byte unchanged.
create index if not exists entries_legacy_mcp_chunk_group_idx
  on public.entries ((metadata->>'chunk_group_id'))
  where added_by = 'claude_desktop' and archived_at is null and metadata ? 'chunk_group_id';

do $migration$
declare
  group_key text;
  part public.entries;
  head public.entries;
  m jsonb;
  total integer;
  ordinal integer;
  n numeric;
  seen boolean[];
  contents text[];
  sizes integer[];
  ids uuid[];
  tail_ids uuid[];
  part_count integer;
  i integer;
  full_length integer;
  overlap_units integer;
  overlap_chars integer;
  prefix text;
  full_content text;
  identity jsonb;
  valid boolean;
  referenced boolean;
  ref record;
  previous_keep_updated text;
begin
  -- Stabilize references as well as the source rows until this atomic data change commits.
  lock table public.entries in share row exclusive mode;
  for ref in
    select distinct c.oid, ns.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.oid <> 'public.entries'::regclass
      and (
        exists (select 1 from pg_constraint fk where fk.contype = 'f' and fk.confrelid = 'public.entries'::regclass and fk.conrelid = c.oid)
        or (ns.nspname = 'public' and exists (
          select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            and a.attname ~ '(^|_)(entry|meeting|record)_ids?$'
        ))
        or (ns.nspname = 'public' and c.relname in
          ('tasks', 'task_comments', 'task_history', 'meetings', 'meeting_live_notes', 'notifications', 'telegram_outbox', 'entry_versions', 'meeting_versions'))
      )
    order by c.oid
  loop
    execute format('lock table %I.%I in share mode', ref.schema_name, ref.table_name);
  end loop;

  -- Materialize once, not once per chunk group. UUID casts also normalize uppercase links.
  create temporary table knowledge_790_refs (id uuid primary key) on commit drop;
  for ref in
      select distinct ns.nspname as schema_name, c.relname as table_name, a.attname as column_name, a.atttypid
      from pg_constraint fk join pg_class c on c.oid = fk.conrelid join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral generate_subscripts(fk.confkey, 1) as subs(i)
      join pg_attribute target on target.attrelid = fk.confrelid and target.attnum = fk.confkey[subs.i]
      join pg_attribute a on a.attrelid = c.oid and a.attnum = fk.conkey[subs.i]
      where fk.contype = 'f' and fk.confrelid = 'public.entries'::regclass and target.attname = 'id'
      union
      select ns.nspname, c.relname, a.attname, a.atttypid
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        and a.attname ~ '(^|_)(entry|meeting|record)_id$'
        and a.atttypid in ('uuid'::regtype, 'text'::regtype, 'varchar'::regtype)
      union
      select ns.nspname, c.relname, a.attname, a.atttypid
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        and a.attname ~ '(^|_)(entry|meeting|record)_ids$'
        and a.atttypid in ('uuid[]'::regtype, 'text[]'::regtype, 'varchar[]'::regtype)
      union
      select ns.nspname as schema_name, c.relname as table_name, a.attname as column_name, a.atttypid
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        and c.relname in ('entries', 'tasks', 'task_comments', 'task_history', 'meetings', 'meeting_live_notes',
          'notifications', 'telegram_outbox', 'entry_versions', 'meeting_versions')
        and a.attname in ('content', 'summary', 'description', 'body', 'text', 'metadata', 'payload', 'details')
        and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
  loop
    execute format(
      'insert into pg_temp.knowledge_790_refs(id) select distinct matches.value[1]::uuid from %I.%I '
      'cross join lateral regexp_matches(%I::text, $1, ''g'') as matches(value) where true on conflict do nothing',
      ref.schema_name, ref.table_name, ref.column_name)
      using '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
  end loop;

  for group_key in
    select distinct e.metadata->>'chunk_group_id' from public.entries e
    where e.added_by = 'claude_desktop' and e.archived_at is null and e.metadata ? 'chunk_group_id'
      and jsonb_typeof(e.metadata->'chunk_group_id') = 'string'
      and e.metadata->>'chunk_group_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  loop
    total := null; part_count := 0; valid := true; identity := null;
    seen := array[]::boolean[]; contents := array[]::text[]; sizes := array[]::integer[]; ids := array[]::uuid[];
    for part in
      select e.* from public.entries e
      where e.added_by = 'claude_desktop' and e.archived_at is null and e.metadata ? 'chunk_group_id'
        and e.metadata->>'chunk_group_id' = group_key
      limit 201
    loop
      part_count := part_count + 1; m := part.metadata;
      if part_count > 200 or jsonb_typeof(m) is distinct from 'object' then valid := false; exit; end if;
      if jsonb_typeof(m->'chunk') is distinct from 'number' or jsonb_typeof(m->'total_chunks') is distinct from 'number'
        or m - array['chunk', 'chunk_group_id', 'total_chunks'] <> '{}'::jsonb then valid := false; exit; end if;
      n := (m->>'total_chunks')::numeric;
      if n <> trunc(n) or n < 2 or n > 200 then valid := false; exit; end if;
      if total is null then total := n::integer;
      elsif total <> n then valid := false; exit; end if;
      n := (m->>'chunk')::numeric;
      if n <> trunc(n) or n < 1 or n > total then valid := false; exit; end if;
      ordinal := n::integer;
      if coalesce(seen[ordinal], false) or part.content is null or part.created_at is null
        or part.updated_at is distinct from part.created_at then valid := false; exit; end if;
      if (ordinal = 1 and part.summary is null) or (ordinal > 1 and part.summary is not null) then valid := false; exit; end if;
      if identity is null then
        identity := jsonb_build_array(part.source, part.group_id, part.visible_group_ids, part.owner_id,
          part.is_private, part.shared_with, part.countries, part.entry_type, part.entry_date);
      elsif identity is distinct from jsonb_build_array(part.source, part.group_id, part.visible_group_ids, part.owner_id,
          part.is_private, part.shared_with, part.countries, part.entry_type, part.entry_date) then valid := false; exit; end if;
      seen[ordinal] := true; contents[ordinal] := part.content; ids[ordinal] := part.id;
      sizes[ordinal] := length(regexp_replace(part.content collate "C", U&'[\+010000-\+10FFFF]', '..', 'g'));
      if ordinal = 1 then head := part; end if;
    end loop;
    if not valid or total is null or part_count <> total then continue; end if;
    full_length := (total - 1) * 2800 + sizes[total];
    if full_length <= 3000 or sizes[total] < 1 or sizes[total] > 2800 then continue; end if;
    full_content := contents[1];
    for i in 1..total loop
      if not coalesce(seen[i], false) or sizes[i] <> least(3000, full_length - (i - 1) * 2800) then valid := false; exit; end if;
      if i = 1 then continue; end if;
      overlap_units := least(200, sizes[i]); overlap_chars := least(overlap_units, length(contents[i]));
      loop
        prefix := left(contents[i], overlap_chars);
        n := length(regexp_replace(prefix collate "C", U&'[\+010000-\+10FFFF]', '..', 'g'));
        exit when n <= overlap_units;
        overlap_chars := overlap_chars - 1;
      end loop;
      if n <> overlap_units or right(contents[i - 1], overlap_chars) <> prefix then valid := false; exit; end if;
      full_content := full_content || substring(contents[i] from overlap_chars + 1);
    end loop;
    if not valid then continue; end if;
    tail_ids := ids[2:total]; referenced := false;

    select exists(select 1 from pg_temp.knowledge_790_refs where id = any(tail_ids)) into referenced;
    if referenced then continue; end if;

    previous_keep_updated := current_setting('swarm.keep_updated_at', true);
    perform set_config('swarm.keep_updated_at', 'on', true);
    update public.entries set content = full_content,
      metadata = (metadata - array['chunk', 'chunk_group_id', 'total_chunks']) || jsonb_build_object(
        'legacy_chunk_group_id', group_key, 'legacy_chunk_ids', to_jsonb(ids))
      where id = head.id;
    update public.entries set archived_at = now(), archived_by = null,
      metadata = metadata || jsonb_build_object('legacy_consolidated_into', head.id)
      where id = any(tail_ids);
    perform set_config('swarm.keep_updated_at', coalesce(previous_keep_updated, ''), true);
  end loop;
  drop table pg_temp.knowledge_790_refs;
end;
$migration$;
