-- #858: seed only the demo space plan. Keep independently installed reset extensions.
-- Definition-only migration: no demo_reset invocation and no current data mutation.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.demo_reset()'::regprocedure);
  v_anchor constant text := '  -- Что получилось — числами, а не словом «готово»: сброс, который ничего не записал, выглядит';
  v_marker constant text := '  -- demo-reset: space plan groups (#858)';
  v_block constant text := $block$  -- demo-reset: space plan groups (#858)
  insert into public.projects (id, group_id, name, sprint_id, parent_id, position, is_private, sprint_group, created_by)
  values
    ('d0000000-0000-4000-8000-000000000851', c_ws, 'Peak-hour service', 'd0000000-0000-4000-8000-000000000002', null, 1000, false, true, 900000001),
    ('d0000000-0000-4000-8000-000000000852', c_ws, 'Loyalty wallet', 'd0000000-0000-4000-8000-000000000002', null, 2000, false, true, 900000001),
    ('d0000000-0000-4000-8000-000000000853', c_ws, 'Autumn menu', 'd0000000-0000-4000-8000-000000000002', null, 3000, false, true, 900000001);
  -- Move whole existing families: their parent/child relations and task identities stay intact.
  update public.tasks set project_id = case project_id
    when 'd0000000-0000-4000-8000-000000000111' then 'd0000000-0000-4000-8000-000000000851'::uuid
    when 'd0000000-0000-4000-8000-000000000122' then 'd0000000-0000-4000-8000-000000000852'::uuid
    when 'd0000000-0000-4000-8000-000000000131' then 'd0000000-0000-4000-8000-000000000853'::uuid
    end
  where group_id = c_ws and project_id in (
    'd0000000-0000-4000-8000-000000000111',
    'd0000000-0000-4000-8000-000000000122',
    'd0000000-0000-4000-8000-000000000131'
  );
$block$;
begin
  if pg_catalog.strpos(v_definition, v_marker) > 0 then
    if pg_catalog.strpos(v_definition, v_block) = 0
       or pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_marker, '')) <> pg_catalog.length(v_marker) then
      raise exception 'demo_reset_plan_patch_mismatch';
    end if;
    return;
  end if;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')) <> pg_catalog.length(v_anchor) then
    raise exception 'demo_reset_plan_anchor_mismatch';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_block || v_anchor);
end
$patch$;
