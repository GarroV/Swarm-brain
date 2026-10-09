-- Будущие спринты: в пространстве можно заранее завести несколько запланированных спринтов,
-- а идёт по-прежнему один. Решение владельца 09.10.2026 — канон
-- docs/decisions/2026-10-09-future-sprints.md.
--
-- Владелец: «спринты в будущее нужно занести, вне зависимости можешь или нет. если надо
-- миграции - делай миграции».
--
-- Черновик (draft) и есть «запланированный»: нового статуса не нужно.

-- 1. Уникальность сужается с «один незакрытый» до «один идущий». Черновиков — сколько угодно.
drop index if exists public.uniq_sprint_cycles_live_per_tab;
create unique index if not exists uniq_sprint_cycles_active_per_tab
  on public.sprint_cycles (tab_id)
  where status = 'active'
    and tab_id is not null
    and archived_at is null;

-- 2. Приёмка: хвосты едут в БЛИЖАЙШИЙ уже запланированный спринт пространства, а новый черновик
--    создаётся, только если запланированного нет. Иначе рядом с заведённым «Спринт 4» появился бы
--    его двойник, и хвосты уехали бы в двойника.
--    Тело — редакция из 20261001180000_archived_tasks_leave_sprints.sql; условия переноса
--    (снятая #576, архивная #575, приватная) сохранены все до одного.
create or replace function public.accept_sprint_cycle(
  p_cycle_id     uuid,
  p_group_id     text,
  p_accepted_by  text,
  p_summary      text,
  p_stats        jsonb,
  p_next_name    text,
  p_next_start   date,
  p_next_end     date,
  p_next_check   date
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cycle   public.sprint_cycles%rowtype;
  v_next_id uuid;
  v_frozen  integer := 0;
  v_manual  integer := 0;
  v_auto    integer := 0;
  v_now     timestamptz := now();
  v_created boolean := false;
begin
  -- Блокировка строки спринта: два одновременных нажатия «Принять» выстраиваются в очередь,
  -- и второе увидит уже принятый спринт, а не примет его второй раз.
  select * into v_cycle
    from public.sprint_cycles
   where id = p_cycle_id and group_id = p_group_id
     for update;

  if not found then
    raise exception 'Спринт не найден' using errcode = 'P0001';
  end if;
  if v_cycle.status <> 'active' then
    raise exception 'Принять можно только идущий спринт, а этот — %', v_cycle.status
      using errcode = 'P0001';
  end if;

  -- 1. Снимок состава. Упоминания удалённых задач не трогаем: у них нечего замораживать,
  -- removed_* уже написал триггер, и frozen_at на них сделал бы строку с пустым статусом.
  -- Отдельного условия на removed_at здесь нет и не нужно: удаление задачи обнуляет
  -- sprint_items.task_id внешним ключом, и упоминание отсекается самим соединением. Условие
  -- «на всякий случай» стояло и было снято порчей — оно не краснело ни на одной поломке,
  -- то есть не держало ничего, зато внушало, что без него строки потекут.
  update public.sprint_items si
     set frozen_at           = v_now,
         frozen_title        = t.title,
         frozen_status       = t.status,
         frozen_assignees    = t.assignees,
         frozen_project      = p.name,
         frozen_completed_at = t.completed_at,
         frozen_due_date     = t.due_date
    from public.tasks t
    left join public.projects p on p.id = t.project_id
   where si.cycle_id = p_cycle_id
     and si.task_id  = t.id
     and si.frozen_at is null;
  get diagnostics v_frozen = row_count;

  -- 2. Спринт принят. Ставится ДО создания следующего: уникальный индекс живого спринта
  -- считает живыми и черновик, и идущий, поэтому пока этот active, второй идущий в пространстве не
  -- появится. Итоги пишутся один раз и больше не пересчитываются — отчёт не должен меняться
  -- от дальнейшей жизни задач.
  update public.sprint_cycles
     set status      = 'accepted',
         accepted_at = v_now,
         accepted_by = p_accepted_by,
         summary     = coalesce(p_summary, summary),
         stats       = p_stats,
         updated_at  = v_now
   where id = p_cycle_id;

  -- 3. Куда ехать хвостам: ближайший запланированный спринт этого пространства (по дате старта).
  --    Нет такого — создаём черновик с датами, которые посчитал TypeScript.
  select id into v_next_id
    from public.sprint_cycles
   where tab_id is not distinct from v_cycle.tab_id
     and group_id = p_group_id
     and status = 'draft'
     and archived_at is null
     and id <> p_cycle_id
   order by start_date, created_at
   limit 1
     for update;

  if v_next_id is null then
    insert into public.sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status, created_by)
    values (p_group_id, v_cycle.tab_id, p_next_name, p_next_start, p_next_end, p_next_check, 'draft', p_accepted_by)
    returning id into v_next_id;
    v_created := true;
  end if;

  -- 4. Хвосты (переопределено миграцией 20261001180000, #575). Условие повторяет planCarry: закрытая остаётся, остальные едут, и пометка
  -- человека отличает осознанный перенос от автоматического. Удалённая не едет сама собой —
  -- соединение с tasks её не находит (внешний ключ обнулил task_id); проверено тестом
  -- «упоминание удалённой задачи никуда не переносится».
  -- Снятую из идущего спринта (#576) не переносим: её убрали из спринта осознанно, и
  -- привезти её в следующий значило бы молча отменить решение человека.
  -- Приватную задачу не переносим: в новом спринте её состав увидит вся команда, а приватная
  -- задача видна только владельцу (то же условие стоит при добавлении в спринт).
  with moved as (
    insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, carried_from, carried_manual, carry_count)
    select v_next_id, si.task_id, true, p_accepted_by, si.id, si.to_carry, si.carry_count + 1
      from public.sprint_items si
      join public.tasks t on t.id = si.task_id
     where si.cycle_id = p_cycle_id
       and si.withdrawn_at is null
       and t.status not in ('done', 'cancelled')
       and t.is_private = false
       -- Архивная задача не едет (#575): «Удалить» с 21.09.2026 ставит archived_at, а не
       -- стирает строку, и соединение её больше не отсекает.
       and t.archived_at is null
    -- Задача уже заранее стоит в плане этого спринта — второй строки не заводим.
    on conflict (cycle_id, task_id) where task_id is not null do nothing
    returning carried_manual
  )
  select count(*) filter (where carried_manual),
         count(*) filter (where not carried_manual)
    into v_manual, v_auto
    from moved;

  return jsonb_build_object(
    'cycle_id',       p_cycle_id,
    'next_cycle_id',  v_next_id,
    'frozen',         v_frozen,
    'carried_manual', v_manual,
    'carried_auto',   v_auto,
    'next_created',   v_created
  );
end;
$$;


comment on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) is 'Приёмка спринта одной транзакцией: снимок состава, перенос хвостов в ближайший запланированный спринт (или в новый черновик, если запланированного нет), статус и итоги. Итоги и даты считает TypeScript под тестами — здесь только то, что обязано быть неделимым.';

revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from public, anon, authenticated;
grant execute on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) to service_role;
