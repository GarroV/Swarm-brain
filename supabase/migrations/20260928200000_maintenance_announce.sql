-- Заморозка одним нажатием: предупреждение плашкой → заморозка в назначенное время → снятие,
-- и уведомление в колокольчике всем рабочим воркспейсам (issue #609).
--
-- Владелец 28.09.2026: «при включении заморозки будет неплохо уведомлять пользователей.
-- показывать плашку с настраиваемым сообщением и временем, и также сигналить через уведомление
-- на сайте сворма (наш личный колокольчик...)».
--
-- Почему всё это — одна SQL-функция, а не три запроса в скрипте кнопки. Плашка, заморозка и
-- уведомления должны появиться ВМЕСТЕ или не появиться вовсе: заморозка без предупреждения —
-- ровно то, что чинит этот issue, а предупреждение без заморозки — ложная тревога. Функция
-- выполняется одной транзакцией. Вдобавок её можно проверить на настоящей базе и испортить
-- порчей (scripts/porcha-sql.txt) — скрипт кнопки ходит только в прод, и проверить его нечем.
--
-- Состояние по-прежнему живёт строками `app_settings` со сроком годности в данных:
--   · `maintenance`   — заморозка. Новое поле `starts_at`: до него режим не действует (сервер
--                       отвечает как обычно), с него — 503 на изменения. Гаснет сама по `until`.
--   · `deploy_notice` — плашка. `at` = начало заморозки, `until` = её конец, `kind = 'freeze'`,
--                       чтобы снятие заморозки гасило только СВОЮ плашку, а не объявление о
--                       ночной раскатке.
-- Отдельного расписания (pg_cron) не нужно: время начала и конца лежит в данных, и сервер с
-- вебом читают его на каждом запросе.
--
-- Идемпотентно целиком: `scripts/porcha-sql` перенакатывает файл как восстановление.

-- ── Лента: системное уведомление без задачи ──────────────────────────────────────────────────
-- `payload` — содержимое события, у которого нет строки-источника (у комментария источник —
-- task_comments, у заморозки — ничего постоянного: строка app_settings удаляется по снятию).
-- `dedup_key` — «одно событие = одна строка у человека»: повторное нажатие кнопки обновляет
-- уведомление, а не кладёт второе.
alter table public.notifications add column if not exists payload jsonb;
alter table public.notifications add column if not exists dedup_key text;

create unique index if not exists idx_notifications_dedup
  on public.notifications (recipient_telegram_id, dedup_key)
  where dedup_key is not null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('task_comment', 'task_reminder', 'maintenance'));

