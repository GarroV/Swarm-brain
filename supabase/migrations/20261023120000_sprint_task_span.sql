-- План работы задачи — «⋯ → Спринты задачи…» (решение владельца 22.10.2026, этап 4 —
-- docs/superpowers/plans/2026-10-22-sprint-board.md, Task 7; правила — спека
-- docs/superpowers/specs/2026-10-22-sprint-board-design.md §«Спринты задачи…»).
--
-- Задача может вестись в нескольких спринтах подряд, и это задаётся заранее: человек выбирает
-- непрерывный отрезок спринтов пространства, а функция приводит строки задачи в запланированных
-- спринтах к этому отрезку.
--
--   * в спринтах отрезка, где у задачи нет живой строки, строка добавляется (`in_plan = true`);
--     снятая (`withdrawn_at`) строка оживает — уникальность (спринт, задача) не даёт завести вторую;
--   * в запланированных спринтах ВНЕ отрезка живая строка удаляется — только там: идущий и
--     принятые спринты функция не трогает никогда, снимки переноса (`moved_at`) тоже;
--   * срок задачи (`tasks.due_date`) не меняется — его меняет только человек явно;
--   * причина обязательна, если конец отрезка после срока задачи, или отрезок продлевает задачу из
--     идущего спринта за её последний спринт; она пишется в `plan_reason` последней добавленной
--     строки (комментарий в задачу кладёт TS-слой — sprint-span.ts).
--
-- `security definer` и `search_path` зафиксирован; EXECUTE только у `service_role` — приложение
-- ходит под ним, а грант на PUBLIC наследуют anon и authenticated (урок GHSA-vxrp-599j-46hv).
--
-- Аддитивно: только новая функция. Файл идемпотентен целиком (порча scripts/porcha-sql накатывает
-- его повторно).

