-- Спринты следуют за сроком задачи (решение владельца 19.10.2026 — канон
-- docs/decisions/2026-10-19-sprints-go-live-and-auto-by-deadline.md, дизайн —
-- docs/superpowers/specs/2026-10-19-sprint-auto-by-deadline-design.md).
--
-- Правило: задача, уже стоящая в спринтах пространства, находится в том спринте, на даты которого
-- приходится её срок. Идущий спринт задачу не теряет — только помечает перенос.
--
-- Механизм один на все пути записи срока: триггер на `tasks.due_date`. Срок меняют веб, бот и MCP
-- через `updateTask` → `task_apply_update`, и перекат повторяющейся задачи идёт тем же путём, но
-- триггер ловит и прямой UPDATE — копии логики в трёх сервисах нет, и новый путь записи не
-- обойдёт правило. Всё в одной транзакции со сменой срока: упала автоматика → срок не сменился,
-- и «срок новый, а спринт старый» не бывает.
--
-- Чистое правило — `planPlacement` (_shared/tasks/sprint-autoplace.ts); эта миграция обязана его
-- повторять, и тест базы (sprint-autoplace.db.test.ts) сверяет одно с другим.
--
-- Аддитивная миграция: колонка с умолчанием, новые функции, триггер; `accept_sprint_cycle` —
-- `create or replace` с прежним телом (20261011130000), изменён только адресат переноса хвоста.
-- Файл идемпотентен целиком (порча scripts/porcha-sql накатывает его повторно).

-- 1. Кто поставил отметку переноса. Автоматика (срок ушёл за конец идущего спринта) ставит
--    `carry_auto = true`; любое действие человека над отметкой сбрасывает признак (updateItem).
--    От него зависит «срок вернули — переносить нечего»: снять можно только свою отметку и только
--    пока причину не вписали.
alter table public.sprint_items
  add column if not exists carry_auto boolean not null default false;

comment on column public.sprint_items.carry_auto is
  'Отметку «к переносу» поставила автоматика по сроку задачи, а не человек. Сбрасывается любым ручным действием над отметкой.';

-- 2. Куда класть задачу со сроком p_due в пространстве (group, tab): запланированный спринт,
--    покрывающий срок; нет такого, а срок дальше последнего спринта — создаются ВСЕ промежуточные
--    подряд, без дыр (шаг 14 дней, старт — следующий день после конца последнего, имя и сверка —
--    как у nextCycleDates). Спринты создаются запланированными: стартуют только люди.
--    Возвращает id или null (срок раньше последнего спринта, а покрытия нет — зазор заведён
--    руками; либо срок дальше предела). Предел: не дальше 26 спринтов (≈ год) от сегодняшнего
--    дня — опечатка 2036 вместо 2026 не должна наплодить сотни спринтов.
create or replace function public.sprint_autoplace_target(
  p_group_id text,
  p_tab_id   uuid,
  p_due      date
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_sprint_days constant integer := 14;
  c_max_auto    constant integer := 26;
  v_id      uuid;
  v_last    public.sprint_cycles%rowtype;
  v_needed  integer;
  v_name    text;
  v_start   date;
  v_end     date;
  v_num     integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('sprint_space:' || p_group_id || ':' || coalesce(p_tab_id::text, ''), 0));

  select id into v_id
    from public.sprint_cycles
   where group_id = p_group_id
     and tab_id is not distinct from p_tab_id
     and status = 'draft'
     and archived_at is null
     and start_date <= p_due and p_due <= end_date
   order by start_date, created_at
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select * into v_last
    from public.sprint_cycles
   where group_id = p_group_id
     and tab_id is not distinct from p_tab_id
     and archived_at is null
   order by end_date desc, start_date desc, created_at desc
   limit 1;
  if v_last.id is null or p_due <= v_last.end_date then
    return null;
  end if;

  v_needed := ceil((p_due - v_last.end_date)::numeric / c_sprint_days)::integer;
  if p_due - current_date > c_max_auto * c_sprint_days or v_needed > c_max_auto then
    raise warning 'sprint_autoplace: срок % дальше предела автосоздания (% спринтов), спринты не созданы', p_due, c_max_auto;
    return null;
  end if;

  v_name := v_last.name;
  v_end  := v_last.end_date;
  while v_end < p_due loop
    v_start := v_end + 1;
    v_end   := v_start + (c_sprint_days - 1);
    v_num   := coalesce(substring(v_name from '(\d+)')::integer, 1) + 1;
    v_name  := 'Спринт ' || v_num || ' · ' || to_char(v_start, 'DD.MM') || ' — ' || to_char(v_end, 'DD.MM');
    insert into public.sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (p_group_id, p_tab_id, v_name, v_start, v_end, v_start + 6, 'draft')
    returning id into v_id;
  end loop;
  return v_id;
