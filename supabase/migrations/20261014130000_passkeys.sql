-- Ключи доступа (WebAuthn / Touch ID) — второй шаг входа в веб, задача #955 (часть 1).
--
-- Порядок входа (решение владельца 14.10.2026: «всегда входит гугл сначала»): первый шаг всегда
-- Google (или Telegram), второй — палец. Ключ сохраняется сам при первой загрузке приложения в
-- браузере без метки, а в браузере с меткой палец подтверждает уже сохранённый ключ. Вход одним
-- ключом, без Google, не делаем — поэтому вызов привязан к человеку с сессией (telegram_id).
--
-- Только создание новых объектов; обратимость — `drop table public.passkey_challenges,
-- public.passkeys; drop function public.passkeys_prune();` после того, как код перестанет их читать.
-- Клиент в базу не ходит: всё через Edge Function auth-passkey под service_role.

create table if not exists public.passkeys (
  id            uuid primary key default gen_random_uuid(),
  -- Человек. Удалили из allowed_users — ключи уходят вместе с ним, войти по ним уже нельзя.
  telegram_id   bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- Номер ключа и открытый ключ (COSE) — base64url: bytea через PostgREST ходит громоздким hex.
  credential_id text not null unique,
  public_key    text not null,
  -- Счётчик подписей: откат назад = клон ключа, вход отклоняется (проверка в коде, сравнение
  -- «был — стал» делается одним UPDATE ... WHERE sign_count = старое).
  sign_count    bigint not null default 0,
  transports    text[] not null default '{}',
  -- «Chrome · Mac»: имя по браузеру и системе, чтобы не спрашивать человека.
  name          text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists passkeys_telegram_id_idx on public.passkeys (telegram_id);

comment on table public.passkeys is
  'Ключи доступа людей (WebAuthn, платформенные: Touch ID). Второй шаг входа в веб, #955. Ключ без входа 30 дней снимает passkeys_prune().';

create table if not exists public.passkey_challenges (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- register — сохранить новый ключ, authenticate — подтвердить сохранённый.
  purpose     text not null check (purpose in ('register', 'authenticate')),
  challenge   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- Вызов снимается ОДИН раз, при первом предъявлении (UPDATE ... WHERE used_at IS NULL).
  -- Использованные строки остаются до уборки: по ним считается ограничитель попыток.
  used_at     timestamptz
);

create index if not exists passkey_challenges_person_idx
  on public.passkey_challenges (telegram_id, created_at desc);

comment on table public.passkey_challenges is
  'Вызовы (challenge) для регистрации и подтверждения ключа: живут 2 минуты, снимаются один раз; число выданных за окно — ограничитель попыток.';

-- Внешний замок: RLS без политик + никаких грантов анониму (урок 20260826210000: грант на PUBLIC
-- наследуется в anon, обычный REVOKE FROM anon его не снимает).
alter table public.passkeys enable row level security;
alter table public.passkey_challenges enable row level security;
revoke all on table public.passkeys from public, anon, authenticated;
revoke all on table public.passkey_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.passkeys to service_role;
grant select, insert, update, delete on table public.passkey_challenges to service_role;

-- Уборка: ключ, которым не входили 30 дней (у неиспользованного — со дня создания), снимается сам;
-- вызовы старше часа не нужны никому. Возвращает число снятых ключей.
create or replace function public.passkeys_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_idle constant interval := interval '30 days';
  v_removed integer;
begin
  delete from public.passkeys
  where coalesce(last_used_at, created_at) < now() - c_idle;
  get diagnostics v_removed = row_count;

  delete from public.passkey_challenges
  where expires_at < now() - interval '1 hour';

  return v_removed;
end;
$$;

comment on function public.passkeys_prune() is
  'Снимает ключи доступа без входа 30 дней (last_used_at, у неиспользованного created_at) и старые вызовы. Зовёт pg_cron passkeys-prune раз в сутки (#955).';

revoke all on function public.passkeys_prune() from public, anon, authenticated;
grant execute on function public.passkeys_prune() to service_role;

-- Расписание — самой миграцией, как у demo-reset: секрета нет, cron зовёт функцию внутри базы.
-- Где pg_cron не включён (локальный и тестовый контуры), регистрация пропускается.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('passkeys-prune', '41 3 * * *', 'select public.passkeys_prune()');
  else
    raise notice 'pg_cron не включён — расписание passkeys-prune не зарегистрировано';
  end if;
end;
$$;
