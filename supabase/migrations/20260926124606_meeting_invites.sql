-- Приглашения бота на созвон (решение D017): человек вставляет в вебе ссылку — бот стучится.
--
-- Вставка ссылки залогиненным человеком И ЕСТЬ приглашение. Запись одноразовая и короткоживущая:
-- «кто позвал, в каком воркспейсе, на какую ссылку, до какого времени». Оркестратор забирает её в
-- работу (taken_at), бот предъявляет её id в meeting-claim, и сервер гасит её (used_at) тем же
-- движением, что заводит встречу. Ручную встречу служебный агент заводит ТОЛЬКО так: без записи
-- украденный токен бота заводил бы человеку приватную запись встречи, куда его никто не звал.
--
-- Кто пишет: swarm-api POST /meeting-invites (человек, своей авторизацией веба), meeting-invite
-- (оркестратор под токеном агента забирает ожидающие), meeting-claim (гашение). Сверка —
-- _shared/meeting-invite.ts.
--
-- Обратимость: миграция только СОЗДАЁТ новый объект. Старый код о таблице не знает. Откат —
-- `drop table public.meeting_invites;` после того, как код перестанет её читать.

create table if not exists public.meeting_invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    text not null references public.workspaces(id),
  invited_by  bigint not null references public.allowed_users(telegram_id) on delete cascade,
  join_url    text not null,                          -- ссылка на звонок, проверенная сервером
  platform    text not null check (platform in ('meet', 'kontur', 'zoom')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,                   -- после — не забирается и не гасится
  taken_at    timestamptz,                            -- оркестратор забрал в работу
  taken_by    text references public.service_agents(id),
  used_at     timestamptz,                            -- бот заявился на встречу: больше не годится
  meeting_id  uuid references public.meetings(id) on delete set null,
  constraint meeting_invites_expiry_after_creation check (expires_at > created_at)
);

comment on table public.meeting_invites is
  'Одноразовые приглашения бота на созвон от залогиненного человека (D017). Единственное основание, по которому служебный агент заводит ручную встречу.';
comment on column public.meeting_invites.invited_by is
  'telegram_id человека, вставившего ссылку. Бот обязан действовать именно за него (X-On-Behalf-Of).';
comment on column public.meeting_invites.used_at is
  'Когда приглашение погашено заявкой бота в meeting-claim. Гасится одним условным UPDATE: из двух одновременных заявок проходит одна.';
comment on column public.meeting_invites.meeting_id is
  'Встреча, заведённая по приглашению: по ней веб показывает человеку, что бот уже на звонке.';

-- Оркестратор забирает ожидающие приглашения своего воркспейса: частичный индекс по живым строкам.
create index if not exists meeting_invites_pending_idx
  on public.meeting_invites (group_id, created_at)
  where taken_at is null and used_at is null;

-- Data API: явный грант service_role (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.meeting_invites to service_role;
-- Умолчательные гранты Supabase дают anon/authenticated всё на новых таблицах public; снимаем
-- явно — второй замок поверх RLS.
revoke all on public.meeting_invites from anon, authenticated;

-- RLS как внешний замок: включён, политик нет → anon/authenticated не получают ни одной строки.
alter table public.meeting_invites enable row level security;
