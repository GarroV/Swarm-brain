-- Постоянный журнал рекордера на сервере (issue #468).
-- Рекордер у коллег «молча пропадает из строки меню», а по heartbeat видно только последний снимок.
-- Теперь рекордер сам шлёт строки своего локального журнала (раз в 5 мин) и отчёт о том, как
-- закончилась прошлая сессия (на старте). Пишет edge-функция recorder-diag под service_role.
-- Храним 3 дня: функция чистит старое за этого пользователя на каждой вставке.
-- В строках нет названий встреч и имён — только ключи и состояния (см. Diagnostics.swift).
create table if not exists public.recorder_diagnostics (
  id          bigint generated always as identity primary key,
  telegram_id bigint not null,
  build       integer,
  kind        text not null,          -- log | session_abnormal | session_clean | session_first_run
  lines       text not null default '',
  crash       text,                   -- начало отчёта о падении macOS, если был
  created_at  timestamptz not null default now()
);

create index if not exists recorder_diagnostics_user_time
  on public.recorder_diagnostics (telegram_id, created_at desc);

-- Внешний замок, как у всех таблиц public (issue #41): RLS без политик = deny-all для anon/authenticated.
alter table public.recorder_diagnostics enable row level security;

comment on table public.recorder_diagnostics is
  'Журнал рекордера с машин команды (issue #468). Пишет recorder-diag, хранится 3 дня.';
