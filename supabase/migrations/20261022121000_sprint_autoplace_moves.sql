-- Смена срока ПЕРЕНОСИТ задачу и не сносит её план (решение владельца 22.10.2026, п.4 —
-- docs/decisions/2026-10-22-sprint-board-direction.md; правила на граничные случаи —
-- docs/superpowers/specs/2026-10-22-sprint-board-design.md).
--
-- Было (20261019120000): срок за концом идущего — задача оставалась в нём с пометкой «к переносу»
-- и уезжала только на приёмке; а строки задачи во ВСЕХ запланированных спринтах, кроме спринта
-- срока, удалялись («в двух местах задача не висит») — то есть план на несколько спринтов
-- молча сносился.
--
-- Стало:
--   * задача в одной строке, срок за концом идущего — переезжает в спринт срока сразу
--     (sprint_move_task_internal), в идущем остаётся снимок без причины: её спросят один раз,
--     при закрытии спринта; одна строка запланированного спринта просто переставляется;
--   * задача ведётся в нескольких спринтах (план) — строки не удаляются никогда; срок позже
--     последнего спринта плана — план продлевается до спринта срока (`auto_extended`);
--   * срок вернули в идущий — снимок оживает той же строкой, а строка-цель, созданная этим
--     переносом в запланированном, снимается;
--   * смена срока самим переносом (флаг `swarm.sprint_moving`) триггер не будит.
--
-- Чистое правило — `planPlacement` (_shared/tasks/sprint-autoplace.ts); эта функция обязана его
-- повторять, тест базы (sprint-autoplace.db.test.ts) сверяет одно с другим.
--
-- Аддитивно: `create or replace` двух функций, сигнатуры прежние, триггер прежний.
-- Файл идемпотентен целиком (порча scripts/porcha-sql накатывает его повторно).

create or replace function public.sprint_autoplace_task(p_task_id uuid, p_due date)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t           record;
  sp          record;
  v_active    public.sprint_cycles%rowtype;
  v_item      public.sprint_items%rowtype;
  v_live      boolean;
  v_snap      boolean;
  v_drafts    uuid[];
  v_count     integer;
  v_target    uuid;
  v_target_st date;
  v_plan_end  date;
