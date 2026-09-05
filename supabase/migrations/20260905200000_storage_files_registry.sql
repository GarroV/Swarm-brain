-- Реестр файлов приватного Storage (закрытие утечки swarm_drive).
--
-- Файлы больше НЕ отдаются публичным URL. Каждый показ проходит проверку доступа, а для этого
-- надо знать, ЧЕЙ файл. Реестр хранит только СВЯЗЬ path → владелец (запись или фидбек); сами
-- права (воркспейс, приватность, владелец) берутся из entries на момент проверки — так смена
-- приватности записи не оставляет реестр рассогласованным (единый источник правды — запись).
--
-- ADD TABLE — безопасно (см. CLAUDE.md §Миграции). Заполнение из существующих ссылок — отдельной
-- миграцией данных (после переноса файлов в swarm_private), чтобы DDL и backfill не смешивались.

create table if not exists public.storage_files (
  path        text primary key,                 -- путь объекта внутри бакета
  bucket      text not null default 'swarm_private',
  owner_kind  text not null check (owner_kind in ('entry', 'feedback')),
  -- Для owner_kind='entry' — запись-владелец; каскад удаления снимает осиротевший файл из
  -- реестра (сам объект Storage чистится существующими путями удаления записи).
  entry_id    uuid references public.entries(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Вложение записи обязано ссылаться на запись; фидбек-скрин — нет (admin-only, без владельца).
  constraint storage_files_entry_link check (owner_kind <> 'entry' or entry_id is not null)
);

-- Резолв «какие файлы у этой записи» при её удалении/переиндексации.
create index if not exists storage_files_entry_id_idx on public.storage_files (entry_id);

comment on table public.storage_files is
  'Реестр объектов приватного бакета swarm_private: связь path → владелец (запись/фидбек). Права доступа берутся из entries на момент проверки, здесь НЕ дублируются. См. swarm-api/file-access.ts.';