create or replace function public.sprint_set_task_span(
  p_task_id    uuid,
  p_tab_id     uuid,
  p_group_id   text,
  p_from_cycle uuid,
  p_to_cycle   uuid,
  p_reason     text,
  p_actor      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t           public.tasks%rowtype;
  v_from      public.sprint_cycles%rowtype;
  v_to        public.sprint_cycles%rowtype;
  v_active    public.sprint_cycles%rowtype;
  v_reason    text := nullif(btrim(p_reason), '');
  v_cycle     record;
  v_added     uuid[] := '{}';
  v_removed   uuid[] := '{}';
  v_last_end  date;
  v_to_new    boolean;
  v_item_id   uuid;
begin
  -- Порядок замков тот же, что у смены срока в карточке: СНАЧАЛА задача, потом пространство.
  select * into t from public.tasks where id = p_task_id for update;
  if not found or t.group_id is distinct from p_group_id then
    raise exception 'Задача не найдена' using errcode = 'P0001';
  end if;
  if t.archived_at is not null then
    raise exception 'Задача в архиве — план ей не ведём' using errcode = 'P0001';
  end if;
  if t.is_private then
    raise exception 'Приватной задаче план не ведём' using errcode = 'P0001';
  end if;
  if t.status in ('done', 'cancelled') then
    raise exception 'Выполненной или отменённой задаче план не ведём' using errcode = 'P0001';
  end if;

  -- Концы отрезка — спринты ЭТОГО пространства (воркспейс + вкладка), не архивные.
  select * into v_from from public.sprint_cycles
   where id = p_from_cycle and archived_at is null;
  select * into v_to from public.sprint_cycles
   where id = p_to_cycle and archived_at is null;
  if v_from.id is null or v_to.id is null then
    raise exception 'Спринт не найден' using errcode = 'P0001';
  end if;
  if v_from.group_id is distinct from p_group_id or v_to.group_id is distinct from p_group_id
     or v_from.tab_id is distinct from p_tab_id or v_to.tab_id is distinct from p_tab_id then
    raise exception 'Спринт другого пространства' using errcode = 'P0001';
  end if;
  if v_from.status = 'accepted' or v_to.status = 'accepted' then
    raise exception 'Прошлый спринт выбрать нельзя' using errcode = 'P0001';
  end if;
  if v_from.start_date > v_to.start_date then
    raise exception 'Конец отрезка раньше его начала' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sprint_space:' || p_group_id || ':' || coalesce(p_tab_id::text, ''), 0));

  select * into v_active from public.sprint_cycles
   where group_id = p_group_id and tab_id is not distinct from p_tab_id
     and status = 'active' and archived_at is null
   limit 1;

  -- Конец её нынешнего плана: последний живой спринт (идущий или запланированный).
  select max(c.end_date) into v_last_end
    from public.sprint_items si
    join public.sprint_cycles c on c.id = si.cycle_id
   where si.task_id = t.id and si.withdrawn_at is null and si.moved_at is null
     and c.status in ('draft', 'active') and c.archived_at is null
     and c.group_id = p_group_id and c.tab_id is not distinct from p_tab_id;

  -- Строка в последнем спринте отрезка новая? Если он уже в плане задачи, причину не спрашиваем:
  -- её уже один раз выбрали раньше.
  v_to_new := v_to.status = 'draft' and not exists (
    select 1 from public.sprint_items
     where cycle_id = v_to.id and task_id = t.id and withdrawn_at is null and moved_at is null);

  if v_reason is null and v_to_new then
    if t.due_date is not null and v_to.start_date > t.due_date then
      raise exception 'Нужна причина: работа после срока' using errcode = 'P0001';
    end if;
    if v_active.id is not null
       and exists (select 1 from public.sprint_items
                    where cycle_id = v_active.id and task_id = t.id
                      and withdrawn_at is null and moved_at is null)
       and v_to.end_date > coalesce(v_last_end, v_active.end_date) then
      raise exception 'Нужна причина: задача продлевается за последний спринт' using errcode = 'P0001';
    end if;
  end if;

  -- Лишние строки: живые строки запланированных спринтов пространства вне отрезка.
  for v_cycle in
    select c.id from public.sprint_cycles c
      join public.sprint_items si on si.cycle_id = c.id and si.task_id = t.id
     where c.group_id = p_group_id and c.tab_id is not distinct from p_tab_id
       and c.status = 'draft' and c.archived_at is null
       and si.moved_at is null
       and (c.start_date < v_from.start_date or c.start_date > v_to.start_date)
  loop
    delete from public.sprint_items where cycle_id = v_cycle.id and task_id = t.id and moved_at is null;
    v_removed := v_removed || v_cycle.id;
  end loop;

  -- Недостающие строки: запланированные спринты отрезка. Идущий не трогаем.
  for v_cycle in
    select c.id from public.sprint_cycles c
     where c.group_id = p_group_id and c.tab_id is not distinct from p_tab_id
       and c.status = 'draft' and c.archived_at is null
       and c.start_date >= v_from.start_date and c.start_date <= v_to.start_date
     order by c.start_date
  loop
    select id into v_item_id from public.sprint_items
     where cycle_id = v_cycle.id and task_id = t.id;
    if v_item_id is null then
      insert into public.sprint_items (cycle_id, task_id, in_plan, added_by)
      values (v_cycle.id, t.id, true, p_actor);
      v_added := v_added || v_cycle.id;
    elsif exists (select 1 from public.sprint_items where id = v_item_id and withdrawn_at is not null) then
      update public.sprint_items set withdrawn_at = null, withdrawn_by = null where id = v_item_id;
      v_added := v_added || v_cycle.id;
    end if;
  end loop;

  -- Причина — в последнюю добавленную строку, если отрезок что-то добавил.
  if v_reason is not null and cardinality(v_added) > 0 then
    update public.sprint_items set plan_reason = v_reason
     where task_id = t.id and cycle_id = v_added[cardinality(v_added)];
  end if;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$$;

comment on function public.sprint_set_task_span(uuid, uuid, text, uuid, uuid, text, text) is
  'План работы задачи: непрерывный отрезок запланированных спринтов пространства. Добавляет недостающие строки (in_plan), снимает лишние только в запланированных, идущий и принятые не трогает, срок задачи не меняет. Причина обязательна после срока и при продлении из идущего (plan_reason последней добавленной строки). Зовут API и MCP под service_role.';

revoke all on function public.sprint_set_task_span(uuid, uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.sprint_set_task_span(uuid, uuid, text, uuid, uuid, text, text) to service_role;
