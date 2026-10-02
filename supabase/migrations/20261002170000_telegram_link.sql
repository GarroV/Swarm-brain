-- Привязка Telegram из веба (issue #92, решение владельца 02.10.2026).
-- Номер человека в Swarm (telegram_id, у вошедших по почте — отрицательный) не меняется:
-- рядом запоминается его настоящий Telegram, и бот узнаёт человека по нему.
-- Только ADD COLUMN и индекс: существующие строки не трогаются.

alter table public.allowed_users add column if not exists telegram_chat_id bigint;
alter table public.allowed_users add column if not exists telegram_link_code_hash text;
alter table public.allowed_users add column if not exists telegram_link_expires_at timestamptz;

-- Один Telegram — одному человеку.
create unique index if not exists allowed_users_telegram_chat_id_key
  on public.allowed_users (telegram_chat_id) where telegram_chat_id is not null;

comment on column public.allowed_users.telegram_chat_id is
  'Настоящий Telegram человека, привязанный из веба (#92). Бот на входе ищет по нему и работает под telegram_id строки. NULL — привязки из веба не было (у кого telegram_id > 0, он и есть Telegram).';
comment on column public.allowed_users.telegram_link_code_hash is
  'sha256 одноразового кода привязки Telegram (#92); сам код в базе не хранится. Гасится при привязке.';
comment on column public.allowed_users.telegram_link_expires_at is
  'До какого времени действует код привязки Telegram (15 минут, _shared/telegram-link.ts).';
