-- Перенос задачи между спринтами — одно настоящее действие с одной обязательной причиной
-- (решение владельца 22.10.2026 — docs/decisions/2026-10-22-sprint-board-direction.md, проект —
-- docs/superpowers/specs/2026-10-22-sprint-board-design.md).
--
-- Было: «→» и сдвиг срока задачу никуда не двигали, а вешали пометку «к переносу»; задача
-- уезжала только на приёмке, поэтому причину выпрашивали в трёх местах. Стало: задача сразу
-- оказывается в спринте-цели, а строка идущего спринта остаётся СНИМКОМ — «перенесена → Спринт N,
-- причина, кто, когда». Снимок = `moved_at is not null`.
--
-- Правило в одном месте — здесь: его зовут API и MCP (`sprint_move_task`, причина обязательна) и
-- триггер срока (`sprint_move_task_internal`, причины нет — снимок «причина не указана», её
-- спросят один раз позже).
--
-- Срок задачи эта функция не трогает, кроме явной новой даты из окна переноса. Смена срока здесь
-- помечена сессионным флагом `swarm.sprint_moving`: триггер срока (tasks_sprint_autoplace) видит
-- его и молчит — задача уже размещена, второе размещение наплодило бы строк.
--
-- Аддитивная миграция: колонки с умолчаниями, новые функции. `to_carry`/`carry_auto` не трогаем —
-- старые вкладки и MCP шлют `PATCH {to_carry}` до уборки (правило двух шагов).
-- Файл идемпотентен целиком.

alter table public.sprint_items
  add column if not exists moved_at      timestamptz,
  add column if not exists moved_to      uuid references public.sprint_items(id) on delete set null,
  add column if not exists moved_by      text,
  add column if not exists plan_reason   text,
  add column if not exists auto_extended boolean not null default false;

comment on column public.sprint_items.moved_at is
  'Задача ушла из этого спринта переносом: строка — снимок (frozen_* на момент ухода), в счёт спринта не идёт. Причина ухода — carry_reason.';
comment on column public.sprint_items.moved_to is
  'Строка спринта-цели переноса. null при moved_at — цель удалена («перенесена (спринт удалён)»).';
comment on column public.sprint_items.moved_by is
  'Кто перенёс (telegram id текстом, как withdrawn_by); null — автоматика по сроку задачи.';
comment on column public.sprint_items.plan_reason is
  'Почему работа запланирована после срока задачи или продлена за её последний спринт.';
comment on column public.sprint_items.auto_extended is
  'Строку добавила автоматика: срок ушёл за последний спринт плана задачи, план продлён без причины.';

-- Удаление строки-цели обнуляет ссылку снимка; индекс — чтобы это не было полным проходом.
create index if not exists idx_sprint_items_moved_to on public.sprint_items(moved_to) where moved_to is not null;

