-- #883: extend the existing reset without replacing independent seed fixes.
-- Definition-only migration: does not invoke demo_reset or touch current demo rows.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.demo_reset()'::regprocedure);
  v_anchor constant text := '  delete from public.tasks              where group_id = c_ws;           -- + история, комментарии, подписки';
  v_marker constant text := '  -- demo-reset: people without accounts (#883)';
  v_block constant text := $block$  -- demo-reset: people without accounts (#883)
  delete from public.people where group_id = c_ws and source <> 'account';$block$;
begin
  if pg_catalog.strpos(v_definition, v_marker) > 0 then
    if pg_catalog.strpos(v_definition, v_block) = 0
       or pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_marker, '')) <> pg_catalog.length(v_marker) then
      raise exception 'demo_reset_people_patch_mismatch';
    end if;
    return;
  end if;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')) <> pg_catalog.length(v_anchor) then
    raise exception 'demo_reset_people_anchor_mismatch';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_anchor || E'\n' || v_block);
end
$patch$;
