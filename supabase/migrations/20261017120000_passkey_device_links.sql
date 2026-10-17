-- «Добавить устройство» для ключей входа (решение владельца 17.10.2026,
-- docs/decisions/2026-10-17-passkey-add-device.md).
--
-- Устройство, где второй шаг пройден ключом, выдаёт одноразовую ссылку; телефон того же человека
-- под своей сессией заводит по ней свой ключ (Face ID). В таблице — только SHA-256 токена.
-- Три функции держат правила в одном месте: лимит выдачи и гашение прежних (issue), взвод вызова
-- регистрации на живой ссылке (arm), одноразовое гашение условным UPDATE (consume).
--
-- Только создание новых объектов; обратимость — `drop function public.passkey_device_link_issue(bigint,
-- text, integer, integer, integer), public.passkey_device_link_arm(bigint, text, text, integer),
-- public.passkey_device_link_consume(bigint, text); drop table public.passkey_device_links;` после того,
-- как код перестанет их звать. Клиент в базу не ходит: всё под service_role.

create table if not exists public.passkey_device_links (
  id                   uuid primary key default gen_random_uuid(),
  -- Человек, которому выдана ссылка: заводить ключ по ней может только его сессия.
  telegram_id          bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- SHA-256 (hex) токена из ссылки; сам токен в базе не хранится.
  token_hash           text not null unique,
  created_at           timestamptz not null default now(),
  -- Ссылка живёт 10 минут.
  expires_at           timestamptz not null,
  -- Погашена: использована, или выдана новая ссылка. Гасится один раз (UPDATE ... WHERE used_at IS NULL).
  used_at              timestamptz,
  -- Вызов регистрации, взведённый открытием ссылки на телефоне (2 минуты).
  challenge            text,
  challenge_expires_at timestamptz
);

create index if not exists passkey_device_links_person_idx
  on public.passkey_device_links (telegram_id, created_at desc);

comment on table public.passkey_device_links is
  'Одноразовые ссылки «Добавить устройство» (ключи входа): хеш токена, 10 минут, гасятся один раз; не больше 5 на человека в час. Решение 17.10.2026.';

alter table public.passkey_device_links enable row level security;
revoke all on table public.passkey_device_links from public, anon, authenticated;
grant select, insert, update, delete on table public.passkey_device_links to service_role;

-- Выдать ссылку: лимит за окно, гашение прежних живых, запись. Строка человека в allowed_users
-- блокируется — две параллельные выдачи не проскочат лимит вдвоём. false — лимит исчерпан.
create or replace function public.passkey_device_link_issue(
  p_telegram_id bigint,
  p_token_hash text,
  p_ttl_seconds integer,
  p_max_per_window integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recent integer;
begin
  perform 1 from public.allowed_users where telegram_id = p_telegram_id for update;
  if not found then
    return false;
  end if;

  select count(*) into v_recent
  from public.passkey_device_links
  where telegram_id = p_telegram_id
    and created_at >= now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max_per_window then
    return false;
  end if;

  update public.passkey_device_links
  set used_at = now()
  where telegram_id = p_telegram_id and used_at is null;

  -- Уборка заодно: строки человека старше суток не нужны ни лимиту (час), ни ссылке (10 минут).
  -- Отдельного cron не заводим — таблица растёт только от выдачи.
  delete from public.passkey_device_links
  where telegram_id = p_telegram_id and created_at < now() - interval '1 day';

  insert into public.passkey_device_links (telegram_id, token_hash, expires_at)
  values (p_telegram_id, p_token_hash, now() + make_interval(secs => p_ttl_seconds));
  return true;
end;
$$;

-- Взвести вызов регистрации на живой ссылке ЭТОГО человека. false — ссылки нет, чужая,
-- просрочена или погашена.
create or replace function public.passkey_device_link_arm(
  p_telegram_id bigint,
  p_token_hash text,
  p_challenge text,
  p_challenge_ttl_seconds integer
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with armed as (
    update public.passkey_device_links
    set challenge = p_challenge,
        challenge_expires_at = now() + make_interval(secs => p_challenge_ttl_seconds)
    where token_hash = p_token_hash
      and telegram_id = p_telegram_id
      and used_at is null
      and now() < expires_at
    returning 1
  )
  select exists (select 1 from armed);
$$;

-- Погасить ссылку ОДИН раз и вернуть взведённый вызов. Всё условие — в одном UPDATE: два
-- параллельных предъявления одной ссылки не пройдут оба. null — ссылки нет, чужая, просрочена,
-- погашена, вызов не взведён или просрочен.
create or replace function public.passkey_device_link_consume(
  p_telegram_id bigint,
  p_token_hash text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  update public.passkey_device_links
  set used_at = now()
  where token_hash = p_token_hash and telegram_id = p_telegram_id
    and used_at is null and expires_at > now()
    and challenge is not null and challenge_expires_at > now()
  returning challenge;
$$;

revoke all on function public.passkey_device_link_issue(bigint, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.passkey_device_link_arm(bigint, text, text, integer) from public, anon, authenticated;
revoke all on function public.passkey_device_link_consume(bigint, text) from public, anon, authenticated;
grant execute on function public.passkey_device_link_issue(bigint, text, integer, integer, integer) to service_role;
grant execute on function public.passkey_device_link_arm(bigint, text, text, integer) to service_role;
grant execute on function public.passkey_device_link_consume(bigint, text) to service_role;