begin
  if p_due is null then
    return;
  end if;
  -- Срок меняет сам перенос (новая дата из окна переноса): задача уже размещена.
  if coalesce(current_setting('swarm.sprint_moving', true), '') = '1' then
    return;
  end if;
  select id, group_id, status, is_private, archived_at into t from public.tasks where id = p_task_id;
  if not found or t.archived_at is not null or t.is_private
     or t.status in ('done', 'cancelled') then
    return;
  end if;

  -- «В обороте» пространства: живая строка (не снятая и не снимок) в незакрытом, не архивном
  -- спринте. Правило работает в каждом пространстве независимо.
  for sp in
    select distinct c.group_id, c.tab_id
      from public.sprint_items si
      join public.sprint_cycles c on c.id = si.cycle_id
     where si.task_id = p_task_id
       and si.withdrawn_at is null
       and si.moved_at is null
       and c.status in ('draft', 'active')
       and c.archived_at is null
       and c.group_id = t.group_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('sprint_space:' || sp.group_id || ':' || coalesce(sp.tab_id::text, ''), 0));

    select * into v_active
      from public.sprint_cycles
     where group_id = sp.group_id and tab_id is not distinct from sp.tab_id
       and status = 'active' and archived_at is null
     limit 1;

    select * into v_item from public.sprint_items
     where cycle_id = v_active.id and task_id = p_task_id;
    v_live := v_item.id is not null and v_item.withdrawn_at is null and v_item.moved_at is null;
    v_snap := v_item.id is not null and v_item.moved_at is not null;

    select coalesce(array_agg(si.cycle_id), '{}') into v_drafts
      from public.sprint_items si
      join public.sprint_cycles c on c.id = si.cycle_id
     where si.task_id = p_task_id
       and si.withdrawn_at is null and si.moved_at is null
       and c.status = 'draft' and c.archived_at is null
       and c.group_id = sp.group_id and c.tab_id is not distinct from sp.tab_id;
    v_count := (case when v_live then 1 else 0 end) + cardinality(v_drafts);

    if v_active.id is not null then
      -- Срок раньше старта идущего (просрочено): задача остаётся где была.
      if p_due < v_active.start_date then
        continue;
      end if;

      if p_due <= v_active.end_date then
        if v_snap then
          -- Срок вернули: снимок оживает той же строкой (уникальность спринт+задача не даёт
          -- завести вторую), а строка-цель, созданная этим переносом, лишняя. Строку, стоявшую
          -- в цели по плану ещё до переноса, не трогаем — у неё своя причина быть там.
          -- Причина прошлого переноса уже лежит комментарием в задаче; в строке её не оставляем —
          -- иначе следующий перенос получил бы её молча.
          delete from public.sprint_items si
           using public.sprint_cycles c
           where si.id = v_item.moved_to
             and si.carried_from = v_item.id
             and c.id = si.cycle_id
             and c.status = 'draft';
          update public.sprint_items
             set moved_at = null, moved_to = null, moved_by = null, carry_reason = null,
                 frozen_at = null, frozen_title = null, frozen_status = null, frozen_assignees = null,
                 frozen_project = null, frozen_completed_at = null, frozen_due_date = null
           where id = v_item.id;
        elsif v_live then
          -- Старая пометка «к переносу» от автоматики без причины (до уборки to_carry): срок
          -- вернули — переносить нечего. Пометку человека или с вписанной причиной не трогаем.
          if v_item.to_carry and v_item.carry_auto and coalesce(btrim(v_item.carry_reason), '') = '' then
            update public.sprint_items
               set to_carry = false, carry_auto = false, carry_at = null, carry_by = null, carry_reason = null
             where id = v_item.id;
          end if;
        else
          -- Задачи в идущем нет: она там сверх плана (снятую — возвращаем той же строкой).
          if v_item.id is not null then
            update public.sprint_items set withdrawn_at = null, withdrawn_by = null where id = v_item.id;
          else
            insert into public.sprint_items (cycle_id, task_id, in_plan, added_by)
            values (v_active.id, p_task_id, false, null)
            on conflict (cycle_id, task_id) where task_id is not null do nothing;
          end if;
          -- Единственная её строка в будущем лишняя (задача переехала); строки плана на
          -- несколько спринтов остаются — их удаляют только люди.
          if cardinality(v_drafts) = 1 then
            delete from public.sprint_items
             where task_id = p_task_id and cycle_id = v_drafts[1];
          end if;
        end if;
        continue;
      end if;
    end if;

    -- Срок за концом идущего (или идущего нет): спринт срока, недостающие создаются.
    v_target := public.sprint_autoplace_target(sp.group_id, sp.tab_id, p_due);
    if v_target is null or v_count = 0 then
      continue;
    end if;

    if v_count = 1 then
      if v_live then
        -- Из идущего — настоящий перенос: в идущем остаётся снимок без причины.
        perform public.sprint_move_task_internal(v_item.id, v_target, null, null, null);
      elsif v_drafts[1] <> v_target then
        -- Единственная строка запланированного спринта переставляется — той же строкой, чтобы
        -- ссылка снимка (moved_to) на неё не рвалась.
        update public.sprint_items set cycle_id = v_target
         where task_id = p_task_id and cycle_id = v_drafts[1];
      end if;
      continue;
    end if;

    -- План на несколько спринтов: срок внутри плана — строки не трогаются; позже последнего
    -- спринта плана — план продлевается до спринта срока, без причины (спросят при закрытии).
    if v_target = any(v_drafts) then
      continue;
    end if;
    select max(end_date) into v_plan_end from public.sprint_cycles where id = any(v_drafts);
    select start_date into v_target_st from public.sprint_cycles where id = v_target;
    if v_target_st > v_plan_end then
      insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, auto_extended)
      select c.id, p_task_id, true, null, true
        from public.sprint_cycles c
       where c.group_id = sp.group_id and c.tab_id is not distinct from sp.tab_id
         and c.status = 'draft' and c.archived_at is null
         and c.start_date > v_plan_end and c.start_date <= v_target_st
      on conflict (cycle_id, task_id) where task_id is not null do nothing;
    end if;
  end loop;
end;
$$;

comment on function public.sprint_autoplace_task(uuid, date) is
  'Смена срока задачи, уже стоящей в спринтах пространства: одна строка — переезд в спринт срока (из идущего — со снимком без причины), план на несколько спринтов — не сносится, продлевается за последний; срок вернули — снимок оживает. Зовёт триггер tasks_sprint_autoplace. Правило — planPlacement (sprint-autoplace.ts).';

-- Снимок, который оставил перенос по сроку, обязан помнить срок ДО смены («срок A → B»): функция
-- переноса видит уже новый срок, поэтому прежний дописывает триггер — у него есть old.
create or replace function public.tasks_sprint_autoplace_trg()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.sprint_autoplace_task(new.id, new.due_date);
  update public.sprint_items
     set frozen_due_date = old.due_date
   where task_id = new.id
     and moved_at = now()
     and moved_by is null;
  return null;
end;
$$;

revoke all on function public.sprint_autoplace_task(uuid, date) from public, anon, authenticated;
grant execute on function public.sprint_autoplace_task(uuid, date) to service_role;
revoke all on function public.tasks_sprint_autoplace_trg() from public, anon, authenticated;
grant execute on function public.tasks_sprint_autoplace_trg() to service_role;