end;
$$;

comment on function public.sprint_autoplace_target(text, uuid, date) is
  'Запланированный спринт пространства, покрывающий срок; недостающие создаёт подряд (предел 26). null — зазор или срок дальше предела. Правило — planPlacement (sprint-autoplace.ts).';

-- 3. Размещение одной задачи после смены срока. Идущий спринт задачу не теряет никогда: его
--    строки здесь только добавляются или получают отметку; удаляются лишь строки запланированных
--    спринтов (как removeItem у черновика).
create or replace function public.sprint_autoplace_task(p_task_id uuid, p_due date)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t         record;
  sp        record;
  v_active  public.sprint_cycles%rowtype;
  v_item    public.sprint_items%rowtype;
  v_live    boolean;
  v_target  uuid;
begin
  if p_due is null then
    return;
  end if;
  select id, group_id, status, is_private, archived_at into t from public.tasks where id = p_task_id;
  if not found or t.archived_at is not null or t.is_private
     or t.status in ('done', 'cancelled') then
    return;
  end if;

  -- «В обороте» пространства: живая строка в незакрытом, не архивном спринте. Правило работает
  -- в каждом пространстве независимо.
  for sp in
    select distinct c.group_id, c.tab_id
      from public.sprint_items si
      join public.sprint_cycles c on c.id = si.cycle_id
     where si.task_id = p_task_id
       and si.withdrawn_at is null
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

    if v_active.id is not null then
      -- Срок раньше старта идущего (просрочено): задача остаётся где была.
      if p_due < v_active.start_date then
        continue;
      end if;

      select * into v_item from public.sprint_items
       where cycle_id = v_active.id and task_id = p_task_id;
      v_live := v_item.id is not null and v_item.withdrawn_at is null;

      if p_due <= v_active.end_date then
        -- Срок внутри идущего: задача в нём (сверх плана, если её не было), будущие строки лишние.
        if not v_live then
          if v_item.id is not null then
            update public.sprint_items set withdrawn_at = null, withdrawn_by = null where id = v_item.id;
          else
            insert into public.sprint_items (cycle_id, task_id, in_plan, added_by)
            values (v_active.id, p_task_id, false, null)
            on conflict (cycle_id, task_id) where task_id is not null do nothing;
          end if;
        elsif v_item.to_carry and v_item.carry_auto
              and coalesce(btrim(v_item.carry_reason), '') = '' then
          -- Срок вернули — переносить нечего. Отметку человека или с вписанной причиной не трогаем.
          update public.sprint_items
             set to_carry = false, carry_auto = false, carry_at = null, carry_by = null, carry_reason = null
           where id = v_item.id;
        end if;

        delete from public.sprint_items si
         using public.sprint_cycles c
         where si.cycle_id = c.id and si.task_id = p_task_id
           and c.status = 'draft' and c.archived_at is null
           and c.group_id = sp.group_id and c.tab_id is not distinct from sp.tab_id;
        continue;
      end if;

      -- Срок за концом идущего: задача остаётся в нём с отметкой переноса. Причину система не
      -- придумывает — её вписывает человек.
      if v_live and not v_item.to_carry then
        update public.sprint_items
           set to_carry = true, carry_auto = true, carry_at = now(), carry_by = null
         where id = v_item.id;
      end if;
    end if;

    v_target := public.sprint_autoplace_target(sp.group_id, sp.tab_id, p_due);
    if v_target is not null then
      insert into public.sprint_items (cycle_id, task_id, in_plan, added_by)
      values (v_target, p_task_id, true, null)
      on conflict (cycle_id, task_id) where task_id is not null do nothing;

      -- Срок — единственный источник правды для будущих спринтов: в двух местах задача не висит.
      delete from public.sprint_items si
       using public.sprint_cycles c
       where si.cycle_id = c.id and si.task_id = p_task_id
         and si.cycle_id <> v_target
         and c.status = 'draft' and c.archived_at is null
         and c.group_id = sp.group_id and c.tab_id is not distinct from sp.tab_id;
    end if;
  end loop;
