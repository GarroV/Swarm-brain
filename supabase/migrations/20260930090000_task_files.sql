-- Файлы к задаче (решение владельца 2026-09-30, docs/decisions/2026-09-30-task-files-on-muspelheim.md).
-- Байты лежат на MUSPELHEIM (сервис swarm-files), здесь — только реестр: что за файл, к какой
-- задаче, кто прикрепил. Доступ проверяет swarm-api по правилу задачи (canViewTask).
--
-- status: 'uploading' — ссылка на загрузку выдана, файл ещё не подтверждён; 'ready' — сервис
-- подтвердил, что байты на месте и размер совпал. Список показывает только ready.
-- Удаление — архивацией (archived_at), как везде в продукте.

create table if not exists public.task_files (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  group_id      text not null,
  name          text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  mime          text not null,
  storage_key   uuid not null unique,
  uploaded_by   bigint not null,
  status        text not null default 'uploading' check (status in ('uploading', 'ready')),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists task_files_task_live_idx
  on public.task_files (task_id, created_at)
  where archived_at is null;

comment on table public.task_files is
  'Реестр файлов к задачам; байты — на MUSPELHEIM (swarm-files), доступ — через swarm-api';

-- Внешний замок, как у всех таблиц public (issue #41): политик нет, anon/authenticated не видят
-- ничего, приложение ходит service_role.
alter table public.task_files enable row level security;
