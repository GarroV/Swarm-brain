-- Серверный бэкап записей, которые сервер в работу не взял (решение владельца 27.10.2026,
-- docs/decisions/2026-10-27-all-recordings-uploaded.md; #1070): рекордер выгружает ВСЕ записи, а
-- отклонённая (defer, 403/409, исчерпанные попытки, «другая встреча») лежит здесь три дня, чтобы
-- исходник можно было обработать, если итог встречи пуст или провалился. Не распознаётся, токенов
-- не тратит. Файлы — в бакете meeting-audio под префиксом backup/<meeting_id>/…; строка живёт и
-- после уборки файлов (purged_at) — «архивация вместо удаления».
--
-- Только создание новой таблицы; обратимость — `drop table public.meeting_audio_backups;` после
-- того, как код (meeting-ingest/backup.ts, _shared/meeting-backup-retention.ts) перестанет её звать.
-- Клиент в базу не ходит: всё под service_role.

create table if not exists public.meeting_audio_backups (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid not null references public.meetings(id),
  group_id         text references public.workspaces(id),
  -- Кто выгрузил (telegram_id человека; у бота — его владелец).
  uploader         bigint not null,
  -- Кто пишет: `person:<id>` или `agent:<agent>:<id>` (meeting-ingest/second-recording.ts uploadSource).
  source           text not null,
  -- Почему запись не в работе: deferred | rejected | exhausted | other (неизвестное → other).
  reason           text not null check (reason in ('deferred', 'rejected', 'exhausted', 'other')),
  -- [{track:'sys'|'mic', name, offset, path, size}] — пути в бакете meeting-audio.
  parts            jsonb not null,
  mic_start_offset numeric check (mic_start_offset is null or mic_start_offset >= 0),
  recorded_seconds numeric check (recorded_seconds is null or recorded_seconds > 0),
  created_at       timestamptz not null default now(),
  -- Три дня хранения.
  expires_at       timestamptz not null default now() + interval '3 days',
  -- Заменён более новым бэкапом того же источника: файлы убираются уборкой, не дожидаясь срока.
  replaced_at      timestamptz,
  -- Файлы удалены из хранилища (строка остаётся).
  purged_at        timestamptz,
  -- Бэкап пущен в обработку (на будущее: итог встречи пуст или провалился).
  used_at          timestamptz
);

-- Один живой бэкап на (встреча, источник): повтор того же источника заменяет прежний.
create unique index if not exists meeting_audio_backups_active_uq
  on public.meeting_audio_backups (meeting_id, source)
  where purged_at is null and replaced_at is null;

-- Уборка выбирает неубранные строки по сроку.
create index if not exists meeting_audio_backups_purge_idx
  on public.meeting_audio_backups (expires_at)
  where purged_at is null;

comment on table public.meeting_audio_backups is
  'Серверная копия записей, которые сервер не взял в работу: хранится 3 дня (expires_at), файлы в meeting-audio/backup/…, после уборки purged_at. Решение 27.10.2026, #1070.';

alter table public.meeting_audio_backups enable row level security;
revoke all on table public.meeting_audio_backups from public, anon, authenticated;
grant select, insert, update, delete on table public.meeting_audio_backups to service_role;
