-- Архивная задача уходит из спринтов и напоминаний (issue #575).
--
-- С 21.09.2026 «Удалить» у задачи — это UPDATE archived_at (issue #427), а не DELETE. Читатели,
-- написанные до архивации, этого не узнали:
--   • упоминание в составе спринта ставил триггер BEFORE DELETE — на UPDATE он молчит, и архивная
--     задача оставалась в спринте живой: считалась невыполненным планом и при приёмке уезжала в
--     следующий спринт, оттуда — в следующий;
--   • пинг гасился, если дошёл хоть одному из исполнителей.
-- Чтение в коде отсекает архив через onlyLive (_shared/tasks/live.ts); здесь — то, что живёт в базе.
--
-- Миграция идемпотентна целиком (её накатывает повторно порча, scripts/porcha-sql).

-- ── Кому пинг уже дошёл ───────────────────────────────────────────────────────────────────
-- Аддитивно. Пинг гасится (reminded_at), только когда дошёл всем получателям; дошедшим
-- повторно не шлём. Правило — settlePing в swarm-bot/handlers/task-pings.ts под тестами.
alter table public.tasks add column if not exists ping_delivered_to bigint[] not null default '{}';

comment on column public.tasks.ping_delivered_to is 'Кому пинг уже дошёл (telegram id). Пинг гасится, когда дошёл всем; перевзвод пинга (новая дата или reminded_at = null) список очищает триггером trg_tasks_ping_rearm.';

-- Перевзвод пинга очищает список одним местом в базе: взводят пинг и веб (swarm-api), и MCP
-- (swarm-mcp/tasks/ping.ts), и третий писатель, забывший про колонку, молча оставил бы
-- получателей без нового напоминания.
create or replace function public.tasks_ping_rearm()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.reminded_at is null
     and (old.reminded_at is not null or new.remind_date is distinct from old.remind_date) then
    new.ping_delivered_to := '{}';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_ping_rearm on public.tasks;
create trigger trg_tasks_ping_rearm
  before update of remind_date, reminded_at on public.tasks
  for each row execute function public.tasks_ping_rearm();

revoke all on function public.tasks_ping_rearm() from public;

-- ── Архивация задачи оставляет в спринте упоминание ───────────────────────────────────────
-- То же, что делает удаление (sprint_items_keep_removed_task), но связь task_id НЕ рвётся:
-- задача цела, и возврат из архива возвращает её в состав. Принятый спринт не трогаем — его
-- снимок обязан остаться таким, каким его прочитали в день приёмки.
create or replace function public.sprint_items_follow_task_archive()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    update public.sprint_items
       set removed_title      = new.title,
           removed_project_id = new.project_id,
           removed_at         = new.archived_at
     where task_id = new.id
       and frozen_at is null  -- принятый спринт не трогаем
       and removed_at is null;
  elsif old.archived_at is not null and new.archived_at is null then
    update public.sprint_items
       set removed_title      = null,
           removed_project_id = null,
           removed_at         = null
     where task_id = new.id
       and frozen_at is null;
  end if;
  return null;
end;
$$;

comment on function public.sprint_items_follow_task_archive() is 'Архивация задачи превращает её строку в непринятых спринтах в упоминание (removed_*), возврат из архива — обратно в живую. Связь task_id сохраняется.';

drop trigger if exists trg_tasks_archive_in_sprints on public.tasks;
create trigger trg_tasks_archive_in_sprints
  after update of archived_at on public.tasks
  for each row execute function public.sprint_items_follow_task_archive();

revoke all on function public.sprint_items_follow_task_archive() from public;

-- Задачи, ушедшие в архив до этой миграции (на проде 01.10.2026 таких в непринятых спринтах 0,
-- но стенды и будущие копии не обязаны совпадать).
update public.sprint_items si
   set removed_title      = t.title,
       removed_project_id = t.project_id,
       removed_at         = t.archived_at
  from public.tasks t
 where si.task_id = t.id
   and t.archived_at is not null
   and si.frozen_at is null
   and si.removed_at is null;

-- ── Приёмка: архивная задача в следующий спринт не едет ───────────────────────────────────
-- Тело — из 20260918120000_initiatives_board.sql плюс одно условие в шаге 4.
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
  -- считает живыми и черновик, и идущий, поэтому пока этот active, второй в пространстве не
  -- вставится. Итоги пишутся один раз и больше не пересчитываются — отчёт не должен меняться
  -- от дальнейшей жизни задач.
  update public.sprint_cycles
     set status      = 'accepted',
         accepted_at = v_now,
         accepted_by = p_accepted_by,
         summary     = coalesce(p_summary, summary),
         stats       = p_stats,
         updated_at  = v_now
   where id = p_cycle_id;

  -- 3. Следующий спринт — черновик в том же пространстве. Создаётся до переноса: хвостам
  -- нужно, куда ехать.
  insert into public.sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status, created_by)
  values (p_group_id, v_cycle.tab_id, p_next_name, p_next_start, p_next_end, p_next_check, 'draft', p_accepted_by)
  returning id into v_next_id;

  -- 4. Хвосты (переопределено миграцией 20261001180000, #575). Условие повторяет planCarry: закрытая остаётся, остальные едут, и пометка
  -- человека отличает осознанный перенос от автоматического. Удалённая не едет сама собой —
  -- соединение с tasks её не находит (внешний ключ обнулил task_id); проверено тестом
  -- «упоминание удалённой задачи никуда не переносится».
  -- Приватную задачу не переносим: в новом спринте её состав увидит вся команда, а приватная
  -- задача видна только владельцу (то же условие стоит при добавлении в спринт).
  with moved as (
    insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, carried_from, carried_manual, carry_count)
    select v_next_id, si.task_id, true, p_accepted_by, si.id, si.to_carry, si.carry_count + 1
      from public.sprint_items si
      join public.tasks t on t.id = si.task_id
     where si.cycle_id = p_cycle_id
       and t.status not in ('done', 'cancelled')
       and t.is_private = false
       -- Архивная задача не едет (#575): «Удалить» с 21.09.2026 ставит archived_at, а не
       -- стирает строку, и соединение её больше не отсекает.
       and t.archived_at is null
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
    'carried_auto',   v_auto
  );
end;
$$;

comment on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) is 'Приёмка спринта одной транзакцией: снимок состава, следующий черновик, перенос хвостов, статус и итоги. Итоги и даты считает TypeScript под тестами — здесь только то, что обязано быть неделимым.';

-- Урок GHSA-vxrp-599j-46hv: грант на PUBLIC наследуется в anon и authenticated, и обычный
-- REVOKE ... FROM anon его не снимает. Поэтому сначала снимаем со всех, потом выдаём одному.
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from public;
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from anon;
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from authenticated;
grant execute on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) to service_role;
