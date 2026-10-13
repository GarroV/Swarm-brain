-- Очередь исходящих сообщений бота людям: то, что родилось в комендантский час (23:00–9:00 по
-- Москве) и ждёт утра. Решение владельца 13.10.2026, docs/decisions/2026-10-13-notification-curfew.md.
--
-- Кто пишет: _shared/notify-person.ts — каждое сообщение человеку «по инициативе бота» идёт через
-- него; вне комендантского часа оно уходит сразу, внутри — строкой сюда. Кто читает: drainTelegramOutbox
-- (swarm-bot, почасовой крон task-pings-hourly) — первым тиком после 9:00 по Москве отправляет
-- неотправленное, старые первыми. Тихо ничего не теряем: отправленная строка остаётся с `sent_at`,
-- сдавшаяся после 3 попыток — с `archived_at` и `last_error` (физического удаления нет — правило
-- проекта «архивация вместо удаления»).
--
-- `payload` — тело запроса к Bot API целиком (chat_id, text, parse_mode, reply_markup…): текст и
-- получателя очередь не меняет, меняется только момент отправки. Технические тревоги админу и
-- ответы на сообщения людей сюда не попадают.
--
-- Чистка по сроку не заведена: объём — единицы сообщений в сутки, отдельной миграцией с грантом на
-- delete, если когда-нибудь понадобится. Обратимость: миграция только создаёт новый объект; откат —
-- `drop table public.telegram_outbox;` после того, как код перестанет её читать.

create table if not exists public.telegram_outbox (
  id           bigserial primary key,
  -- Telegram-id получателя (дублирует chat_id в payload — чтобы выбирать и считать без разбора jsonb).
  recipient_id bigint not null,
  method       text not null default 'sendMessage',
  payload      jsonb not null,
  -- Кто поставил в очередь: короткая метка отправителя (digest, task_comment, granola_new…).
  kind         text not null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     smallint not null default 0,
  last_error   text,
  archived_at  timestamptz
);

comment on table public.telegram_outbox is
  'Очередь сообщений бота людям, рождённых в комендантский час (23:00–9:00 МСК); уходят утром (drainTelegramOutbox). Решение 13.10.2026.';
comment on column public.telegram_outbox.payload is
  'Тело запроса к Telegram Bot API целиком (chat_id, text, parse_mode, reply_markup).';
comment on column public.telegram_outbox.kind is
  'Метка отправителя — для разбора «откуда это сообщение».';
comment on column public.telegram_outbox.archived_at is
  'Сдались после 3 неудачных попыток; последняя причина — в last_error. Строку не удаляем.';

-- Выборка крона: неотправленное и не сдавшееся, старые первыми. Частичный индекс держит её маленькой.
create index if not exists telegram_outbox_unsent_idx
  on public.telegram_outbox (id)
  where sent_at is null and archived_at is null;

-- Data API: явный грант service_role (supabase/migrations/_template_new_table.sql). delete не
-- выдаётся осознанно — см. шапку.
grant select, insert, update on public.telegram_outbox to service_role;
grant usage, select on sequence public.telegram_outbox_id_seq to service_role;

-- Внешний замок, как у всех таблиц public: RLS без политик, anon/authenticated не получают ничего.
alter table public.telegram_outbox enable row level security;
revoke all on public.telegram_outbox from anon, authenticated;
revoke all on sequence public.telegram_outbox_id_seq from anon, authenticated;
