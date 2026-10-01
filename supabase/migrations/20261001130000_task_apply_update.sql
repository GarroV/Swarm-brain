-- Обновление задачи одной транзакцией (issue #577).
--
-- До этой функции `updateTask` (`_shared/tasks/db.ts`) делал три отдельных вызова PostgREST:
-- SELECT снимка, UPDATE задачи и INSERT в `task_history`. Ошибку UPDATE никто не читал — веб,
-- бот и MCP отвечали «обновлено», а журнал записывал изменение, которого в базе нет. Журнал
-- писался вторым вызовом и при сбое оставлял только `console.error`. И ничто не мешало двум
-- одновременным «готово» по регулярной задаче перекатить срок дважды: оба запроса видели
-- прежний срок, и вхождение графика пропадало.
--
-- Функция делает всё под одной блокировкой строки и в одной транзакции:
--   1. `select … for update` — второй одновременный запрос ждёт, пока первый закончит;
--   2. `p_expect` — значения, от которых вызывающий считал патч и журнал (срок перед перекатом,
--      прежние значения журналируемых полей). Расхождение = строку изменили между чтением и
--      записью → ошибка PT409 (PostgREST отдаёт её как HTTP 409), ничего не записано;
--   3. UPDATE только колонок из патча;
--   4. строки журнала — в той же транзакции: упала вставка журнала → откатилось и изменение.
--
-- Сами правила (перекат, дата закрытия, какие поля журналируются) остаются в TypeScript —
-- там они под тестами и общие для веба, бота и MCP. Функция отвечает только за атомарность.
--
-- Аддитивная миграция: новая функция, таблицы не меняются.

create or replace function public.task_apply_update(
  p_task_id uuid,
  p_patch jsonb,
  p_expect jsonb default '{}'::jsonb,
  p_history jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.tasks;
  v_key text;
  v_set text;
begin
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'task_apply_update: patch must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_history, '[]'::jsonb)) <> 'array' then
    raise exception 'task_apply_update: history must be an array' using errcode = '22023';
  end if;

  select * into v_row from public.tasks
   where id = p_task_id and archived_at is null
   for update;
  if not found then
    raise exception 'task % not found', p_task_id using errcode = 'PT404';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
    if (to_jsonb(v_row) -> v_key) is distinct from (p_expect -> v_key) then
      raise exception 'task % changed concurrently: %', p_task_id, v_key
        using errcode = 'PT409';
    end if;
  end loop;

  -- id менять нельзя ни при каком патче: это ключ, на который ссылаются журнал и подзадачи.
  select string_agg(format('%I = p.%I', k, k), ', ')
    into v_set
    from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k
   where k <> 'id';

  if v_set is not null then
    -- Имя колонки, которой нет в tasks, роняет запрос («column p.x does not exist») — это
    -- правильно: раньше PostgREST отбивал такой UPDATE, а ошибку никто не читал.
    execute format(
      'update public.tasks t set %s from jsonb_populate_record(null::public.tasks, $1) p where t.id = $2',
      v_set
    ) using p_patch, p_task_id;
  end if;

  insert into public.task_history (
    task_id, field, old_value, new_value, changed_by, changed_by_telegram_id,
    group_id, old_status, new_status, note
  )
  select p_task_id, h.field, h.old_value, h.new_value, h.changed_by,
         h.changed_by_telegram_id, h.group_id, h.old_status, h.new_status, h.note
    from jsonb_populate_recordset(null::public.task_history, coalesce(p_history, '[]'::jsonb)) h;
end;
$$;

comment on function public.task_apply_update(uuid, jsonb, jsonb, jsonb) is
  'Изменение задачи + журнал одной транзакцией под блокировкой строки; p_expect — оптимистичная проверка (PT409). Issue #577';

-- Грант на PUBLIC наследуют anon и authenticated, и функция стала бы вызываемой через
-- /rest/v1/rpc с публичным ключом (урок GHSA-vxrp-599j-46hv). Снимаем с PUBLIC явно.
revoke all on function public.task_apply_update(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.task_apply_update(uuid, jsonb, jsonb, jsonb) to service_role;