end;
$$;

comment on function public.sprint_autoplace_task(uuid, date) is
  'Правило «задача там, где её срок» для задачи, уже стоящей в спринтах пространства. Зовёт триггер tasks_sprint_autoplace. Правило — planPlacement (sprint-autoplace.ts).';

create or replace function public.tasks_sprint_autoplace_trg()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.sprint_autoplace_task(new.id, new.due_date);
  return null;
end;
$$;

drop trigger if exists tasks_sprint_autoplace on public.tasks;
create trigger tasks_sprint_autoplace
  after update of due_date on public.tasks
  for each row
  when (old.due_date is distinct from new.due_date)
  execute function public.tasks_sprint_autoplace_trg();

-- Грант на PUBLIC наследуют anon и authenticated (урок GHSA-vxrp-599j-46hv): снимаем явно.
revoke all on function public.sprint_autoplace_target(text, uuid, date) from public, anon, authenticated;
grant execute on function public.sprint_autoplace_target(text, uuid, date) to service_role;
revoke all on function public.sprint_autoplace_task(uuid, date) from public, anon, authenticated;
grant execute on function public.sprint_autoplace_task(uuid, date) to service_role;
revoke all on function public.tasks_sprint_autoplace_trg() from public, anon, authenticated;
grant execute on function public.tasks_sprint_autoplace_trg() to service_role;

-- 4. Приёмка: хвост со сроком позже конца принимаемого спринта едет в спринт своего срока
--    (создав недостающие по тем же правилам), остальные — в ближайший запланированный, как раньше.
--    Тело — редакция из 20261011130000_future_sprints.sql; все условия переноса (снятая #576,
--    архивная #575, приватная, закрытая) сохранены до одного.
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

  -- 3. Куда ехать хвостам по умолчанию: ближайший запланированный спринт этого пространства (по
  --    дате старта). Нет такого — создаём черновик с датами, которые посчитал TypeScript.
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

  -- 4. Хвосты. Условие повторяет planCarry: закрытая остаётся, остальные едут, и пометка
  -- человека отличает осознанный перенос от автоматического. Удалённая не едет сама собой —
  -- соединение с tasks её не находит (внешний ключ обнулил task_id); проверено тестом
  -- «упоминание удалённой задачи никуда не переносится».
  -- Снятую из идущего спринта (#576) не переносим: её убрали из спринта осознанно, и
  -- привезти её в следующий значило бы молча отменить решение человека.
  -- Приватную задачу не переносим: в новом спринте её состав увидит вся команда, а приватная
  -- задача видна только владельцу (то же условие стоит при добавлении в спринт).
  -- Адресат: срок позже конца принимаемого спринта — спринт этого срока (sprint_autoplace_target
  -- создаёт недостающие по тем же правилам и с тем же пределом); без срока, с прошедшим сроком,
  -- с зазором или за пределом — ближайший запланированный, как раньше.
  with moved as (
    insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, carried_from, carried_manual, carry_count)
    select coalesce(
             case when t.due_date > v_cycle.end_date
                  then public.sprint_autoplace_target(p_group_id, v_cycle.tab_id, t.due_date)
             end,
             v_next_id),
           si.task_id, true, p_accepted_by, si.id, si.to_carry, si.carry_count + 1
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

comment on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) is 'Приёмка спринта одной транзакцией: снимок состава, перенос хвостов (в спринт срока задачи, иначе в ближайший запланированный; нет запланированного — новый черновик), статус и итоги. Итоги и даты считает TypeScript под тестами — здесь только то, что обязано быть неделимым.';

revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from public, anon, authenticated;
grant execute on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) to service_role;