-- ── Объявить заморозку ───────────────────────────────────────────────────────────────────────
-- p_lead_min      — через сколько минут начать (0 — сразу); до начала висит плашка.
-- p_duration_min  — сколько длится заморозка, 1..180 (дольше — это уже простой, а не работы).
-- p_text_en/ru    — свой текст; пусто — стандартный. Идёт и в плашку, и в заглушку, и в колокольчик.
--
-- Повторное нажатие — это та же заморозка, а не новая: пока прежняя не истекла, её id
-- сохраняется, и уведомления обновляются на месте. Если заморозка уже идёт, начало не
-- сдвигается (иначе повтор РАЗМОРАЖИВАЛ бы систему до нового начала), продлевается только конец.
create or replace function public.maintenance_announce(
  p_lead_min integer,
  p_duration_min integer,
  p_text_en text default null,
  p_text_ru text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Демо — витрина продукта: наши работы смотрящего не касаются, а сброс демо (demo_reset)
  -- раз в полчаса сносит всё, что лежит в воркспейсе demo.
  c_demo    constant text    := 'demo';
  c_max_min constant integer := 180;
  c_def_en  constant text    := 'Swarm is being updated. Your data is safe — please come back in a few minutes.';
  c_def_ru  constant text    := 'Идёт обновление Swarm. Данные на месте — зайдите, пожалуйста, через несколько минут.';
  v_now     timestamptz := pg_catalog.now();
  v_prev    jsonb;
  v_prev_starts timestamptz;
  v_prev_until  timestamptz;
  v_id      text;
  v_starts  timestamptz;
  v_until   timestamptz;
  v_en      text := pg_catalog.left(pg_catalog.btrim(coalesce(p_text_en, '')), 300);
  v_ru      text := pg_catalog.left(pg_catalog.btrim(coalesce(p_text_ru, '')), 300);
  v_payload jsonb;
  v_sent    integer;
begin
  if p_lead_min is null or p_lead_min < 0 or p_lead_min > 1440 then
    raise exception 'maintenance_announce: начало — через 0..1440 минут, а не %', p_lead_min;
  end if;
  if p_duration_min is null or p_duration_min < 1 or p_duration_min > c_max_min then
    raise exception 'maintenance_announce: длительность — 1..% минут, а не %', c_max_min, p_duration_min;
  end if;

  -- Два нажатия разом (кнопка + скрипт) не должны выдать два id одной заморозке.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.maintenance_announce'));

  select value into v_prev from public.app_settings where key = 'maintenance';
  begin
    v_prev_until  := (v_prev ->> 'until')::timestamptz;
    v_prev_starts := coalesce((v_prev ->> 'starts_at')::timestamptz, (v_prev ->> 'started_at')::timestamptz);
  exception when others then
    v_prev_until := null; -- неразобранная строка = заморозки нет, как и в сервере
  end;

  if v_prev_until is not null and v_prev_until > v_now and v_prev ->> 'id' is not null then
    v_id := v_prev ->> 'id';
  else
    v_id := pg_catalog.gen_random_uuid()::text;
    v_prev_starts := null;
  end if;

  -- Время — с точностью до минуты: людям показываем «в 23:30», и повтор нажатия в ту же минуту
  -- даёт то же самое событие, а не «новое время» и заново непрочитанное уведомление.
  if v_prev_starts is not null and v_prev_starts <= v_now then
    v_starts := v_prev_starts;                              -- уже идёт: начало не трогаем
    v_until  := pg_catalog.date_trunc('minute', v_now) + pg_catalog.make_interval(mins => p_duration_min);
  else
    v_starts := pg_catalog.date_trunc('minute', v_now) + pg_catalog.make_interval(mins => p_lead_min);
    v_until  := v_starts + pg_catalog.make_interval(mins => p_duration_min);
  end if;

  insert into public.app_settings (key, value, updated_at)
  values ('maintenance', pg_catalog.jsonb_build_object(
    'id',         v_id,
    'starts_at',  v_starts,
    'started_at', v_starts,  -- старое поле: его читает прежний код сервера
    'until',      v_until,
    'message_en', case when v_en <> '' then v_en else c_def_en end,
    'message_ru', case when v_ru <> '' then v_ru else c_def_ru end
  ), v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  -- Плашка — только пока заморозка впереди или идёт; её `until` = конец заморозки.
  insert into public.app_settings (key, value, updated_at)
  values ('deploy_notice', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'kind',  'freeze',
    'id',    v_id,
    'at',    v_starts,
    'until', v_until,
    'en',    nullif(v_en, ''),
    'ru',    nullif(v_ru, '')
  )), v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'id',         v_id,
    'starts_at',  v_starts,
    'until',      v_until,
    'message_en', nullif(v_en, ''),
    'message_ru', nullif(v_ru, '')
  ));

  -- Всем людям рабочих воркспейсов, кроме демо. Сменилось время — уведомление снова
  -- непрочитанное и поднимается наверх ленты: человек мог прочитать прежнее и успокоиться.
  insert into public.notifications (recipient_telegram_id, group_id, type, payload, dedup_key)
  select u.telegram_id, u.group_id, 'maintenance', v_payload, 'maintenance:' || v_id
    from public.allowed_users u
   where u.telegram_id is not null
     -- Без воркспейса веба у человека нет — и строки тоже: `null <> 'demo'` не истинно.
     and u.group_id <> c_demo
  on conflict (recipient_telegram_id, dedup_key) where dedup_key is not null
  do update set
    payload    = excluded.payload,
    read_at    = case when public.notifications.payload is distinct from excluded.payload
                      then null else public.notifications.read_at end,
    created_at = case when public.notifications.payload is distinct from excluded.payload
                      then v_now else public.notifications.created_at end;
  get diagnostics v_sent = row_count;

  return pg_catalog.jsonb_build_object(
    'id', v_id, 'starts_at', v_starts, 'until', v_until, 'notified', v_sent
  );
end;
$$;

-- ── Снять заморозку (и плановую, и идущую) ───────────────────────────────────────────────────
-- Уведомления не удаляются: человек уже мог их прочитать, и молча пропавшая строка пугает
-- сильнее честной пометки «отменено». Плашка снимается только своя (`kind = 'freeze'`).
create or replace function public.maintenance_cancel()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now  timestamptz := pg_catalog.now();
  v_id   text;
  v_hits integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.maintenance_announce'));

  select value ->> 'id' into v_id from public.app_settings where key = 'maintenance';
  delete from public.app_settings where key = 'maintenance';
  delete from public.app_settings where key = 'deploy_notice' and value ->> 'kind' = 'freeze';

  if v_id is not null then
    update public.notifications
       set payload = payload || pg_catalog.jsonb_build_object('cancelled_at', v_now)
     where dedup_key = 'maintenance:' || v_id
       and type = 'maintenance'
       and not (payload ? 'cancelled_at');
    get diagnostics v_hits = row_count;
  end if;

  return pg_catalog.jsonb_build_object('id', v_id, 'marked', v_hits);
end;
$$;

-- Правка прод-данных и уведомление всей команды — только ключом сервиса и владельцем базы.
-- Грант на PUBLIC наследуется в anon/authenticated, поэтому снимается именно с PUBLIC
-- (урок GHSA-vxrp-599j-46hv).
revoke all on function public.maintenance_announce(integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.maintenance_cancel() from public, anon, authenticated;
grant execute on function public.maintenance_announce(integer, integer, text, text) to service_role;
grant execute on function public.maintenance_cancel() to service_role;
