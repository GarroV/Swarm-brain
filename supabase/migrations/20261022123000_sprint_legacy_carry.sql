-- Наследство автоматики 19.10.2026 → настоящий перенос (доска спринтов, 22.10.2026).
--
-- Старый триггер срока (20261019120000), сдвинув срок за конец идущего спринта, ставил строке
-- идущего пометку «к переносу» от автоматики (`to_carry and carry_auto`) и заводил задаче строку
-- в запланированном спринте срока (`added_by is null`, `carried_from is null`). Новый триггер
-- (20261022121000) видит такую пару как «план из двух спринтов»: срок вернули в идущий — строка в
-- запланированном остаётся, задача в двух спринтах; срок сдвинули дальше — план «продлевается».
--
-- `sprint_convert_legacy_carry()` превращает каждую такую пару в то, что сделал бы перенос сегодня:
-- источник — снимок (`moved_*`, `frozen_*` как в `sprint_move_task_internal`; причина остаётся как
-- была — пустая даёт красный снимок, её спросят один раз), строка в запланированном — цель
-- (`carried_from`, `carry_count + 1`). Не трогает: ручные пометки (не `carry_auto`), авто-пометку
-- без строки в запланированном (её довезёт приёмка), закрытые, архивные и приватные задачи
-- (снимок закрытой убрал бы её из «сделано» идущего спринта). Срок задачи не меняется.
--
-- Идемпотентна: преобразованная пара больше не подходит под условие (источник — снимок без
-- пометки, у цели есть `carried_from`). Возвращает число преобразованных пар.

create or replace function public.sprint_convert_legacy_carry()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p record;
  v_n integer := 0;
begin
  for p in
    select distinct on (si.id)
           si.id as src_id, si.carry_count, d.id as target_id, t.id as task_id
      from public.sprint_items si
      join public.sprint_cycles c on c.id = si.cycle_id
      join public.tasks t on t.id = si.task_id
      join public.sprint_items d on d.task_id = si.task_id and d.id <> si.id
      join public.sprint_cycles dc on dc.id = d.cycle_id
     where si.to_carry and si.carry_auto
       and si.withdrawn_at is null and si.moved_at is null
       and c.status = 'active' and c.archived_at is null
       and t.archived_at is null and not t.is_private and t.status not in ('done', 'cancelled')
       and dc.status = 'draft' and dc.archived_at is null
       and dc.group_id = c.group_id and dc.tab_id is not distinct from c.tab_id
       and d.added_by is null and d.carried_from is null and not d.auto_extended
       and d.moved_at is null and d.withdrawn_at is null
     order by si.id, dc.start_date
  loop
    -- Порядок замков как у переноса: задача, потом строки спринта.
    perform 1 from public.tasks where id = p.task_id for update;
    perform 1 from public.sprint_items where id in (p.src_id, p.target_id) for update;

    update public.sprint_items si
       set moved_at            = coalesce(si.carry_at, now()),
           moved_to            = p.target_id,
           moved_by            = si.carry_by,
           to_carry            = false,
           carry_auto          = false,
           -- Причину, которую уже вписали и которая ушла комментарием «Перенос (<спринт>): …»,
           -- второй раз не спрашиваем: пометку могли снять и поставить заново, и поле опустело.
           carry_reason        = coalesce(
             nullif(btrim(si.carry_reason), ''),
             (select nullif(btrim(substr(tc.content, length('Перенос (' || c.name || '):') + 1)), '')
                from public.task_comments tc
                join public.sprint_cycles c on c.id = si.cycle_id
               where tc.task_id = p.task_id
                 and left(tc.content, length('Перенос (' || c.name || '):')) = 'Перенос (' || c.name || '):'
               order by tc.created_at desc
               limit 1)),
           frozen_at           = coalesce(si.carry_at, now()),
           frozen_title        = t.title,
           frozen_status       = t.status,
           frozen_assignees    = t.assignees,
           frozen_completed_at = t.completed_at,
           frozen_due_date     = t.due_date
      from public.tasks t
     where si.id = p.src_id and t.id = p.task_id
       and si.moved_at is null;
    if not found then
      continue;
    end if;

    update public.sprint_items
       set carried_from = p.src_id,
           carry_count  = p.carry_count + 1
     where id = p.target_id and carried_from is null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.sprint_convert_legacy_carry() is
  'Разовое (и безопасно повторяемое) преобразование авто-пометок «к переносу» 19.10.2026 со строкой в спринте срока в перенос: источник — снимок, строка запланированного — цель. Миграция 20261022123000.';

revoke all on function public.sprint_convert_legacy_carry() from public, anon, authenticated;
grant execute on function public.sprint_convert_legacy_carry() to service_role;

select public.sprint_convert_legacy_carry();