-- Перенос без проверки причины. Зовут: публичная `sprint_move_task` (после проверки причины) и
-- триггер срока (причины нет). Все остальные проверки — здесь, чтобы ни один путь их не обошёл.
create or replace function public.sprint_move_task_internal(
  p_item_id         uuid,
  p_target_cycle_id uuid,
  p_reason          text,
  p_new_due         date,
  p_actor           text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_src         public.sprint_items%rowtype;
  v_cycle       public.sprint_cycles%rowtype;
  v_target      public.sprint_cycles%rowtype;
  t             public.tasks%rowtype;
  v_reason      text := nullif(btrim(p_reason), '');
  v_target_item uuid;
  v_withdrawn   timestamptz;
  v_revived     boolean := false;
begin
  -- Блокировка исходной строки: двое одновременно переносят одну задачу — второй ждёт первого и
  -- видит уже снимок («Задача уже перенесена»), а не кладёт задачу во второй спринт.
  select * into v_src from public.sprint_items where id = p_item_id for update;
  if not found or v_src.task_id is null then
    raise exception 'Строка спринта не найдена' using errcode = 'P0001';
  end if;
  if v_src.moved_at is not null then
    raise exception 'Задача уже перенесена' using errcode = 'P0001';
  end if;
  if v_src.withdrawn_at is not null then
    raise exception 'Задача снята из спринта' using errcode = 'P0001';
  end if;

  select * into v_cycle from public.sprint_cycles where id = v_src.cycle_id;
  if v_cycle.status <> 'active' or v_cycle.archived_at is not null then
    raise exception 'Перенести можно только из идущего спринта' using errcode = 'P0001';
  end if;

  select * into t from public.tasks where id = v_src.task_id for update;
  if t.archived_at is not null then
    raise exception 'Задача в архиве' using errcode = 'P0001';
  end if;
  if t.is_private then
    raise exception 'Приватную задачу не переносим' using errcode = 'P0001';
  end if;
  if t.status in ('done', 'cancelled') then
    raise exception 'Выполненную или отменённую задачу не переносим' using errcode = 'P0001';
  end if;

  -- Цель — запланированный спринт ТОГО ЖЕ пространства (воркспейс + вкладка), не архивный.
  select * into v_target
    from public.sprint_cycles
   where id = p_target_cycle_id
     and group_id = v_cycle.group_id
     and tab_id is not distinct from v_cycle.tab_id
     and archived_at is null;
  if not found then
    raise exception 'Спринт-цель не найден в этом пространстве' using errcode = 'P0001';
  end if;
  if v_target.status <> 'draft' then
    raise exception 'Перенести можно только в запланированный спринт' using errcode = 'P0001';
  end if;

  insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, carried_from, carried_manual, carry_count)
  values (v_target.id, t.id, true, p_actor, v_src.id, v_reason is not null, v_src.carry_count + 1)
  on conflict (cycle_id, task_id) where task_id is not null do nothing
  returning id into v_target_item;

  if v_target_item is null then
    -- Задача уже стоит в плане цели — вторую строку не заводим, существующая и есть цель.
    select id, withdrawn_at into v_target_item, v_withdrawn
      from public.sprint_items where cycle_id = v_target.id and task_id = t.id;
    if v_withdrawn is not null then
      update public.sprint_items set withdrawn_at = null, withdrawn_by = null where id = v_target_item;
      v_revived := true;
    end if;
  end if;

  -- Снимок: состояние на момент ухода. Имя инициативы не замораживаем — его даёт живая задача
  -- (sprint-items.ts), снимок бывает только у задачи, которая продолжает жить.
  -- Уже вписанная человеком причина старой пометки «к переносу» подставляется, не теряется.
  update public.sprint_items
     set moved_at            = now(),
         moved_to            = v_target_item,
         moved_by            = p_actor,
         carry_reason        = coalesce(v_reason, case when to_carry then nullif(btrim(carry_reason), '') end),
         to_carry            = false,
         carry_auto          = false,
         frozen_at           = now(),
         frozen_title        = t.title,
         frozen_status       = t.status,
         frozen_assignees    = t.assignees,
         frozen_completed_at = t.completed_at,
         frozen_due_date     = t.due_date
   where id = v_src.id;

  if p_new_due is not null and p_new_due is distinct from t.due_date then
    perform set_config('swarm.sprint_moving', '1', true);
    update public.tasks set due_date = p_new_due, updated_at = now() where id = t.id;
    perform set_config('swarm.sprint_moving', '', true);
    insert into public.task_history (
      task_id, field, old_value, new_value, changed_by, changed_by_telegram_id, group_id, note
    ) values (
      t.id, 'due_date', t.due_date::text, p_new_due::text, coalesce(nullif(btrim(p_actor), ''), 'system'),
      case when p_actor ~ '^[0-9]+$' then p_actor::bigint end, t.group_id, 'Перенос в спринт'
    );
  end if;

  return jsonb_build_object(
    'source_item_id', v_src.id,
    'target_item_id', v_target_item,
    'revived',        v_revived
  );
end;
$$;

comment on function public.sprint_move_task_internal(uuid, uuid, text, date, text) is
  'Перенос строки идущего спринта в запланированный того же пространства: строка в цели, исходная — снимок. Причина не проверяется (зовёт триггер срока); людям — sprint_move_task.';

create or replace function public.sprint_move_task(
  p_item_id         uuid,
  p_target_cycle_id uuid,
  p_reason          text,
  p_new_due         date,
  p_actor           text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Нужна причина переноса' using errcode = 'P0001';
  end if;
  return public.sprint_move_task_internal(p_item_id, p_target_cycle_id, p_reason, p_new_due, p_actor);
end;
$$;

comment on function public.sprint_move_task(uuid, uuid, text, date, text) is
  'Перенос задачи человеком (API, MCP): причина обязательна, срок меняется только новой датой. Правило — sprint_move_task_internal.';

-- Грант на PUBLIC наследуют anon и authenticated (урок GHSA-vxrp-599j-46hv): снимаем явно.
revoke all on function public.sprint_move_task_internal(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.sprint_move_task_internal(uuid, uuid, text, date, text) to service_role;
revoke all on function public.sprint_move_task(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.sprint_move_task(uuid, uuid, text, date, text) to service_role;
